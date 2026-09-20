import { describe, expect, it } from "vitest";
import {
  compareLatexDoVersions,
  isBuildReleaseSlugForVersion,
  isReleaseSlugForVersion,
  normalizeLatexDoVersion,
  versionsEquivalent,
} from "./versions.js";

describe("normalizeLatexDoVersion", () => {
  it("normalizes plain marketing versions", () => {
    expect(normalizeLatexDoVersion("0.3.0")).toEqual({
      core: ["0", "3", "0"],
      prerelease: [],
    });
  });

  it("strips the v prefix", () => {
    expect(normalizeLatexDoVersion("v0.3.0")).toEqual({
      core: ["0", "3", "0"],
      prerelease: [],
    });
    expect(normalizeLatexDoVersion("V1.2.3")).toEqual({
      core: ["1", "2", "3"],
      prerelease: [],
    });
  });

  it("parses prerelease and build segments from build release slugs", () => {
    expect(normalizeLatexDoVersion("0.3.0-build.180.1.38c0f1f5e28d")).toEqual({
      core: ["0", "3", "0"],
      prerelease: ["build", "180", "1", "38c0f1f5e28d"],
    });
    expect(normalizeLatexDoVersion("v0.3.0-build.180.1.38c0f1f5e28d")).toEqual({
      core: ["0", "3", "0"],
      prerelease: ["build", "180", "1", "38c0f1f5e28d"],
    });
  });
});

describe("compareLatexDoVersions", () => {
  it("ranks higher core versions above lower ones", () => {
    expect(compareLatexDoVersions("0.4.0", "0.3.0")).toBeGreaterThan(0);
    expect(compareLatexDoVersions("0.3.0", "0.4.0")).toBeLessThan(0);
    expect(compareLatexDoVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("distinguishes build metadata when both sides carry it", () => {
    expect(
      compareLatexDoVersions("0.3.0-build.181", "0.3.0-build.180"),
    ).toBeGreaterThan(0);
    expect(compareLatexDoVersions("0.3.0-build.180", "0.3.0-build.181")).toBeLessThan(
      0,
    );
    expect(compareLatexDoVersions("0.3.0-build.180", "0.3.0-build.180")).toBe(0);
  });

  it("ranks the plain release above a prerelease of the same core", () => {
    expect(compareLatexDoVersions("0.3.0", "0.3.0-build.180")).toBeGreaterThan(0);
  });

  it("compares prerelease segments numerically where possible", () => {
    expect(compareLatexDoVersions("0.3.0-rc.2", "0.3.0-rc.10")).toBeLessThan(0);
  });

  it("treats leading v prefixes as insignificant", () => {
    expect(compareLatexDoVersions("v0.3.0", "0.3.0")).toBe(0);
  });
});

describe("versionsEquivalent", () => {
  it("accepts identical versions", () => {
    expect(versionsEquivalent("0.3.0", "0.3.0")).toBe(true);
    expect(versionsEquivalent("0.3.0", "v0.3.0")).toBe(true);
  });

  it("rejects versions with different cores", () => {
    expect(versionsEquivalent("0.2.0", "0.3.0")).toBe(false);
  });

  it("rejects build differences", () => {
    expect(versionsEquivalent("0.3.0-build.180", "0.3.0-build.181")).toBe(false);
    expect(versionsEquivalent("0.3.0", "0.3.0-build.180")).toBe(false);
  });
});

describe("release slug helpers", () => {
  it("accepts plain and build slugs for a version", () => {
    expect(isReleaseSlugForVersion("v0.3.0", "0.3.0")).toBe(true);
    expect(isReleaseSlugForVersion("v0.3.0-build.180.1.38c0f1f5e28d", "0.3.0")).toBe(
      true,
    );
    expect(
      isBuildReleaseSlugForVersion("v0.3.0-build.180.1.38c0f1f5e28d", "0.3.0"),
    ).toBe(true);
  });

  it("rejects slugs for the wrong version", () => {
    expect(isReleaseSlugForVersion("v0.4.0", "0.3.0")).toBe(false);
    expect(isReleaseSlugForVersion("v0.3.0-build.180.1.38c0f1f5e28d", "0.4.0")).toBe(
      false,
    );
    expect(isBuildReleaseSlugForVersion("v0.3.0", "0.3.0")).toBe(false);
  });
});
