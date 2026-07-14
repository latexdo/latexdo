import type { DocumentHistorySnapshot, OpenDocument } from "../../types";
import { fileName } from "../project/projectUtils";

export const legacyHistoryStorageRelativePath = ".latexdo/history.json";
export const historyIndexRelativePath = ".latexdo/history/recent.json";
export const historySnapshotStorageDirectory = ".latexdo/history/snapshots";

export const maxHistorySnapshotsPerFile = 500;
export const maxHistorySnapshotsInHotIndex = 5000;
export const historyAutoCaptureDelayMs = 5000;

export function historySnapshotId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function historySnapshotContentPath(snapshotId: string): string {
  const safeId = snapshotId.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 96);
  return `${historySnapshotStorageDirectory}/${safeId || "snapshot"}.txt`;
}

export function textHash(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function historyContentPreview(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return (line ?? "Empty document").slice(0, 240);
}

export function snapshotContentKey(snapshot: Partial<DocumentHistorySnapshot>): string {
  if (snapshot.contentHash) return snapshot.contentHash;
  if (typeof snapshot.content === "string") return textHash(snapshot.content);
  return "";
}

export function buildHistorySnapshot(
  document: OpenDocument,
  source: DocumentHistorySnapshot["source"],
): DocumentHistorySnapshot {
  const timestamp = Date.now();
  const sourceLabel =
    source === "manual"
      ? "Manual checkpoint"
      : source === "restore"
        ? "Before restore"
        : "Auto checkpoint";
  const id = historySnapshotId();
  return {
    id,
    filePath: document.relativePath,
    fileName: document.name,
    label: sourceLabel,
    content: document.content,
    contentPath: historySnapshotContentPath(id),
    contentHash: textHash(document.content),
    contentSize: document.content.length,
    preview: historyContentPreview(document.content),
    timestamp,
    source,
  };
}

export function normalizeHistorySnapshot(
  value: unknown,
): DocumentHistorySnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Partial<DocumentHistorySnapshot>;
  if (
    typeof item.id !== "string" ||
    typeof item.filePath !== "string" ||
    (typeof item.content !== "string" && typeof item.contentPath !== "string") ||
    typeof item.timestamp !== "number"
  ) {
    return null;
  }
  const content = typeof item.content === "string" ? item.content : undefined;

  return {
    id: item.id,
    filePath: item.filePath,
    fileName:
      typeof item.fileName === "string" ? item.fileName : fileName(item.filePath),
    label: typeof item.label === "string" ? item.label : "History state",
    content,
    contentPath:
      typeof item.contentPath === "string"
        ? item.contentPath
        : historySnapshotContentPath(item.id),
    contentHash:
      typeof item.contentHash === "string"
        ? item.contentHash
        : content
          ? textHash(content)
          : undefined,
    contentSize:
      typeof item.contentSize === "number"
        ? item.contentSize
        : content
          ? content.length
          : undefined,
    preview:
      typeof item.preview === "string"
        ? item.preview
        : content
          ? historyContentPreview(content)
          : undefined,
    timestamp: item.timestamp,
    source:
      item.source === "manual" || item.source === "restore" || item.source === "auto"
        ? item.source
        : "auto",
  };
}

export function pruneHistorySnapshots(
  snapshots: DocumentHistorySnapshot[],
): DocumentHistorySnapshot[] {
  const sorted = [...snapshots].sort((a, b) => b.timestamp - a.timestamp);
  const perFileCount = new Map<string, number>();
  const kept: DocumentHistorySnapshot[] = [];

  for (const snapshot of sorted) {
    if (kept.length >= maxHistorySnapshotsInHotIndex) {
      break;
    }
    const count = perFileCount.get(snapshot.filePath) ?? 0;
    if (count >= maxHistorySnapshotsPerFile) {
      continue;
    }
    perFileCount.set(snapshot.filePath, count + 1);
    kept.push(snapshot);
  }

  return kept;
}
