import { describe, expect, it } from "vitest";
import type { DocumentHistorySnapshot } from "../../types";
import {
  maxHistorySnapshotsInHotIndex,
  maxHistorySnapshotsPerFile,
  pruneHistorySnapshots,
} from "./historySnapshots";

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const now = Date.parse("2026-07-15T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const files = ["main.tex", "chapters/one.tex", "refs.bib", "notes.md"];
const sources: DocumentHistorySnapshot["source"][] = [
  "auto",
  "auto",
  "auto",
  "auto",
  "manual",
  "restore",
];

function generateSnapshots(seed: number): DocumentHistorySnapshot[] {
  const random = mulberry32(seed * 2654435761);
  const count = 5 + Math.floor(random() * 295);
  const snapshots: DocumentHistorySnapshot[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = sources[Math.floor(random() * sources.length)];
    snapshots.push({
      id: `s${seed}-${index}`,
      filePath: files[Math.floor(random() * files.length)],
      fileName: "f",
      label: source,
      content: undefined,
      contentPath: `.latexdo/history/snapshots/s${seed}-${index}.txt`,
      timestamp: now - Math.floor(random() * 40 * day),
      source,
    });
  }
  return snapshots;
}

const seeds = Array.from({ length: 400 }, (_, index) => ({ seed: index + 1 }));

describe("generated history pruning invariants", () => {
  it.each(seeds)("seed $seed keeps only valid subsets", ({ seed }) => {
    const input = generateSnapshots(seed);
    const kept = pruneHistorySnapshots(input, now);

    // Result is a subset of the input.
    const inputIds = new Set(input.map((snapshot) => snapshot.id));
    expect(kept.every((snapshot) => inputIds.has(snapshot.id))).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(input.length);
    expect(kept.length).toBeLessThanOrEqual(maxHistorySnapshotsInHotIndex);

    // Per-file cap holds.
    const perFile = new Map<string, number>();
    for (const snapshot of kept) {
      perFile.set(snapshot.filePath, (perFile.get(snapshot.filePath) ?? 0) + 1);
    }
    for (const count of perFile.values()) {
      expect(count).toBeLessThanOrEqual(maxHistorySnapshotsPerFile);
    }

    // Manual and restore checkpoints are never thinned (only capped, and the
    // generated sets stay far below the caps).
    const protectedInput = input.filter((snapshot) => snapshot.source !== "auto");
    const protectedKept = kept.filter((snapshot) => snapshot.source !== "auto");
    expect(protectedKept.length).toBe(protectedInput.length);

    // Output is sorted newest first.
    for (let index = 0; index + 1 < kept.length; index += 1) {
      expect(kept[index].timestamp).toBeGreaterThanOrEqual(kept[index + 1].timestamp);
    }

    // Pruning is idempotent: a second pass changes nothing.
    const repruned = pruneHistorySnapshots(kept, now);
    expect(repruned.map((snapshot) => snapshot.id)).toEqual(
      kept.map((snapshot) => snapshot.id),
    );
  });
});
