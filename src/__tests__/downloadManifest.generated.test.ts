import { describe, expect, it } from "vitest";
import {
  compareVersionStrings,
  updateCheckFromDownloadManifest,
  validateDownloadManifest,
  type DownloadManifest,
} from "../downloadManifest";

const fallbackUrl = "https://latexdo.org/downloads/";
const sha256 = "a".repeat(64);

function manifest(version: string | null): DownloadManifest {
  return {
    schemaVersion: 1,
    product: "LatexDo",
    version,
    publishedAt: "2026-06-27T00:00:00.000Z",
    commit: "abc123",
    repository: "latexdo/latexdo",
    downloadsPage: fallbackUrl,
    files: [
      {
        id: "macos-arm64",
        label: "macOS Apple Silicon",
        platform: "macos",
        arch: "arm64",
        filename: "LatexDo-macos-arm64.dmg",
        url: `${fallbackUrl}files/LatexDo-macos-arm64.dmg`,
        sha256,
        size: 128,
      },
      {
        id: "macos-x64",
        label: "macOS Intel",
        platform: "macos",
        arch: "x64",
        filename: "LatexDo-macos-x64.dmg",
        url: `${fallbackUrl}files/LatexDo-macos-x64.dmg`,
        sha256,
        size: 128,
      },
      {
        id: "windows-x64",
        label: "Windows",
        platform: "windows",
        arch: "x64",
        filename: "LatexDo-windows-x64.exe",
        url: `${fallbackUrl}files/LatexDo-windows-x64.exe`,
        sha256,
        size: 128,
      },
    ],
  };
}

const updateCases = Array.from({ length: 2100 }, (_, index) => {
  const major = 1 + (index % 24);
  const minor = Math.floor(index / 24) % 30;
  const patch = Math.floor(index / (24 * 30));
  const currentVersion = `${major}.${minor}.${patch}`;
  const latestVersion =
    index % 3 === 0
      ? `${major}.${minor}.${patch + 1}`
      : index % 3 === 1
        ? `${major}.${minor}.${patch}`
        : `${Math.max(0, major - 1)}.${minor}.${patch}`;
  return {
    currentVersion,
    latestVersion,
    shouldUpdate: compareVersionStrings(latestVersion, currentVersion) > 0,
  };
});

describe("download manifest generated update matrix", () => {
  it.each(updateCases)(
    "case %# current=$currentVersion latest=$latestVersion update=$shouldUpdate",
    ({ currentVersion, latestVersion, shouldUpdate }) => {
      const validManifest = validateDownloadManifest(manifest(latestVersion));
      const result = updateCheckFromDownloadManifest(
        validManifest,
        currentVersion,
        fallbackUrl,
      );

      expect(validManifest).not.toBeNull();
      expect(result.latestVersion).toBe(latestVersion);
      expect(result.releaseUrl).toBe(fallbackUrl);
      expect(result.updateAvailable).toBe(shouldUpdate);
    },
  );

  it("rejects a manifest without every required installer", () => {
    const incomplete = manifest("2.0.0");
    incomplete.files = incomplete.files.filter((file) => file.id !== "windows-x64");

    expect(validateDownloadManifest(incomplete)).toBeNull();
  });

  it("rejects a manifest with invalid SHA-256 data", () => {
    const invalid = manifest("2.0.0");
    invalid.files[0] = { ...invalid.files[0], sha256: "not-a-checksum" };

    expect(validateDownloadManifest(invalid)).toBeNull();
  });
});
