import { describe, expect, it } from "vitest";
import {
  buildReviewerCommentInsertion,
  normalizeLatexDoReviewMarkup,
  usesLatexDoReviewMacros,
} from "../reviewMarkup";

describe("review markup", () => {
  it("cleans old reviewercomment wrappers with citations and trailing punctuation", () => {
    const source =
      "\\reviewercomment{Code completion helps developers~\\cite{Wang23a, Izdai24a}}{Add your comment here...}.";

    expect(normalizeLatexDoReviewMarkup(source)).toBe(
      "Code completion helps developers~\\cite{Wang23a, Izdai24a}.\n" +
        "\\latexdoreviewercomment{Add your comment here...}\n",
    );
  });

  it("keeps selected punctuation with the sentence when inserting a comment block", () => {
    const insertion = buildReviewerCommentInsertion(
      "Code completion helps developers~\\cite{Wang23a, Izdai24a}",
      "Add your comment here...",
      ". ",
    );

    expect(insertion.consumedCharacterCount).toBe(2);
    expect(insertion.text).toBe(
      "Code completion helps developers~\\cite{Wang23a, Izdai24a}.\n" +
        "\\latexdoreviewercomment{Add your comment here...}\n",
    );
  });

  it("detects old and new LatexDo review commands", () => {
    expect(usesLatexDoReviewMacros("\\reviewercomment{text}{comment}")).toBe(true);
    expect(usesLatexDoReviewMacros("\\latexdoreviewercomment{comment}")).toBe(true);
    expect(usesLatexDoReviewMacros("plain text")).toBe(false);
  });
});
