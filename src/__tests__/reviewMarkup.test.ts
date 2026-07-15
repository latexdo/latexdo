import { describe, expect, it } from "vitest";
import {
  escapeLatexText,
  normalizeLatexDoReviewMarkup,
  usesLatexDoReviewMacros,
} from "../reviewMarkup";

describe("review markup", () => {
  it("cleans old reviewercomment wrappers with citations and trailing punctuation", () => {
    const source =
      "\\reviewercomment{Code completion helps developers~\\cite{Wang23a, Izdai24a}}{Please clarify this claim.}.";

    expect(normalizeLatexDoReviewMarkup(source)).toBe(
      "Code completion helps developers~\\cite{Wang23a, Izdai24a}.\n" +
        "\\latexdoreviewercomment{Please clarify this claim.}\n",
    );
  });

  it("detects old and new LatexDo review commands", () => {
    expect(usesLatexDoReviewMacros("\\reviewercomment{text}{comment}")).toBe(true);
    expect(usesLatexDoReviewMacros("\\latexdoreviewercomment{comment}")).toBe(true);
    expect(usesLatexDoReviewMacros("plain text")).toBe(false);
  });

  it("escapes every LaTeX special character in plain review text", () => {
    expect(escapeLatexText("90% on data_set_A & ref #12 costs $5")).toBe(
      "90\\% on data\\_set\\_A \\& ref \\#12 costs \\$5",
    );
    expect(escapeLatexText("~x^2 {braces} \\cmd")).toBe(
      "\\textasciitilde{}x\\textasciicircum{}2 \\{braces\\} \\textbackslash{}cmd",
    );
  });

  it("does not double-escape already produced output", () => {
    // Single pass over the input: the backslash introduced by escaping is not
    // itself re-escaped.
    expect(escapeLatexText("&")).toBe("\\&");
    expect(escapeLatexText("\\&")).toBe("\\textbackslash{}\\&");
  });
});
