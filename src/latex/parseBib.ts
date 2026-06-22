import bibtexParse from "bibtex-parse-js";
import type { CitationEntry } from "./latexIndex";

type ParsedBibEntry = {
  citationKey?: string;
  entryType?: string;
  entryTags?: Record<string, unknown>;
};

function cleanBibValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function parseBibFile(content: string, sourceFile: string): CitationEntry[] {
  const parsed = bibtexParse.toJSON(content) as ParsedBibEntry[];
  return parsed
    .filter((entry): entry is ParsedBibEntry & { citationKey: string } =>
      Boolean(entry.citationKey),
    )
    .map((entry) => {
      const tags = entry.entryTags ?? {};
      return {
        key: entry.citationKey,
        type: entry.entryType ?? "unknown",
        title: cleanBibValue(tags.title),
        author: cleanBibValue(tags.author),
        editor: cleanBibValue(tags.editor),
        year: cleanBibValue(tags.year),
        journal: cleanBibValue(tags.journal),
        booktitle: cleanBibValue(tags.booktitle),
        publisher: cleanBibValue(tags.publisher),
        school: cleanBibValue(tags.school),
        institution: cleanBibValue(tags.institution),
        doi: cleanBibValue(tags.doi),
        url: cleanBibValue(tags.url),
        eprint: cleanBibValue(tags.eprint),
        archivePrefix: cleanBibValue(tags.archivePrefix),
        howpublished: cleanBibValue(tags.howpublished),
        note: cleanBibValue(tags.note),
        raw: entry.entryTags ? JSON.stringify(entry.entryTags, null, 2) : undefined,
        sourceFile,
      } as CitationEntry;
    });
}
