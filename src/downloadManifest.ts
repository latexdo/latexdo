import type { UpdateCheckResult } from "./types";

export interface DownloadManifestFile {
  id: string;
  label: string;
  platform: string;
  arch: string;
  filename: string;
  url: string;
  sha256: string;
  size: number;
}

export interface DownloadManifest {
  schemaVersion: 1;
  product: "LatexDo";
  version: string | null;
  publishedAt: string | null;
  commit: string | null;
  repository: string;
  downloadsPage: string;
  files: DownloadManifestFile[];
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const requiredDownloadIds = ["macos-arm64", "macos-x64", "windows-x64"] as const;

export function compareVersionStrings(left: string, right: string): number {
  const leftParts = left.trim().replace(/^v/i, "").split(/[.-]/).filter(Boolean);
  const rightParts = right.trim().replace(/^v/i, "").split(/[.-]/).filter(Boolean);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "0";
    const rightPart = rightParts[index] ?? "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

    if (bothNumeric) {
      if (leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
      }
      continue;
    }

    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function validateDownloadManifest(value: unknown): DownloadManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const manifest = value as Partial<DownloadManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.product !== "LatexDo" ||
    (manifest.version !== null && typeof manifest.version !== "string") ||
    typeof manifest.repository !== "string" ||
    typeof manifest.downloadsPage !== "string" ||
    !Array.isArray(manifest.files)
  ) {
    return null;
  }

  const files = manifest.files.filter(isValidManifestFile);
  const ids = new Set(files.map((file) => file.id));
  if (!requiredDownloadIds.every((id) => ids.has(id))) {
    return null;
  }

  return {
    schemaVersion: 1,
    product: "LatexDo",
    version: manifest.version ?? null,
    publishedAt: typeof manifest.publishedAt === "string" ? manifest.publishedAt : null,
    commit: typeof manifest.commit === "string" ? manifest.commit : null,
    repository: manifest.repository,
    downloadsPage: manifest.downloadsPage,
    files,
  };
}

export function updateCheckFromDownloadManifest(
  manifest: DownloadManifest | null,
  currentVersion: string,
  fallbackUrl: string,
): UpdateCheckResult {
  const latestVersion = manifest?.version?.replace(/^v/i, "") ?? null;
  if (!manifest || !latestVersion) {
    return {
      currentVersion,
      latestVersion: null,
      releaseUrl: fallbackUrl,
      updateAvailable: false,
      error: "No website download manifest version found.",
    };
  }

  return {
    currentVersion,
    latestVersion,
    releaseUrl: manifest.downloadsPage || fallbackUrl,
    updateAvailable: compareVersionStrings(latestVersion, currentVersion) > 0,
  };
}

function isValidManifestFile(value: unknown): value is DownloadManifestFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const file = value as Partial<DownloadManifestFile>;
  return (
    typeof file.id === "string" &&
    typeof file.label === "string" &&
    typeof file.platform === "string" &&
    typeof file.arch === "string" &&
    typeof file.filename === "string" &&
    typeof file.url === "string" &&
    typeof file.sha256 === "string" &&
    sha256Pattern.test(file.sha256) &&
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size > 0
  );
}
