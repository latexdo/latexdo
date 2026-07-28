import type { CitationEntry } from "./latexIndex";
import { citationVenue } from "./citationAnalysis";

export type CitationKeyPosition = {
  key: string;
  startColumn: number;
  endColumn: number;
};

export type CitationExternalLink = {
  label: string;
  url: string;
};

const citationCommandAtLineRegex =
  /\\(?:cite|citep|citet|citealp|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|supercite)[a-zA-Z]*\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|-])/g, "\\$1");
}

function inlineCode(value: string): string {
  const escapedValue = value.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
  return `\`${escapedValue}\``;
}

function markdownLink(label: string, url: string): string {
  return `[${escapeMarkdown(label)}](<${url.replace(/>/g, "%3E")}>)`;
}

export function formatCitationPeople(entry: CitationEntry): string {
  return entry.author ?? entry.editor ?? "Unknown author";
}

export function citationSearchText(entry: CitationEntry): string {
  return [
    entry.key,
    entry.type,
    entry.title,
    entry.author,
    entry.editor,
    entry.year,
    entry.journal,
    entry.booktitle,
    entry.publisher,
    entry.school,
    entry.institution,
    entry.doi,
    entry.url,
    entry.eprint,
    entry.sourceFile,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function citationExternalLinks(entry: CitationEntry): CitationExternalLink[] {
  const links: CitationExternalLink[] = [];
  const doi = entry.doi?.trim();
  if (doi) {
    const normalizedDoi = doi
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:/i, "")
      .trim();
    if (normalizedDoi) {
      links.push({
        label: "DOI",
        url: `https://doi.org/${encodeURIComponent(normalizedDoi).replace(
          /%2F/g,
          "/",
        )}`,
      });
    }
  }

  const url = entry.url?.trim();
  if (url) {
    links.push({
      label: "URL",
      url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
    });
  }

  const eprint = entry.eprint?.trim();
  if (eprint) {
    const archivePrefix = entry.archivePrefix?.trim();
    links.push({
      label: archivePrefix || "eprint",
      url:
        archivePrefix?.toLowerCase() === "arxiv"
          ? `https://arxiv.org/abs/${encodeURIComponent(eprint)}`
          : /^https?:\/\//i.test(eprint)
            ? eprint
            : `https://www.google.com/search?q=${encodeURIComponent(eprint)}`,
    });
  }

  return links;
}

export function formatCitationBibliographyLine(entry: CitationEntry): string {
  const people = formatCitationPeople(entry);
  const year = entry.year ? ` (${entry.year})` : "";
  const title = entry.title || "Untitled reference";
  const venue = citationVenue(entry);
  const venueText = venue === "No venue" ? "" : ` ${venue}.`;
  const identifier = entry.doi
    ? ` DOI: ${entry.doi}.`
    : entry.url
      ? ` ${entry.url}.`
      : entry.eprint
        ? ` ${entry.eprint}.`
        : "";

  return `${people}${year}. ${title}.${venueText}${identifier}`
    .replace(/\s+/g, " ")
    .trim();
}

export function formatCitationHoverMarkdown(entry: CitationEntry): string {
  const venue = citationVenue(entry);
  const details = [
    entry.type ? escapeMarkdown(entry.type.toUpperCase()) : "Citation",
    entry.year ? escapeMarkdown(entry.year) : undefined,
    venue !== "No venue" ? escapeMarkdown(venue) : undefined,
  ].filter(Boolean);

  const links = citationExternalLinks(entry);
  const identifier = links.length
    ? links.map((link) => markdownLink(link.label, link.url)).join(" · ")
    : entry.eprint
      ? `eprint: ${escapeMarkdown(entry.eprint)}`
      : undefined;

  return [
    "**Bibliography preview**",
    `**${escapeMarkdown(entry.title || "Untitled reference")}**`,
    `${escapeMarkdown(formatCitationPeople(entry))}${
      entry.year ? ` (${escapeMarkdown(entry.year)})` : ""
    }`,
    details.length ? details.join(" · ") : undefined,
    identifier,
    "",
    `${inlineCode(entry.key)} from ${inlineCode(entry.sourceFile)}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n\n");
}

export function formatMissingCitationHoverMarkdown(key: string): string {
  return `**Missing bibliography entry**\n\nNo .bib entry found for ${inlineCode(key)}.`;
}

export function findCitationKeyAtLatexPosition(
  lineContent: string,
  column: number,
): CitationKeyPosition | null {
  const offset = Math.max(0, column - 1);
  citationCommandAtLineRegex.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = citationCommandAtLineRegex.exec(lineContent)) !== null) {
    const commandText = match[0];
    const keysText = match[1];
    const keysStartOffset = match.index + commandText.lastIndexOf("{") + 1;
    const keysEndOffset = keysStartOffset + keysText.length;
    if (offset < keysStartOffset || offset > keysEndOffset) {
      continue;
    }

    for (const keyMatch of keysText.matchAll(/[^,]+/g)) {
      const rawKey = keyMatch[0];
      const key = rawKey.trim();
      if (!key) {
        continue;
      }

      const leadingWhitespace = rawKey.length - rawKey.trimStart().length;
      const keyStartOffset = keysStartOffset + keyMatch.index + leadingWhitespace;
      const keyEndOffset = keyStartOffset + key.length;
      if (offset >= keyStartOffset && offset <= keyEndOffset) {
        return {
          key,
          startColumn: keyStartOffset + 1,
          endColumn: keyEndOffset + 1,
        };
      }
    }
  }

  return null;
}
