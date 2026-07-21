// Ranks bibliography entries against a passage of the user's prose so the AI —
// or the graph UI — can suggest which papers to \cite where. Deterministic and
// dependency-free: it scores token overlap between the passage and each entry's
// title / authors / venue, then boosts on-topic papers that are not cited yet.

import type { CitationEntry } from "../../latex/latexIndex";
import { titleTokens } from "./knowledgeGraph";

export interface CitationRecommendation {
  key: string;
  /** 0..1 relevance score. */
  score: number;
  reasons: string[];
  entry: CitationEntry;
  alreadyCited: boolean;
}

export interface RecommendOptions {
  /** Keys already cited in the surrounding text; recommended near-ties break toward uncited ones. */
  citedKeys?: Iterable<string>;
  /** Maximum number of recommendations to return. */
  limit?: number;
  /** Minimum score (0..1) to include. */
  minScore?: number;
}

const passageStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was",
  "we", "were", "with", "which", "these", "those", "our", "their", "such",
  "can", "has", "have", "been", "also", "more", "than", "then", "they",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-preserving surname extraction, so author matches stay proper-noun precise. */
function rawLastNames(author: string | undefined): string[] {
  if (!author) return [];
  return author
    .split(/\s+and\s+/i)
    .map((name) => {
      const cleaned = name.replace(/[{}]/g, "").trim();
      const last = cleaned.includes(",")
        ? cleaned.split(",")[0].trim()
        : cleaned.split(/\s+/).filter(Boolean).pop() ?? "";
      return last.replace(/[^A-Za-z-]/g, "");
    })
    .filter((name) => name.length >= 2);
}

function passageTokens(passage: string): Map<string, number> {
  const counts = new Map<string, number>();
  const tokens = passage
    .toLowerCase()
    .replace(/\\[a-z]+\s*(\[[^\]]*\])?(\{[^}]*\})?/gi, " ") // strip latex commands + args
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3 && !passageStopWords.has(token));
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * Recommend citations for a passage. Higher score = stronger topical match with
 * the passage's vocabulary. Authors mentioned by surname in the passage are a
 * strong signal; title-term overlap is the main one.
 */
export function recommendCitations(
  passage: string,
  entries: CitationEntry[],
  options: RecommendOptions = {},
): CitationRecommendation[] {
  const limit = options.limit ?? 8;
  const minScore = options.minScore ?? 0.05;
  const citedSet = new Set(options.citedKeys ?? []);

  const tokens = passageTokens(passage);
  if (tokens.size === 0) return [];
  const passageTokenSet = new Set(tokens.keys());

  const seen = new Set<string>();
  const recommendations: CitationRecommendation[] = [];

  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);

    const reasons: string[] = [];
    let score = 0;

    // Title term overlap — the primary signal.
    const entryTitleTokens = titleTokens(entry.title);
    const matchedTitleTerms: string[] = [];
    for (const token of entryTitleTokens) {
      if (passageTokenSet.has(token)) matchedTitleTerms.push(token);
    }
    if (matchedTitleTerms.length > 0 && entryTitleTokens.size > 0) {
      const coverage = matchedTitleTerms.length / entryTitleTokens.size;
      score += 0.7 * coverage + 0.15 * Math.min(matchedTitleTerms.length, 4);
      reasons.push(`Title terms: ${matchedTitleTerms.slice(0, 4).join(", ")}`);
    }

    // Author surname mentioned in the passage — a strong, precise signal.
    // Matched case-sensitively as a whole word against the raw passage so a
    // capitalized surname like "He" or "Li" hits without colliding with the
    // lowercase pronoun.
    const matchedAuthors = rawLastNames(entry.author).filter((last) =>
      new RegExp(`\\b${escapeRegExp(last)}\\b`).test(passage),
    );
    if (matchedAuthors.length > 0) {
      score += 0.4 * Math.min(matchedAuthors.length, 2);
      reasons.push(`Author mentioned: ${matchedAuthors.slice(0, 2).join(", ")}`);
    }

    // Venue term overlap — a weak supporting signal.
    const venue = entry.journal ?? entry.booktitle ?? entry.publisher;
    if (venue) {
      const venueTokens = new Set(
        venue
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .split(" ")
          .filter((token) => token.length >= 4),
      );
      let venueHits = 0;
      for (const token of venueTokens) {
        if (passageTokenSet.has(token)) venueHits += 1;
      }
      if (venueHits > 0) {
        score += 0.1 * Math.min(venueHits, 2);
        reasons.push("Venue matches passage");
      }
    }

    if (score < minScore) continue;

    const alreadyCited = citedSet.has(entry.key);
    // Nudge uncited-but-relevant papers up: the point is to surface citations
    // the author hasn't added yet, without hiding ones they already used.
    const adjustedScore = alreadyCited ? score * 0.85 : score;

    recommendations.push({
      key: entry.key,
      score: Number(Math.min(1, adjustedScore).toFixed(3)),
      reasons,
      entry,
      alreadyCited,
    });
  }

  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Format a ranked list as plain text for the AI tool result / logs. */
export function formatRecommendations(
  recommendations: CitationRecommendation[],
): string {
  if (recommendations.length === 0) {
    return "No matching references found in the bibliography for this passage.";
  }
  return recommendations
    .map((rec, index) => {
      const title = rec.entry.title ?? "(untitled)";
      const cited = rec.alreadyCited ? " [already cited]" : "";
      const reasons = rec.reasons.length ? ` — ${rec.reasons.join("; ")}` : "";
      return `${index + 1}. \\cite{${rec.key}} (score ${rec.score})${cited}\n   ${title}${reasons}`;
    })
    .join("\n");
}
