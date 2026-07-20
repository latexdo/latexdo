import { describe, it, expect } from "vitest";
import {
  generateScholarToken,
  tokenCodename,
  buildResearchContext,
  normalizeResearcherProfile,
  defaultResearcherProfile,
} from "./researcherProfile";

describe("generateScholarToken", () => {
  it("produces a cool-but-strong token: sch-<adj>-<noun>-<base32>", () => {
    const token = generateScholarToken();
    expect(token).toMatch(/^sch-[a-z]+-[a-z]+-[0-9A-HJKMNP-TV-Z]{20,}$/);
  });

  it("uses an unambiguous alphabet (no I, L, O, U in the suffix)", () => {
    const suffix = generateScholarToken().split("-").slice(3).join("");
    expect(suffix).not.toMatch(/[ILOU]/);
  });

  it("is effectively unique across many draws", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateScholarToken));
    expect(tokens.size).toBe(500);
  });

  it("tokenCodename returns the memorable middle", () => {
    expect(tokenCodename("sch-cosmic-quokka-7F3KMQ2N9VXAB")).toBe("cosmic-quokka");
  });
});

describe("normalizeResearcherProfile", () => {
  it("always guarantees a token, even from empty input", () => {
    const p = normalizeResearcherProfile({});
    expect(p.token.length).toBeGreaterThan(10);
    expect(p.mode).toBe("anonymous");
  });

  it("preserves an existing token and clamps fields", () => {
    const p = normalizeResearcherProfile({
      mode: "orcid",
      token: "sch-lunar-otter-ABCDEF",
      orcidId: "0000-0002-1825-0097",
      papers: [{ title: "Paper A", year: "2021" }, { title: "" }],
    });
    expect(p.token).toBe("sch-lunar-otter-ABCDEF");
    expect(p.orcidId).toBe("0000-0002-1825-0097");
    expect(p.papers).toHaveLength(1); // empty-title paper dropped
  });
});

describe("buildResearchContext", () => {
  it("returns null when disabled", () => {
    expect(
      buildResearchContext({ ...defaultResearcherProfile, includeInContext: false }),
    ).toBeNull();
  });

  it("summarizes name, affiliation and papers for the agent", () => {
    const context = buildResearchContext({
      ...defaultResearcherProfile,
      mode: "orcid",
      orcidId: "0000-0002-1825-0097",
      displayName: "Ada Lovelace",
      affiliation: "Analytical Engine Lab",
      papers: [{ title: "Notes on the Engine", year: "1843" }],
      includeInContext: true,
    });
    expect(context).toContain("Ada Lovelace");
    expect(context).toContain("Analytical Engine Lab");
    expect(context).toContain("Notes on the Engine");
    expect(context).toContain("1843");
  });
});
