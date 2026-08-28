import type { CitationEntry } from "./latexIndex";

const citationSearchFields: Array<keyof CitationEntry> = [
  "key",
  "title",
  "author",
  "editor",
  "year",
  "journal",
  "booktitle",
  "publisher",
  "school",
  "institution",
  "doi",
  "url",
  "eprint",
  "archivePrefix",
  "howpublished",
  "abstract",
  "keywords",
  "note",
  "sourceFile",
];

export const citationCompletionTriggerCharacters = [
  "{",
  ",",
  " ",
  ":",
  "-",
  ".",
  "/",
  "_",
  ...letters("abcdefghijklmnopqrstuvwxyz"),
  ...letters("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  ...letters("0123456789"),
];

export function citationCompletionFilterText(entry: CitationEntry): string {
  const readable = uniqueCitationParts(
    citationSearchFields.map((field) => entry[field]),
  );
  const normalized = normalizeForCitationSearch(readable.join(" "));
  const compact = normalized.replace(/\s+/g, "");
  return [...readable, normalized, compact].filter(Boolean).join(" ").trim();
}

export function citationCompletionDetail(entry: CitationEntry): string {
  return [
    entry.title,
    citationPeople(entry),
    entry.year,
    citationVenue(entry),
    entry.type ? entry.type.toUpperCase() : undefined,
  ]
    .filter(Boolean)
    .join(" - ");
}

export function citationCompletionInfo(entry: CitationEntry): string {
  return [
    entry.title ? `Title: ${entry.title}` : undefined,
    citationPeople(entry) ? `Author: ${citationPeople(entry)}` : undefined,
    entry.year ? `Year: ${entry.year}` : undefined,
    citationVenue(entry) ? `Venue: ${citationVenue(entry)}` : undefined,
    entry.doi ? `DOI: ${entry.doi}` : undefined,
    entry.eprint ? `Eprint: ${entry.eprint}` : undefined,
    entry.url ? `URL: ${entry.url}` : undefined,
    `Source: ${entry.sourceFile}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function citationCompletionMarkdown(entry: CitationEntry): string {
  return [
    entry.title ? `**${entry.title}**` : undefined,
    citationPeople(entry) ? `Author: ${citationPeople(entry)}` : undefined,
    entry.year ? `Year: ${entry.year}` : undefined,
    citationVenue(entry) ? `Venue: ${citationVenue(entry)}` : undefined,
    entry.doi ? `DOI: ${entry.doi}` : undefined,
    entry.eprint ? `Eprint: ${entry.eprint}` : undefined,
    entry.url ? `URL: ${entry.url}` : undefined,
    "",
    `Source: \`${entry.sourceFile}\``,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
}

export function rankedCitationCompletions(
  entries: CitationEntry[],
  query: string,
): CitationEntry[] {
  return entries
    .filter((entry) => citationMatchesQuery(entry, query))
    .sort((a, b) => {
      const scoreDelta =
        citationCompletionScore(b, query) - citationCompletionScore(a, query);
      if (scoreDelta !== 0) return scoreDelta;
      return a.key.localeCompare(b.key);
    });
}

export function citationCompletionSortText(
  entry: CitationEntry,
  query: string,
): string {
  const rank = 999 - citationCompletionScore(entry, query);
  return `${String(rank).padStart(3, "0")}-${entry.key.toLowerCase()}`;
}

export function citationMatchesQuery(entry: CitationEntry, query: string): boolean {
  const terms = normalizedTerms(query);
  if (terms.length === 0) return true;
  const searchable = normalizeForCitationSearch(citationCompletionFilterText(entry));
  return terms.every((term) => searchable.includes(term));
}

function citationCompletionScore(entry: CitationEntry, query: string): number {
  const normalizedQuery = normalizedTerms(query).join(" ");
  if (!normalizedQuery) return 0;

  const key = normalizeForCitationSearch(entry.key);
  const title = normalizeForCitationSearch(entry.title);
  const author = normalizeForCitationSearch(citationPeople(entry));
  const venue = normalizeForCitationSearch(citationVenue(entry));
  const searchable = normalizeForCitationSearch(citationCompletionFilterText(entry));

  if (key === normalizedQuery) return 100;
  if (key.startsWith(normalizedQuery)) return 95;
  if (key.includes(normalizedQuery)) return 90;
  if (title.startsWith(normalizedQuery)) return 85;
  if (title.includes(normalizedQuery)) return 80;
  if (author.includes(normalizedQuery)) return 70;
  if (venue.includes(normalizedQuery)) return 60;
  if (searchable.includes(normalizedQuery)) return 50;
  return 30;
}

function citationPeople(entry: CitationEntry): string | undefined {
  return entry.author ?? entry.editor;
}

function citationVenue(entry: CitationEntry): string | undefined {
  return (
    entry.journal ??
    entry.booktitle ??
    entry.publisher ??
    entry.school ??
    entry.institution
  );
}

function uniqueCitationParts(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = normalizeForCitationSearch(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function normalizedTerms(query: string): string[] {
  return normalizeForCitationSearch(query).split(" ").filter(Boolean);
}

function normalizeForCitationSearch(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\\[A-Za-z]+\*?/g, " ")
    .replace(/\\/g, " ")
    .replace(/[{}()[\]"'`,.;:!?/|+=_*^-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function letters(value: string): string[] {
  return value.split("");
}
