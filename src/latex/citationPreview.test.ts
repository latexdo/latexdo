import { describe, expect, it } from "vitest";
import type { CitationEntry } from "./latexIndex";
import {
  findCitationKeyAtLatexPosition,
  formatCitationBibliographyLine,
  formatCitationHoverMarkdown,
  formatMissingCitationHoverMarkdown,
} from "./citationPreview";

const entry: CitationEntry = {
  key: "knuth84",
  type: "article",
  title: "The TeXbook",
  author: "Donald Knuth",
  year: "1984",
  journal: "Computers and Typesetting",
  doi: "10.1000/texbook",
  sourceFile: "refs.bib",
};

describe("citation preview", () => {
  it("finds the key under the cursor inside multi-key citations", () => {
    const line = "Prior work \\citep[see][p. 4]{knuth84, smith20}.";

    expect(findCitationKeyAtLatexPosition(line, line.indexOf("knuth84") + 3)).toEqual({
      key: "knuth84",
      startColumn: line.indexOf("knuth84") + 1,
      endColumn: line.indexOf("knuth84") + "knuth84".length + 1,
    });
    expect(findCitationKeyAtLatexPosition(line, line.indexOf("smith20") + 4)).toEqual({
      key: "smith20",
      startColumn: line.indexOf("smith20") + 1,
      endColumn: line.indexOf("smith20") + "smith20".length + 1,
    });
  });

  it("does not match text outside citation keys", () => {
    expect(findCitationKeyAtLatexPosition("plain text cite{knuth84}", 18)).toBeNull();
    expect(findCitationKeyAtLatexPosition("\\cite{knuth84}", 2)).toBeNull();
  });

  it("formats a printed bibliography-style preview", () => {
    expect(formatCitationBibliographyLine(entry)).toBe(
      "Donald Knuth (1984). The TeXbook. Computers and Typesetting. DOI: 10.1000/texbook.",
    );

    const markdown = formatCitationHoverMarkdown(entry);
    expect(markdown).toContain("Bibliography preview");
    expect(markdown).toContain("The TeXbook");
    expect(markdown).toContain("Donald Knuth");
    expect(markdown).toContain("10\\.1000/texbook");
    expect(markdown).toContain("`knuth84` from `refs.bib`");
  });

  it("formats missing citation key hovers", () => {
    expect(formatMissingCitationHoverMarkdown("unknown2026")).toBe(
      "**Missing bibliography entry**\n\nNo .bib entry found for `unknown2026`.",
    );
  });
});
