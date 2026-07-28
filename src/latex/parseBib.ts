import bibtexParse from "bibtex-parse";
import type { CitationEntry } from "./latexIndex";

type ParsedBibEntry = {
  key?: string;
  type?: string;
  [field: string]: unknown;
};

const maxBibtexSourceLength = 2 * 1024 * 1024;
const maxBibtexEntries = 10_000;

function cleanBibValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function cleanBibFieldValue(
  entry: ParsedBibEntry,
  fieldName: string,
): string | undefined {
  return cleanBibValue(
    entry[fieldName] ??
      entry[fieldName.toUpperCase()] ??
      entry[fieldName.toLowerCase()] ??
      Object.entries(entry).find(
        ([key]) => key.toLowerCase() === fieldName.toLowerCase(),
      )?.[1],
  );
}

export function parseBibFile(content: string, sourceFile: string): CitationEntry[] {
  if (content.length > maxBibtexSourceLength) return [];

  let parsed: ParsedBibEntry[];
  try {
    parsed = bibtexParse.entries(content, { number: "string" });
  } catch {
    return [];
  }

  return parsed
    .slice(0, maxBibtexEntries)
    .filter((entry): entry is ParsedBibEntry & { key: string } => Boolean(entry.key))
    .map((entry) => {
      const tags = entry;
      return {
        key: entry.key,
        type: entry.type ?? "unknown",
        title: cleanBibFieldValue(tags, "TITLE"),
        author: cleanBibFieldValue(tags, "AUTHOR"),
        editor: cleanBibFieldValue(tags, "EDITOR"),
        year: cleanBibFieldValue(tags, "YEAR"),
        journal: cleanBibFieldValue(tags, "JOURNAL"),
        booktitle: cleanBibFieldValue(tags, "BOOKTITLE"),
        publisher: cleanBibFieldValue(tags, "PUBLISHER"),
        school: cleanBibFieldValue(tags, "SCHOOL"),
        institution: cleanBibFieldValue(tags, "INSTITUTION"),
        doi: cleanBibFieldValue(tags, "DOI"),
        url: cleanBibFieldValue(tags, "URL"),
        eprint: cleanBibFieldValue(tags, "EPRINT"),
        archivePrefix: cleanBibFieldValue(tags, "ARCHIVEPREFIX"),
        howpublished: cleanBibFieldValue(tags, "HOWPUBLISHED"),
        note: cleanBibFieldValue(tags, "NOTE"),
        raw: JSON.stringify(tags, null, 2),
        sourceFile,
      } as CitationEntry;
    });
}
