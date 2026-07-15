import { describe, expect, it } from "vitest";
import type { DocumentHistorySnapshot } from "../../types";
import {
  compactHistorySnapshots,
  maxInMemorySnapshotContentsPerFile,
  pruneHistorySnapshots,
} from "./historySnapshots";

const now = Date.parse("2026-07-15T12:00:00.000Z");
const minute = 60 * 1000;
const hour = 60 * minute;

let idCounter = 0;

function snapshot(
  ageMs: number,
  overrides: Partial<DocumentHistorySnapshot> = {},
): DocumentHistorySnapshot {
  idCounter += 1;
  return {
    id: `snap-${idCounter}`,
    filePath: "main.tex",
    fileName: "main.tex",
    label: "Auto checkpoint",
    content: "content",
    contentPath: `.latexdo/history/snapshots/snap-${idCounter}.txt`,
    timestamp: now - ageMs,
    source: "auto",
    ...overrides,
  };
}

describe("pruneHistorySnapshots tiered retention", () => {
  it("keeps every recent snapshot from the last 15 minutes", () => {
    const snapshots = Array.from({ length: 30 }, (_, index) =>
      snapshot(index * 20 * 1000),
    );
    expect(pruneHistorySnapshots(snapshots, now)).toHaveLength(30);
  });

  it("thins a long session to one auto snapshot per bucket", () => {
    // Simulate 30 hours of writing with an auto checkpoint every 30 seconds.
    const snapshots = Array.from({ length: 3600 }, (_, index) =>
      snapshot(index * 30 * 1000),
    );

    const kept = pruneHistorySnapshots(snapshots, now);

    // 15 min of everything (30) + ~21 five-minute buckets (15min-2h)
    // + ~44 half-hour buckets (2h-24h) + one 6h bucket (24h-30h).
    expect(kept.length).toBeLessThan(110);
    expect(kept.length).toBeGreaterThan(80);
  });

  it("never thins manual or restore checkpoints", () => {
    const snapshots = [
      ...Array.from({ length: 20 }, (_, index) =>
        snapshot(3 * hour + index * minute, { source: "manual" }),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        snapshot(5 * hour + index * minute, { source: "restore" }),
      ),
    ];

    expect(pruneHistorySnapshots(snapshots, now)).toHaveLength(40);
  });

  it("keeps the newest snapshot inside each bucket", () => {
    // Buckets align to wall-clock intervals, so build two snapshots that
    // provably share one five-minute bucket about half an hour ago.
    const bucketStart = Math.floor((now - 30 * minute) / (5 * minute)) * (5 * minute);
    const newer = snapshot(now - (bucketStart + 3 * minute));
    const older = snapshot(now - (bucketStart + 1 * minute));
    const kept = pruneHistorySnapshots([older, newer], now);

    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(newer.id);
  });

  it("thins snapshots per file independently", () => {
    const kept = pruneHistorySnapshots(
      [
        snapshot(30 * minute, { filePath: "a.tex" }),
        snapshot(31 * minute, { filePath: "b.tex" }),
      ],
      now,
    );
    expect(kept).toHaveLength(2);
  });
});

describe("compactHistorySnapshots", () => {
  it("strips inline content beyond the per-file budget", () => {
    const snapshots = Array.from({ length: 25 }, (_, index) =>
      snapshot(index * minute),
    );

    const compacted = compactHistorySnapshots(snapshots);
    const withContent = compacted.filter(
      (item) => typeof item.content === "string",
    );

    expect(withContent).toHaveLength(maxInMemorySnapshotContentsPerFile);
    // The newest snapshots keep their content.
    const newestIds = snapshots
      .slice(0, maxInMemorySnapshotContentsPerFile)
      .map((item) => item.id);
    expect(withContent.map((item) => item.id).sort()).toEqual(newestIds.sort());
  });

  it("never strips content that has no on-disk copy", () => {
    const snapshots = Array.from({ length: 25 }, (_, index) =>
      snapshot(index * minute, { contentPath: undefined }),
    );

    const compacted = compactHistorySnapshots(snapshots);
    expect(compacted.every((item) => typeof item.content === "string")).toBe(true);
  });

  it("returns the same array when nothing needs stripping", () => {
    const snapshots = [snapshot(0), snapshot(minute)];
    expect(compactHistorySnapshots(snapshots)).toBe(snapshots);
  });
});
