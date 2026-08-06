import type { CitationEntry } from "../../latex/latexIndex";
import { authorLastNames, titleTokens, type KnowledgeGraph } from "./knowledgeGraph";

export type ScholarlyProvider = "OpenAlex" | "Crossref";

export interface DiscoveredPaper {
  id: string;
  source: ScholarlyProvider;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  citationCount?: number;
  score: number;
  reasons: string[];
  bibtexKey: string;
  bibtex: string;
}

export interface ScholarlyDiscoveryResult {
  papers: DiscoveredPaper[];
  queries: string[];
  providerErrors: string[];
  aiQueriesUsed: string[];
}

export interface ScholarlyDiscoveryOptions {
  signal?: AbortSignal;
  limit?: number;
  perProviderLimit?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  aiQueries?: string[];
  fetcher?: typeof fetch;
  currentYear?: number;
}

interface RawPaper {
  source: ScholarlyProvider;
  sourceId?: string;
  sourceType?: string;
  title: string;
  authors: string[];
  year: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  citationCount?: number;
  providerScore?: number;
}

interface DiscoveryFingerprint {
  weightedTerms: Map<string, number>;
  topTerms: string[];
  authorNames: Set<string>;
  existingKeys: Set<string>;
  existingDois: Set<string>;
  existingTitles: Set<string>;
  currentYear: number;
}

interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  retryDelayMs: number;
  fetcher: typeof fetch;
}

interface ScholarlyDesktopApi {
  fetchScholarlyJson?: (url: string) => Promise<unknown>;
}

class DiscoveryHttpError extends Error {
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;

  constructor(
    message: string,
    retryable: boolean,
    status?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DiscoveryHttpError";
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const defaultDiscoveryLimit = 28;
const defaultPerProviderLimit = 10;
const defaultTimeoutMs = 9000;
const defaultRetryDelayMs = 300;
const discoveryCacheTtlMs = 10 * 60 * 1000;
const defaultProviderCooldownMs = 10 * 60 * 1000;
const discoveryCache = new Map<
  string,
  { savedAt: number; result: ScholarlyDiscoveryResult }
>();
const providerCooldownUntil = new Map<ScholarlyProvider, number>();

const bibtexTypeByProviderType: Record<string, string> = {
  article: "article",
  "journal-article": "article",
  preprint: "article",
  proceedings: "inproceedings",
  "proceedings-article": "inproceedings",
  "book-chapter": "incollection",
  book: "book",
  dissertation: "phdthesis",
  dataset: "misc",
  report: "techreport",
};

const queryStopTerms = new Set([
  "paper",
  "study",
  "studies",
  "result",
  "results",
  "proposed",
  "using",
  "towards",
  "toward",
  "based",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDesktopFetchEnvelope(
  value: unknown,
): value is
  | { ok: true; json: unknown }
  | { ok: false; status?: number; retryAfterMs?: number; error?: string } {
  return isRecord(value) && typeof value.ok === "boolean";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return readString(value);
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const text = readString(item);
    if (text) return text;
  }
  return undefined;
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDoi(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .trim();
}

function doiToUrl(doi: string | undefined): string | undefined {
  const normalized = normalizeDoi(doi);
  return normalized ? `https://doi.org/${normalized}` : undefined;
}

function normalizeIdentityTitle(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFingerprint(
  graph: KnowledgeGraph,
  entries: CitationEntry[],
  currentYear: number,
): DiscoveryFingerprint {
  const weightedTerms = new Map<string, number>();
  const authorNames = new Set<string>();
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));

  for (const entry of entries) {
    for (const author of authorLastNames(entry.author ?? entry.editor)) {
      authorNames.add(author);
    }
  }

  for (const node of graph.nodes) {
    const entry = entriesByKey.get(node.key);
    for (const author of authorLastNames(entry?.author ?? entry?.editor)) {
      authorNames.add(author);
    }
    const multiplier = 1 + (node.cited ? 1.5 : 0) + Math.min(node.degree, 8) * 0.25;
    for (const token of titleTokens(node.title)) {
      if (queryStopTerms.has(token)) continue;
      weightedTerms.set(token, (weightedTerms.get(token) ?? 0) + multiplier);
    }
  }

  const topTerms = [...weightedTerms.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term)
    .slice(0, 14);

  return {
    weightedTerms,
    topTerms,
    authorNames,
    existingKeys: new Set(entries.map((entry) => entry.key.toLowerCase())),
    existingDois: new Set(
      entries.map((entry) => normalizeDoi(entry.doi)).filter(Boolean),
    ),
    existingTitles: new Set(
      entries
        .map((entry) => normalizeIdentityTitle(entry.title))
        .filter((title) => title.length >= 16),
    ),
    currentYear,
  };
}

function compactQuery(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function normalizeExternalQuery(value: string): string | null {
  const query = value.replace(/\s+/g, " ").trim().slice(0, 180);
  if (query.length < 8) return null;
  if (/^https?:/i.test(query)) return null;
  return query;
}

function mergeDiscoveryQueries(
  aiQueries: string[] | undefined,
  graphQueries: string[],
) {
  const merged: string[] = [];
  const seen = new Set<string>();
  const add = (query: string | null) => {
    if (!query) return;
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(query);
  };
  for (const query of aiQueries ?? []) add(normalizeExternalQuery(query));
  for (const query of graphQueries) add(query);
  return merged.slice(0, 5);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function abortError(): DOMException {
  return new DOMException("Discovery aborted", "AbortError");
}

function desktopScholarlyFetcher(): typeof fetch | undefined {
  const api =
    typeof window === "undefined"
      ? undefined
      : (window.latexdo as ScholarlyDesktopApi | undefined);
  if (typeof api?.fetchScholarlyJson !== "function") return undefined;

  return async (input, init) => {
    const signal = init?.signal;
    if (signal?.aborted) throw abortError();
    const request = api.fetchScholarlyJson?.(requestUrl(input));
    if (!request) throw new Error("Scholarly metadata API is unavailable.");

    const json = signal
      ? await new Promise<unknown>((resolve, reject) => {
          const onAbort = () => reject(abortError());
          signal.addEventListener("abort", onAbort, { once: true });
          request.then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", onAbort);
          });
        })
      : await request;

    if (isDesktopFetchEnvelope(json)) {
      if (json.ok) {
        return new Response(JSON.stringify(json.json), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: json.error ?? "Request failed" }), {
        status: json.status ?? 502,
        headers: {
          "Content-Type": "application/json",
          ...(json.retryAfterMs
            ? { "x-latexdo-retry-after-ms": String(json.retryAfterMs) }
            : {}),
        },
      });
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

export function buildDiscoveryQueries(
  graph: KnowledgeGraph,
  entries: CitationEntry[],
  currentYear = new Date().getFullYear(),
): string[] {
  const fingerprint = buildFingerprint(graph, entries, currentYear);
  if (fingerprint.topTerms.length === 0) return [];

  const queries: string[] = [];
  const addQuery = (query: string) => {
    const normalized = query.toLowerCase();
    if (
      query.length >= 8 &&
      !queries.some((item) => item.toLowerCase() === normalized)
    ) {
      queries.push(query);
    }
  };

  addQuery(compactQuery(fingerprint.topTerms.slice(0, 7)));

  const anchorNodes = [...graph.nodes]
    .filter((node) => node.title)
    .sort((a, b) => {
      const citedDelta = Number(b.cited) - Number(a.cited);
      if (citedDelta !== 0) return citedDelta;
      return b.degree - a.degree;
    })
    .slice(0, 3);

  for (const node of anchorNodes) {
    const titleTerms = [...titleTokens(node.title)].filter(
      (token) => !queryStopTerms.has(token),
    );
    addQuery(
      compactQuery([...titleTerms.slice(0, 5), ...fingerprint.topTerms.slice(0, 2)]),
    );
  }

  return queries.slice(0, 4);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function providerOnCooldown(provider: ScholarlyProvider): boolean {
  return (providerCooldownUntil.get(provider) ?? 0) > Date.now();
}

function rememberProviderFailure(provider: ScholarlyProvider, error: unknown): void {
  if (!(error instanceof DiscoveryHttpError)) return;
  if (error.status === 429) {
    providerCooldownUntil.set(
      provider,
      Date.now() + (error.retryAfterMs ?? defaultProviderCooldownMs),
    );
  }
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
    }
    function onAbort() {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    }
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await options.fetcher(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const retryAfterMs = Number(response.headers.get("x-latexdo-retry-after-ms"));
        throw new DiscoveryHttpError(
          `HTTP ${response.status} from ${new URL(url).hostname}`,
          response.status >= 500,
          response.status,
          Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : undefined,
        );
      }
      return await response.json();
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      lastError = error;
      const retryable =
        error instanceof DiscoveryHttpError ? error.retryable : attempt === 0;
      if (!retryable || attempt === 1) break;
      await wait(options.retryDelayMs, options.signal);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Scholarly metadata request failed");
}

function openAlexAuthors(work: Record<string, unknown>): string[] {
  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  return authorships
    .map((authorship) => {
      if (!isRecord(authorship) || !isRecord(authorship.author)) return undefined;
      return readString(authorship.author.display_name);
    })
    .filter((author): author is string => Boolean(author))
    .slice(0, 12);
}

function openAlexVenue(work: Record<string, unknown>): string | undefined {
  const primaryLocation = isRecord(work.primary_location)
    ? work.primary_location
    : undefined;
  const source =
    primaryLocation && isRecord(primaryLocation.source)
      ? primaryLocation.source
      : undefined;
  const bestOa = isRecord(work.best_oa_location) ? work.best_oa_location : undefined;
  const bestOaSource = bestOa && isRecord(bestOa.source) ? bestOa.source : undefined;
  const hostVenue = isRecord(work.host_venue) ? work.host_venue : undefined;
  return (
    readString(source?.display_name) ??
    readString(bestOaSource?.display_name) ??
    readString(hostVenue?.display_name)
  );
}

function paperFromOpenAlex(work: unknown): RawPaper | null {
  if (!isRecord(work)) return null;
  if (work.is_retracted === true || work.is_paratext === true) return null;
  const title = cleanText(
    readString(work.display_name) ?? readString(work.title) ?? "",
  );
  if (!title) return null;

  const primaryLocation = isRecord(work.primary_location)
    ? work.primary_location
    : undefined;
  const bestOa = isRecord(work.best_oa_location) ? work.best_oa_location : undefined;
  const doi = normalizeDoi(readString(work.doi));
  const doiUrl = doiToUrl(doi);
  const landingUrl =
    doiUrl ??
    readString(primaryLocation?.landing_page_url) ??
    readString(bestOa?.landing_page_url) ??
    readString(work.id);
  const pdfUrl = readString(primaryLocation?.pdf_url) ?? readString(bestOa?.pdf_url);

  return {
    source: "OpenAlex",
    sourceId: readString(work.id),
    title,
    authors: openAlexAuthors(work),
    year: readNumber(work.publication_year) ?? null,
    venue: openAlexVenue(work),
    doi: doi || undefined,
    url: landingUrl,
    pdfUrl,
    citationCount: readNumber(work.cited_by_count),
    providerScore: readNumber(work.relevance_score),
  };
}

async function searchOpenAlex(
  query: string,
  options: FetchJsonOptions,
  perProviderLimit: number,
): Promise<RawPaper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(perProviderLimit));
  const json = await fetchJson(url.toString(), options);
  if (!isRecord(json) || !Array.isArray(json.results)) return [];
  return json.results
    .map(paperFromOpenAlex)
    .filter((paper): paper is RawPaper => Boolean(paper));
}

function crossrefAuthors(item: Record<string, unknown>): string[] {
  const authors = Array.isArray(item.author) ? item.author : [];
  return authors
    .map((author) => {
      if (!isRecord(author)) return undefined;
      const given = readString(author.given);
      const family = readString(author.family);
      return compactQuery([given ?? "", family ?? ""]);
    })
    .filter((author): author is string => Boolean(author))
    .slice(0, 12);
}

function crossrefYear(item: Record<string, unknown>): number | null {
  const issued = isRecord(item.issued) ? item.issued : undefined;
  const dateParts = Array.isArray(issued?.["date-parts"])
    ? issued?.["date-parts"]
    : undefined;
  const firstPart = Array.isArray(dateParts?.[0]) ? dateParts[0] : undefined;
  const year = readNumber(firstPart?.[0]);
  return year ?? null;
}

function paperFromCrossref(item: unknown): RawPaper | null {
  if (!isRecord(item)) return null;
  const title = cleanText(firstString(item.title) ?? "");
  if (!title) return null;
  const doi = normalizeDoi(readString(item.DOI));
  const type = readString(item.type);
  const venue = cleanText(firstString(item["container-title"]) ?? "");
  return {
    source: "Crossref",
    sourceId: doi || readString(item.URL),
    title,
    authors: crossrefAuthors(item),
    year: crossrefYear(item),
    venue: venue || undefined,
    doi: doi || undefined,
    url: doiToUrl(doi) ?? readString(item.URL),
    citationCount: readNumber(item["is-referenced-by-count"]),
    providerScore: readNumber(item.score),
    sourceType: type,
  };
}

async function searchCrossref(
  query: string,
  options: FetchJsonOptions,
  perProviderLimit: number,
): Promise<RawPaper[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(perProviderLimit));
  const json = await fetchJson(url.toString(), options);
  if (
    !isRecord(json) ||
    !isRecord(json.message) ||
    !Array.isArray(json.message.items)
  ) {
    return [];
  }
  return json.message.items
    .map(paperFromCrossref)
    .filter((paper): paper is RawPaper => Boolean(paper));
}

function paperIdentity(raw: RawPaper): string {
  const doi = normalizeDoi(raw.doi);
  if (doi) return `doi:${doi}`;
  return `title:${normalizeIdentityTitle(raw.title)}:${raw.year ?? ""}`;
}

function scoreRawPaper(
  paper: RawPaper,
  fingerprint: DiscoveryFingerprint,
): { score: number; reasons: string[] } {
  const candidateTokens = titleTokens(paper.title);
  const matchedTerms: string[] = [];
  let weightedHits = 0;
  let topWeight = 0;

  for (const term of fingerprint.topTerms.slice(0, 10)) {
    topWeight += fingerprint.weightedTerms.get(term) ?? 0;
    if (candidateTokens.has(term)) {
      matchedTerms.push(term);
      weightedHits += fingerprint.weightedTerms.get(term) ?? 0;
    }
  }

  const topicScore = topWeight > 0 ? weightedHits / topWeight : 0;
  const candidateAuthorNames = new Set(
    paper.authors.flatMap((author) => authorLastNames(author)),
  );
  const sharedAuthors = [...candidateAuthorNames].filter((author) =>
    fingerprint.authorNames.has(author),
  );
  const authorScore = Math.min(1, sharedAuthors.length / 2);
  const citationScore = Math.min(
    1,
    Math.log10(Math.max(1, (paper.citationCount ?? 0) + 1)) / 4,
  );
  const recencyScore =
    paper.year && paper.year >= fingerprint.currentYear - 3
      ? 1
      : paper.year && paper.year >= fingerprint.currentYear - 8
        ? 0.55
        : 0;
  const providerScore = Math.min(0.06, (paper.providerScore ?? 0) / 1000);

  const score = Math.min(
    1,
    topicScore * 0.68 +
      authorScore * 0.16 +
      citationScore * 0.1 +
      recencyScore * 0.06 +
      providerScore,
  );

  const reasons: string[] = [];
  if (matchedTerms.length > 0) {
    reasons.push(`Matches graph terms: ${matchedTerms.slice(0, 5).join(", ")}`);
  }
  if (sharedAuthors.length > 0) {
    reasons.push(`Shares author: ${sharedAuthors.slice(0, 2).join(", ")}`);
  }
  if ((paper.citationCount ?? 0) >= 50) {
    reasons.push(`${paper.citationCount} citations`);
  }
  if (paper.year && paper.year >= fingerprint.currentYear - 3) {
    reasons.push(`Recent paper from ${paper.year}`);
  }
  if (paper.doi) {
    reasons.push("DOI metadata available");
  }

  return { score: Number(score.toFixed(3)), reasons };
}

function bibtexEscape(value: string): string {
  return cleanText(value).replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function bibtexType(raw: RawPaper): string {
  return bibtexTypeByProviderType[(raw.sourceType ?? "").toLowerCase()] ?? "article";
}

function buildBibtexKey(raw: RawPaper, usedKeys: Set<string>): string {
  const firstAuthor = authorLastNames(raw.authors[0])?.[0] ?? "paper";
  const firstTitleToken = [...titleTokens(raw.title)]?.[0] ?? "work";
  const year = raw.year ? String(raw.year) : "nd";
  const base = `${firstAuthor}${year}${firstTitleToken}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  let key = base || `paper${year}`;
  let suffix = 2;
  while (usedKeys.has(key.toLowerCase())) {
    key = `${base}${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key.toLowerCase());
  return key;
}

function buildBibtex(raw: RawPaper, key: string): string {
  const fields: Array<[string, string | undefined]> = [
    ["title", raw.title],
    ["author", raw.authors.length ? raw.authors.join(" and ") : undefined],
    ["year", raw.year ? String(raw.year) : undefined],
    [bibtexType(raw) === "inproceedings" ? "booktitle" : "journal", raw.venue],
    ["doi", normalizeDoi(raw.doi) || undefined],
    ["url", raw.url],
  ];
  const presentFields = fields
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([name, value], index, all) => {
      const comma = index === all.length - 1 ? "" : ",";
      return `  ${name} = {${bibtexEscape(value)}}${comma}`;
    });

  return [`@${bibtexType(raw)}{${key},`, ...presentFields, "}"].join("\n");
}

function materializePaper(
  raw: RawPaper,
  fingerprint: DiscoveryFingerprint,
  usedKeys: Set<string>,
): DiscoveredPaper | null {
  const doi = normalizeDoi(raw.doi);
  if (doi && fingerprint.existingDois.has(doi)) return null;

  const titleIdentity = normalizeIdentityTitle(raw.title);
  if (titleIdentity.length >= 16 && fingerprint.existingTitles.has(titleIdentity)) {
    return null;
  }

  const { score, reasons } = scoreRawPaper(raw, fingerprint);
  const hasGraphSignal = reasons.some(
    (reason) =>
      reason.startsWith("Matches graph terms:") || reason.startsWith("Shares author:"),
  );
  if (score < 0.09 || !hasGraphSignal) return null;

  const bibtexKey = buildBibtexKey(raw, usedKeys);
  return {
    id: paperIdentity(raw),
    source: raw.source,
    title: raw.title,
    authors: raw.authors,
    year: raw.year,
    venue: raw.venue,
    doi: doi || undefined,
    url: raw.url,
    pdfUrl: raw.pdfUrl,
    citationCount: raw.citationCount,
    score,
    reasons,
    bibtexKey,
    bibtex: buildBibtex(raw, bibtexKey),
  };
}

function providerErrorLabel(provider: ScholarlyProvider, error: unknown): string {
  if (error instanceof Error) return `${provider}: ${error.message}`;
  return `${provider}: request failed`;
}

async function collectProviderPapers(
  provider: ScholarlyProvider,
  queries: string[],
  fetchOptions: FetchJsonOptions,
  perProviderLimit: number,
): Promise<{ papers: RawPaper[]; errors: string[] }> {
  if (queries.length === 0 || providerOnCooldown(provider)) {
    return { papers: [], errors: [] };
  }

  const settled = await Promise.allSettled(
    queries.map((query) =>
      provider === "OpenAlex"
        ? searchOpenAlex(query, fetchOptions, perProviderLimit)
        : searchCrossref(query, fetchOptions, perProviderLimit),
    ),
  );

  const papers: RawPaper[] = [];
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      papers.push(...result.value);
    } else if (isAbortError(result.reason)) {
      throw result.reason;
    } else {
      rememberProviderFailure(provider, result.reason);
      errors.push(providerErrorLabel(provider, result.reason));
    }
  }

  return { papers, errors };
}

function materializeDiscoveredPapers(
  rawPapers: RawPaper[],
  fingerprint: DiscoveryFingerprint,
): DiscoveredPaper[] {
  const usedKeys = new Set(fingerprint.existingKeys);
  const seen = new Set<string>();
  const papers: DiscoveredPaper[] = [];
  for (const raw of rawPapers) {
    const identity = paperIdentity(raw);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const paper = materializePaper(raw, fingerprint, usedKeys);
    if (paper) papers.push(paper);
  }

  return papers.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return (b.citationCount ?? 0) - (a.citationCount ?? 0);
  });
}

function discoveryCacheKey(
  fingerprint: DiscoveryFingerprint,
  queries: string[],
): string {
  return [
    queries.join("|"),
    [...fingerprint.existingDois].sort().join(","),
    [...fingerprint.existingTitles].sort().join(","),
  ].join("::");
}

export async function discoverRelatedPapers(
  graph: KnowledgeGraph,
  entries: CitationEntry[],
  options: ScholarlyDiscoveryOptions = {},
): Promise<ScholarlyDiscoveryResult> {
  const fetcher =
    options.fetcher ??
    desktopScholarlyFetcher() ??
    (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
  if (!fetcher) {
    throw new Error("Network fetch is unavailable in this runtime.");
  }

  const currentYear = options.currentYear ?? new Date().getFullYear();
  const fingerprint = buildFingerprint(graph, entries, currentYear);
  const graphQueries = buildDiscoveryQueries(graph, entries, currentYear);
  const queries = mergeDiscoveryQueries(options.aiQueries, graphQueries);
  const aiQueriesUsed = queries.filter((query) =>
    (options.aiQueries ?? []).some(
      (aiQuery) =>
        normalizeExternalQuery(aiQuery)?.toLowerCase() === query.toLowerCase(),
    ),
  );
  if (queries.length === 0) {
    return { papers: [], queries, providerErrors: [], aiQueriesUsed };
  }
  const cacheKey = discoveryCacheKey(fingerprint, queries);
  const cached = options.fetcher ? undefined : discoveryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < discoveryCacheTtlMs) {
    return cached.result;
  }

  const fetchOptions: FetchJsonOptions = {
    fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
    retryDelayMs: options.retryDelayMs ?? defaultRetryDelayMs,
  };
  const perProviderLimit = options.perProviderLimit ?? defaultPerProviderLimit;
  const providerErrors: string[] = [];
  const openAlex = await collectProviderPapers(
    "OpenAlex",
    queries.slice(0, 3),
    fetchOptions,
    perProviderLimit,
  );
  if (options.signal?.aborted) {
    throw abortError();
  }
  providerErrors.push(...openAlex.errors);

  let rawPapers = openAlex.papers;
  let papers = materializeDiscoveredPapers(rawPapers, fingerprint);

  if (papers.length === 0) {
    const crossref = await collectProviderPapers(
      "Crossref",
      queries.slice(0, 1),
      fetchOptions,
      Math.min(5, perProviderLimit),
    );
    if (options.signal?.aborted) {
      throw abortError();
    }
    providerErrors.push(...crossref.errors);
    rawPapers = [...rawPapers, ...crossref.papers];
    papers = materializeDiscoveredPapers(rawPapers, fingerprint);
  }
  const result = {
    papers: papers.slice(0, options.limit ?? defaultDiscoveryLimit),
    queries,
    providerErrors,
    aiQueriesUsed,
  };
  if (!options.fetcher) {
    discoveryCache.set(cacheKey, { savedAt: Date.now(), result });
  }
  return result;
}

export function formatDiscoveredPaperAuthors(paper: DiscoveredPaper): string {
  if (paper.authors.length === 0) return "Unknown authors";
  if (paper.authors.length <= 3) return paper.authors.join(", ");
  return `${paper.authors.slice(0, 3).join(", ")} et al.`;
}
