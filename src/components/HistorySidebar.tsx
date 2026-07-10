import React from "react";
import {
  Clock,
  FileText,
  GitCompare,
  History,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { DocumentHistorySnapshot } from "../types";

interface HistorySidebarProps {
  activeFilePath?: string;
  activeFileContent?: string;
  activeFileSnapshotCount?: number;
  totalSnapshotCount?: number;
  snapshots: DocumentHistorySnapshot[];
  onCaptureSnapshot: () => void;
  onLoadSnapshotContent?: (snapshot: DocumentHistorySnapshot) => void;
  onRestoreSnapshot: (snapshot: DocumentHistorySnapshot) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
}

function formatSnapshotTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatFullSnapshotTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatRelativeSnapshotTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const [unit, divisor] = units.find(([, value]) => absoluteSeconds >= value) ?? [
    "second",
    1,
  ];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(seconds / divisor),
    unit,
  );
}

function sourceLabel(snapshot: DocumentHistorySnapshot): string {
  if (snapshot.source === "manual") return "Manual checkpoint";
  if (snapshot.source === "restore") return "Restore guard";
  return "Auto checkpoint";
}

function sourceCode(snapshot: DocumentHistorySnapshot): string {
  if (snapshot.source === "manual") return "M";
  if (snapshot.source === "restore") return "R";
  return "A";
}

function previewText(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? "Empty document";
}

function snapshotPreview(snapshot: DocumentHistorySnapshot): string {
  if (typeof snapshot.content === "string") return previewText(snapshot.content);
  return snapshot.preview ?? "Snapshot content is stored on demand";
}

function snapshotText(snapshot?: DocumentHistorySnapshot): string | null {
  return typeof snapshot?.content === "string" ? snapshot.content : null;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 3) / 2);
  const tail = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function splitLines(content: string): string[] {
  if (!content) return [];
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

interface ContentMetrics {
  lines: number;
  words: number;
}

function measureContent(content: string): ContentMetrics {
  const trimmed = content.trim();
  return {
    lines: splitLines(content).length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
  };
}

type DiffOperationKind = "context" | "added" | "removed";

interface DiffOperation {
  kind: DiffOperationKind;
  text: string;
}

interface DiffPreviewRow {
  kind: DiffOperationKind | "omitted";
  text: string;
}

interface LineComparison {
  addedLines: number;
  removedLines: number;
  changed: boolean;
  tooLarge: boolean;
  rows: DiffPreviewRow[];
}

const maxDetailedDiffCells = 45_000;
const maxDiffPreviewRows = 12;
const initialTimelineRows = 80;
const timelineRowsIncrement = 80;

function buildFallbackOperations(
  beforeLines: string[],
  afterLines: string[],
): DiffOperation[] {
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  return [
    ...beforeLines.slice(0, prefix).map((text) => ({ kind: "context" as const, text })),
    ...beforeLines
      .slice(prefix, beforeSuffix + 1)
      .map((text) => ({ kind: "removed" as const, text })),
    ...afterLines
      .slice(prefix, afterSuffix + 1)
      .map((text) => ({ kind: "added" as const, text })),
    ...afterLines
      .slice(afterSuffix + 1)
      .map((text) => ({ kind: "context" as const, text })),
  ];
}

function buildDetailedOperations(
  beforeLines: string[],
  afterLines: string[],
): DiffOperation[] {
  const matrix = Array.from(
    { length: beforeLines.length + 1 },
    () => new Uint16Array(afterLines.length + 1),
  );

  for (let beforeIndex = 1; beforeIndex <= beforeLines.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= afterLines.length; afterIndex += 1) {
      matrix[beforeIndex][afterIndex] =
        beforeLines[beforeIndex - 1] === afterLines[afterIndex - 1]
          ? matrix[beforeIndex - 1][afterIndex - 1] + 1
          : Math.max(
              matrix[beforeIndex - 1][afterIndex],
              matrix[beforeIndex][afterIndex - 1],
            );
    }
  }

  const operations: DiffOperation[] = [];
  let beforeIndex = beforeLines.length;
  let afterIndex = afterLines.length;
  while (beforeIndex > 0 || afterIndex > 0) {
    if (
      beforeIndex > 0 &&
      afterIndex > 0 &&
      beforeLines[beforeIndex - 1] === afterLines[afterIndex - 1]
    ) {
      operations.push({
        kind: "context",
        text: beforeLines[beforeIndex - 1],
      });
      beforeIndex -= 1;
      afterIndex -= 1;
    } else if (
      afterIndex > 0 &&
      (beforeIndex === 0 ||
        matrix[beforeIndex][afterIndex - 1] >= matrix[beforeIndex - 1][afterIndex])
    ) {
      operations.push({
        kind: "added",
        text: afterLines[afterIndex - 1],
      });
      afterIndex -= 1;
    } else {
      operations.push({
        kind: "removed",
        text: beforeLines[beforeIndex - 1],
      });
      beforeIndex -= 1;
    }
  }

  return operations.reverse();
}

function compactDiffRows(operations: DiffOperation[]): DiffPreviewRow[] {
  const changedIndexes = operations
    .map((operation, index) => (operation.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);

  if (!changedIndexes.length) {
    return operations.slice(0, Math.min(operations.length, 6));
  }

  const included = new Set<number>();
  for (const index of changedIndexes) {
    included.add(index);
    if (index > 0) included.add(index - 1);
    if (index < operations.length - 1) included.add(index + 1);
  }

  const rows: DiffPreviewRow[] = [];
  let previousIndex = -1;
  for (const index of [...included].sort((left, right) => left - right)) {
    if (rows.length >= maxDiffPreviewRows) {
      break;
    }
    if (previousIndex >= 0 && index > previousIndex + 1) {
      rows.push({ kind: "omitted", text: "..." });
    }
    rows.push(operations[index]);
    previousIndex = index;
  }
  if (previousIndex < operations.length - 1 && rows.length < maxDiffPreviewRows) {
    rows.push({ kind: "omitted", text: "..." });
  }
  return rows.slice(0, maxDiffPreviewRows);
}

function compareLines(beforeContent: string, afterContent: string): LineComparison {
  const beforeLines = splitLines(beforeContent);
  const afterLines = splitLines(afterContent);
  const tooLarge = beforeLines.length * afterLines.length > maxDetailedDiffCells;
  const operations = tooLarge
    ? buildFallbackOperations(beforeLines, afterLines)
    : buildDetailedOperations(beforeLines, afterLines);
  const addedLines = operations.filter(
    (operation) => operation.kind === "added",
  ).length;
  const removedLines = operations.filter(
    (operation) => operation.kind === "removed",
  ).length;

  return {
    addedLines,
    removedLines,
    changed: addedLines > 0 || removedLines > 0,
    tooLarge,
    rows: compactDiffRows(operations),
  };
}

function signedCount(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  activeFilePath,
  activeFileContent,
  activeFileSnapshotCount,
  totalSnapshotCount,
  snapshots,
  onCaptureSnapshot,
  onLoadSnapshotContent,
  onRestoreSnapshot,
  onDeleteSnapshot,
}) => {
  const [selectedSnapshotId, setSelectedSnapshotId] = React.useState<string | null>(
    null,
  );
  const [visibleTimelineRows, setVisibleTimelineRows] =
    React.useState(initialTimelineRows);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const activeFilePathRef = React.useRef(activeFilePath);
  const sortedSnapshots = React.useMemo(
    () => [...snapshots].sort((a, b) => b.timestamp - a.timestamp),
    [snapshots],
  );
  const activeSnapshots = React.useMemo(
    () =>
      activeFilePath
        ? sortedSnapshots.filter((snapshot) => snapshot.filePath === activeFilePath)
        : [],
    [activeFilePath, sortedSnapshots],
  );
  const projectSnapshots = React.useMemo(
    () => sortedSnapshots.slice(0, 16),
    [sortedSnapshots],
  );
  const activeCount = activeFileSnapshotCount ?? activeSnapshots.length;
  const totalCount = totalSnapshotCount ?? snapshots.length;
  const latestSnapshot = activeSnapshots[0] ?? sortedSnapshots[0] ?? null;
  const visibleActiveSnapshots = activeSnapshots.slice(0, visibleTimelineRows);

  React.useEffect(() => {
    const fallbackSnapshot = activeSnapshots[0] ?? sortedSnapshots[0] ?? null;
    if (!fallbackSnapshot) {
      setSelectedSnapshotId(null);
      return;
    }

    if (activeFilePathRef.current !== activeFilePath) {
      activeFilePathRef.current = activeFilePath;
      setSelectedSnapshotId(fallbackSnapshot.id);
      return;
    }

    if (
      !selectedSnapshotId ||
      !sortedSnapshots.some((snapshot) => snapshot.id === selectedSnapshotId)
    ) {
      setSelectedSnapshotId(fallbackSnapshot.id);
    }
  }, [activeFilePath, activeSnapshots, selectedSnapshotId, sortedSnapshots]);

  React.useEffect(() => {
    setVisibleTimelineRows(initialTimelineRows);
  }, [activeFilePath]);

  const selectedSnapshot =
    sortedSnapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ??
    activeSnapshots[0] ??
    sortedSnapshots[0] ??
    null;
  const selectedFileSnapshots = selectedSnapshot
    ? sortedSnapshots.filter(
        (snapshot) => snapshot.filePath === selectedSnapshot.filePath,
      )
    : [];
  const selectedFileIndex = selectedSnapshot
    ? selectedFileSnapshots.findIndex((snapshot) => snapshot.id === selectedSnapshot.id)
    : -1;
  const previousSnapshot =
    selectedFileIndex >= 0 ? selectedFileSnapshots[selectedFileIndex + 1] : undefined;
  const selectedContent = snapshotText(selectedSnapshot);
  const previousContent = snapshotText(previousSnapshot);
  const selectedMetrics = selectedContent ? measureContent(selectedContent) : null;
  const selectedComparison =
    selectedSnapshot && selectedContent
      ? compareLines(previousContent ?? "", selectedContent)
      : null;
  const workingComparison =
    selectedSnapshot &&
    selectedContent &&
    activeFilePath === selectedSnapshot.filePath &&
    activeFileContent !== undefined
      ? compareLines(selectedContent, activeFileContent)
      : null;
  const activeLatestComparison =
    activeSnapshots[0]?.content && activeFileContent !== undefined
      ? compareLines(activeSnapshots[0].content, activeFileContent)
      : null;
  const workingCopyStatus =
    !activeFilePath || activeFileContent === undefined
      ? "No file open"
      : !activeSnapshots.length
        ? "No checkpoints for current file"
        : activeLatestComparison?.changed
          ? `Working copy differs from latest: +${activeLatestComparison.addedLines} -${activeLatestComparison.removedLines}`
          : activeSnapshots[0]?.content
            ? "Working copy matches latest checkpoint"
            : "Latest checkpoint body is stored on demand";

  React.useEffect(() => {
    if (selectedSnapshot && selectedContent === null) {
      onLoadSnapshotContent?.(selectedSnapshot);
    }
  }, [onLoadSnapshotContent, selectedContent, selectedSnapshot]);

  const focusSnapshot = React.useCallback(
    (index: number) => {
      const next = visibleActiveSnapshots[index];
      if (!next) return;
      setSelectedSnapshotId(next.id);
      window.requestAnimationFrame(() => {
        rowRefs.current.get(next.id)?.focus();
      });
    },
    [visibleActiveSnapshots],
  );

  const handleSnapshotKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown")
      nextIndex = Math.min(visibleActiveSnapshots.length - 1, index + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = visibleActiveSnapshots.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      focusSnapshot(nextIndex);
    }
  };

  return (
    <div className="history-sidebar">
      <div className="history-head">
        <div className="history-title">
          <History size={16} />
          <div>
            <strong>Local History</strong>
            <span>{activeFilePath ?? "No file open"}</span>
          </div>
        </div>
        <button
          type="button"
          className="history-icon-action"
          onClick={onCaptureSnapshot}
          disabled={!activeFilePath}
          title="Capture state"
          aria-label="Capture state"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="history-summary" aria-label="History summary">
        <div>
          <strong>{activeCount}</strong>
          <span>File states</span>
        </div>
        <div>
          <strong>{totalCount}</strong>
          <span>Project states</span>
        </div>
        <div>
          <strong>
            {latestSnapshot ? formatSnapshotTime(latestSnapshot.timestamp) : "-"}
          </strong>
          <span>Latest</span>
        </div>
      </div>

      <div className="history-current-strip">
        <FileText size={14} />
        <div>
          <strong>{activeFilePath ?? "No file open"}</strong>
          <span>{workingCopyStatus}</span>
        </div>
      </div>

      <div className="history-body">
        <div className="history-section-heading">
          <History size={13} />
          <span>Active File Timeline</span>
        </div>
        <div
          className="history-snapshot-list"
          role="listbox"
          aria-label="Active file history timeline"
        >
          {activeSnapshots.length ? (
            visibleActiveSnapshots.map((snapshot, index) => {
              const selected = selectedSnapshot?.id === snapshot.id;
              const previousRowSnapshot = activeSnapshots[index + 1];
              const snapshotComparison =
                typeof snapshot.content === "string" &&
                (!previousRowSnapshot ||
                  typeof previousRowSnapshot.content === "string")
                  ? compareLines(previousRowSnapshot?.content ?? "", snapshot.content)
                  : null;
              return (
                <button
                  key={snapshot.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(snapshot.id, node);
                    else rowRefs.current.delete(snapshot.id);
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`history-snapshot-row${selected ? " selected" : ""}`}
                  onClick={() => setSelectedSnapshotId(snapshot.id)}
                  onDoubleClick={() => onRestoreSnapshot(snapshot)}
                  onKeyDown={(event) => handleSnapshotKeyDown(event, index)}
                  title={`${sourceLabel(snapshot)} · ${formatFullSnapshotTime(snapshot.timestamp)}`}
                >
                  <span className="history-timeline-marker" aria-hidden="true">
                    <span />
                  </span>
                  <span className="history-snapshot-main">
                    <strong>{snapshot.label}</strong>
                    <span>
                      {sourceLabel(snapshot)} ·{" "}
                      {formatRelativeSnapshotTime(snapshot.timestamp)}
                    </span>
                    <small>{snapshotPreview(snapshot)}</small>
                  </span>
                  <span className={`history-source-badge ${snapshot.source}`}>
                    {sourceCode(snapshot)}
                  </span>
                  <span className="history-row-delta">
                    {snapshotComparison
                      ? `+${snapshotComparison.addedLines} -${snapshotComparison.removedLines}`
                      : "..."}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="sidebar-empty-state">
              Open a document and capture a state. Auto history is recorded after edits.
            </div>
          )}
        </div>
        {activeSnapshots.length > visibleActiveSnapshots.length ? (
          <button
            type="button"
            className="history-load-more"
            onClick={() =>
              setVisibleTimelineRows((current) =>
                Math.min(activeSnapshots.length, current + timelineRowsIncrement),
              )
            }
          >
            Show{" "}
            {Math.min(
              timelineRowsIncrement,
              activeSnapshots.length - visibleActiveSnapshots.length,
            )}{" "}
            more
          </button>
        ) : null}

        <div className="history-section-heading">
          <GitCompare size={13} />
          <span>Selected State</span>
        </div>
        <div className="history-detail">
          {selectedSnapshot ? (
            <>
              <div className="history-detail-header">
                <div>
                  <span>{truncateMiddle(selectedSnapshot.filePath, 42)}</span>
                  <strong>{selectedSnapshot.label}</strong>
                  <small>{formatFullSnapshotTime(selectedSnapshot.timestamp)}</small>
                </div>
                <span className={`history-source-badge ${selectedSnapshot.source}`}>
                  {sourceCode(selectedSnapshot)}
                </span>
              </div>

              {selectedMetrics && selectedComparison ? (
                <div className="history-stat-grid">
                  <div>
                    <strong>{selectedMetrics.lines}</strong>
                    <span>Lines</span>
                  </div>
                  <div>
                    <strong>{selectedMetrics.words}</strong>
                    <span>Words</span>
                  </div>
                  <div>
                    <strong>{signedCount(selectedComparison.addedLines)}</strong>
                    <span>Added</span>
                  </div>
                  <div>
                    <strong>{selectedComparison.removedLines}</strong>
                    <span>Removed</span>
                  </div>
                </div>
              ) : (
                <div className="history-content-pending">
                  Loading snapshot body from local history storage...
                </div>
              )}

              <div className="history-detail-actions">
                <button
                  type="button"
                  className="sidebar-primary-action"
                  onClick={() => onRestoreSnapshot(selectedSnapshot)}
                >
                  <RefreshCw size={13} />
                  <span>Restore</span>
                </button>
                <button
                  type="button"
                  className="sidebar-mini-action subtle danger"
                  onClick={() => onDeleteSnapshot(selectedSnapshot.id)}
                  title="Delete snapshot"
                >
                  <Trash2 size={12} />
                  <span>Delete</span>
                </button>
              </div>

              {selectedComparison ? (
                <>
                  <div className="history-diff-title">
                    <GitCompare size={13} />
                    <span>
                      {previousSnapshot
                        ? `Compared with ${formatSnapshotTime(previousSnapshot.timestamp)}`
                        : "Compared with an empty document"}
                    </span>
                    <small>
                      +{selectedComparison.addedLines} -
                      {selectedComparison.removedLines}
                    </small>
                  </div>
                  <div
                    className="history-diff-preview"
                    aria-label="Snapshot diff preview"
                  >
                    {selectedComparison.rows.length ? (
                      selectedComparison.rows.map((row, index) => (
                        <div
                          key={`${row.kind}:${index}:${row.text}`}
                          className={`history-diff-row ${row.kind}`}
                        >
                          <span>
                            {row.kind === "added"
                              ? "+"
                              : row.kind === "removed"
                                ? "-"
                                : " "}
                          </span>
                          <code>{row.text || " "}</code>
                        </div>
                      ))
                    ) : (
                      <div className="history-diff-empty">No textual changes.</div>
                    )}
                    {selectedComparison.tooLarge ? (
                      <div className="history-diff-note">
                        Large file preview is summarized around changed regions.
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {workingComparison ? (
                <div className="history-working-delta">
                  <Clock size={13} />
                  <span>Working copy</span>
                  <strong>
                    {workingComparison.changed
                      ? `+${workingComparison.addedLines} -${workingComparison.removedLines}`
                      : "No changes"}
                  </strong>
                </div>
              ) : null}
            </>
          ) : (
            <div className="sidebar-empty-state compact">
              Select a snapshot to inspect its metadata and diff.
            </div>
          )}
        </div>

        <div className="history-section-heading">
          <History size={13} />
          <span>Recent Project States</span>
        </div>
        <div className="history-project-list">
          {projectSnapshots.length ? (
            projectSnapshots.map((snapshot) => (
              <button
                key={`project:${snapshot.id}`}
                type="button"
                className={`history-project-row${
                  selectedSnapshot?.id === snapshot.id ? " selected" : ""
                }`}
                onClick={() => setSelectedSnapshotId(snapshot.id)}
                onDoubleClick={() => onRestoreSnapshot(snapshot)}
                title={`${snapshot.filePath} · ${formatFullSnapshotTime(snapshot.timestamp)}`}
              >
                <span className={`history-source-badge ${snapshot.source}`}>
                  {sourceCode(snapshot)}
                </span>
                <span>
                  <strong>{snapshot.fileName}</strong>
                  <small>
                    {sourceLabel(snapshot)} · {formatSnapshotTime(snapshot.timestamp)}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <div className="sidebar-empty-state compact">No local history yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};
