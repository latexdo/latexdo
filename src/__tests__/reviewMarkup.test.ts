import { describe, expect, it } from "vitest";
import {
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
});
