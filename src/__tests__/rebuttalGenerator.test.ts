import { describe, expect, it } from "vitest";
import { generateRebuttalLetter } from "../rebuttalGenerator";
import type { RebuttalGeneratorSettings, RebuttalItem } from "../types";

const settings: RebuttalGeneratorSettings = {
  manuscriptId: "D-1",
  manuscriptTitle: "A Test Manuscript",
  fontSize: "11pt",
  paperSize: "a4paper",
  fontFamily: "newpx",
  includeDiff: true,
  diffOldFile: "old.tex",
  diffNewFile: "new.tex",
  diffOutput: "diff.tex",
  summaryText: "Summary.",
  useOnehalfSpacing: false,
  colorPrimary: "1E1E1E",
  colorAccent: "D9D9D9",
};

describe("generateRebuttalLetter", () => {
  it("renders text, reviewer comment, author answer, and diff in order", () => {
    const item: RebuttalItem = {
      id: "1",
      originalText: "The old claim.",
      revisedText: "The revised claim.",
      reviewerComment: "Please clarify the claim.",
      authorComment: "We clarified the claim.",
      modificationMade: "The revised claim.",
    };

    const tex = generateRebuttalLetter([item], settings);
    const textIndex = tex.indexOf("\\begin{OriginalText}");
    const reviewerIndex = tex.indexOf("\\begin{ReviewerComment}");
    const answerIndex = tex.indexOf("\\begin{AuthorResponse}");
    const diffIndex = tex.indexOf("\\begin{ManuscriptChangeDiff}");

    expect(textIndex).toBeGreaterThan(-1);
    expect(reviewerIndex).toBeGreaterThan(textIndex);
    expect(answerIndex).toBeGreaterThan(reviewerIndex);
    expect(diffIndex).toBeGreaterThan(answerIndex);
    expect(tex).toContain("- The old claim.");
    expect(tex).toContain("+ The revised claim.");
  });

  it("preserves a pasted unified diff as the changes block", () => {
    const item: RebuttalItem = {
      id: "1",
      reviewerComment: "Please update this.",
      authorComment: "Updated.",
      modificationMade: "--- Original\n+++ Revised\n@@ Manuscript change @@\n- old\n+ new",
    };

    const tex = generateRebuttalLetter([item], settings);

    expect(tex).toContain("--- Original\n+++ Revised\n@@ Manuscript change @@\n- old\n+ new");
  });
});
