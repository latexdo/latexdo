import { describe, expect, it } from "vitest";
import {
  buildLatexFoldingRanges,
  extractLatexOutline,
  findLatexDocumentLinkAtOffset,
  findLatexDocumentLinks,
  formatLatexTableAtOffset,
  latexCommandSnippets,
} from "../editorFeatureSupport";

describe("editor feature support", () => {
  it("detects LaTeX href/url commands and literal web links", () => {
    const source = [
      "\\href{https://latexdo.org/downloads/}{downloads}",
      "See \\url{www.example.com} and https://example.org/docs.",
      "@misc{k, url={example.com/paper}, doi={10.1000/abc.def}}",
      "Bare DOI doi:10.2000/raw.",
    ].join("\n");

    const links = findLatexDocumentLinks(source);

    expect(links.map((link) => link.url)).toEqual([
      "https://latexdo.org/downloads/",
      "https://www.example.com",
      "https://example.org/docs",
      "https://example.com/paper",
      "https://doi.org/10.1000/abc.def",
      "https://doi.org/10.2000/raw",
    ]);
    expect(
      findLatexDocumentLinkAtOffset(source, source.indexOf("downloads")),
    ).toMatchObject({ url: "https://latexdo.org/downloads/" });
    expect(
      findLatexDocumentLinkAtOffset(source, source.indexOf("example.com/paper")),
    ).toMatchObject({ url: "https://example.com/paper" });
    expect(
      findLatexDocumentLinkAtOffset(source, source.indexOf("10.1000/abc.def")),
    ).toMatchObject({ url: "https://doi.org/10.1000/abc.def" });
  });

  it("builds folding ranges for sections, environments, and comment blocks", () => {
    const source = [
      "% first",
      "% second",
      "\\section{Intro}",
      "Text",
      "\\begin{figure}",
      "\\caption{A}",
      "\\end{figure}",
      "\\section{Next}",
      "More",
    ].join("\n");

    const ranges = buildLatexFoldingRanges(source);

    expect(ranges).toContainEqual({ start: 1, end: 2, kind: "comment" });
    expect(ranges).toContainEqual({ start: 3, end: 7, kind: "region" });
    expect(ranges).toContainEqual({ start: 5, end: 7, kind: "region" });
  });

  it("extracts a live document outline", () => {
    const outline = extractLatexOutline(
      "\\section{Intro}\n\\subsection{Method}\n\\begin{figure}\n\\end{figure}",
    );

    expect(outline.map((item) => [item.detail, item.label, item.line])).toEqual([
      ["\\section", "Intro", 1],
      ["\\subsection", "Method", 2],
      ["\\begin{figure}", "figure", 3],
    ]);
  });

  it("formats the surrounding tabular block at the cursor", () => {
    const source = [
      "\\begin{tabular}{lrr}",
      "Name & Value & Note \\\\",
      "Longer name & 2 & ok \\\\",
      "\\end{tabular}",
    ].join("\n");

    const result = formatLatexTableAtOffset(source, source.indexOf("Value"));

    expect(result?.text).toContain("Name        & Value & Note \\\\");
    expect(result?.text).toContain("Longer name & 2     & ok \\\\");
  });

  it("includes production snippets for wizards, tables, formulas, and Asymptote", () => {
    const labels = new Set(latexCommandSnippets.map((snippet) => snippet.label));

    expect([...labels]).toEqual(
      expect.arrayContaining(["beamer", "letter", "tabular", "array", "asy"]),
    );
    expect(latexCommandSnippets.length).toBeGreaterThan(50);
  });
});
