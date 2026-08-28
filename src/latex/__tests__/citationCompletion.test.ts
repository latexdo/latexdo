import { describe, expect, it } from "vitest";
import {
  citationCompletionDetail,
  citationCompletionFilterText,
  citationCompletionTriggerCharacters,
  rankedCitationCompletions,
} from "../citationCompletion";
import type { CitationEntry } from "../latexIndex";

const entries: CitationEntry[] = [
  {
    key: "borning1981thinglab",
    type: "article",
    title: "The Programming Language Aspects of ThingLab",
    author: "Alan Borning",
    year: "1981",
    journal: "ACM Transactions on Programming Languages and Systems",
    doi: "10.1145/357146.357150",
    sourceFile: "refs.bib",
  },
  {
    key: "compArchitecture",
    type: "inproceedings",
    title: "A Lazy and Heuristic-Driven Code-Completion Architecture",
    author: "Omar Example and Jane Researcher",
    year: "2026",
    booktitle: "International Conference on Software Language Engineering",
    sourceFile: "references.bib",
  },
];

describe("citationCompletion", () => {
  it("matches citation completions by title words, not only by key", () => {
    const ranked = rankedCitationCompletions(entries, "lazy heuristic architecture");

    expect(ranked.map((entry) => entry.key)).toEqual(["compArchitecture"]);
  });

  it("matches citation completions by author, year, venue, and DOI", () => {
    expect(
      rankedCitationCompletions(entries, "borning").map((entry) => entry.key),
    ).toEqual(["borning1981thinglab"]);
    expect(
      rankedCitationCompletions(entries, "2026 researcher").map((entry) => entry.key),
    ).toEqual(["compArchitecture"]);
    expect(
      rankedCitationCompletions(entries, "software language engineering").map(
        (entry) => entry.key,
      ),
    ).toEqual(["compArchitecture"]);
    expect(
      rankedCitationCompletions(entries, "357150").map((entry) => entry.key),
    ).toEqual(["borning1981thinglab"]);
  });

  it("builds visible citation metadata while keeping the insert text as the key", () => {
    const entry = entries[1]!;

    expect(citationCompletionFilterText(entry)).toContain(
      "A Lazy and Heuristic-Driven Code-Completion Architecture",
    );
    expect(citationCompletionFilterText(entry)).toContain(
      "lazy and heuristic driven code completion architecture",
    );
    expect(citationCompletionFilterText(entry)).toContain(
      "lazyandheuristicdrivencodecompletionarchitecture",
    );
    expect(citationCompletionDetail(entry)).toContain(
      "A Lazy and Heuristic-Driven Code-Completion Architecture",
    );
  });

  it("exports citation trigger characters for normal title typing", () => {
    expect(citationCompletionTriggerCharacters).toEqual(
      expect.arrayContaining(["l", "H", "2", " ", "-", ".", "/", "_"]),
    );
  });
});
