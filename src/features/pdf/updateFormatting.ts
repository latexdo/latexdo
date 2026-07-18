import type { UpdateDownloadProgress } from "../../types";

export const updateCheckIntervalMs = 6 * 60 * 60 * 1000;

export function formatUpdateDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatUpdateLocation(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return null;
  }
}

export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = Number.isInteger(value) || value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatUpdateProgress(progress: UpdateDownloadProgress): string {
  const fallback = progress.message ?? "Preparing update";
  if (progress.status !== "downloading") {
    return fallback;
  }

  const parts: string[] = [];
  if (progress.percent !== null) {
    parts.push(`${Math.round(progress.percent)}%`);
  }
  if (progress.totalBytes !== null) {
    parts.push(
      `${formatUpdateBytes(progress.transferredBytes)} of ${formatUpdateBytes(
        progress.totalBytes,
      )}`,
    );
  } else if (progress.transferredBytes > 0) {
    parts.push(formatUpdateBytes(progress.transferredBytes));
  }

  return parts.length ? `${fallback} (${parts.join(", ")})` : fallback;
}
