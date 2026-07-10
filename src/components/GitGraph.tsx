import { useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { GitGraphCommit } from "../types";

const defaultLaneWidth = 18;
const defaultRowHeight = 28;
const laneColors = [
  "#73a7ff",
  "#6ecb93",
  "#e2b86b",
  "#d98bc8",
  "#6fc7cf",
  "#ee8b78",
  "#a9a0ef",
  "#a5bd68",
];

export interface GitGraphProps {
  commits: GitGraphCommit[];
  selectedHash?: string | null;
  onSelectCommit: (commit: GitGraphCommit) => void;
  className?: string;
  loading?: boolean;
  emptyMessage?: string;
  rowHeight?: number;
  laneWidth?: number;
  formatTimestamp?: (authoredAt: string) => string;
}

function relativeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

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
  const [unit, divisor] = units.find(
    ([, candidate]) => absoluteSeconds >= candidate,
  ) ?? ["second", 1];

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(seconds / divisor),
    unit,
  );
}

function laneColor(lane: number): string {
  return laneColors[Math.abs(lane) % laneColors.length];
}

function graphLaneCount(commits: GitGraphCommit[]): number {
  let maximumLane = 0;
  for (const commit of commits) {
    maximumLane = Math.max(maximumLane, commit.lane);
    for (const segment of commit.segments) {
      maximumLane = Math.max(maximumLane, segment.fromLane, segment.toLane);
    }
  }
  return maximumLane + 1;
}

function segmentPath(
  fromLane: number,
  toLane: number,
  rowHeight: number,
  laneWidth: number,
): string {
  const fromX = fromLane * laneWidth + laneWidth / 2;
  const toX = toLane * laneWidth + laneWidth / 2;
  if (fromLane === toLane) {
    return `M ${fromX} 0 L ${toX} ${rowHeight}`;
  }

  const midpoint = rowHeight / 2;
  return `M ${fromX} 0 C ${fromX} ${midpoint}, ${toX} ${midpoint}, ${toX} ${rowHeight}`;
}

function commitHasHeadRef(commit: GitGraphCommit): boolean {
  return commit.isHead || commit.refs.some((ref) => ref.current || ref.kind === "head");
}

export function GitGraph({
  commits,
  selectedHash,
  onSelectCommit,
  className,
  loading = false,
  emptyMessage = "No commits available.",
  rowHeight = defaultRowHeight,
  laneWidth = defaultLaneWidth,
  formatTimestamp = relativeTimestamp,
}: GitGraphProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const laneCount = useMemo(() => graphLaneCount(commits), [commits]);
  const graphWidth = Math.max(laneWidth, laneCount * laneWidth);
  const selectedIndex = commits.findIndex((commit) => commit.hash === selectedHash);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const focusCommit = (index: number) => {
    const next = commits[index];
    if (!next) return;
    onSelectCommit(next);
    rowRefs.current.get(next.hash)?.focus();
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(commits.length - 1, index + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = commits.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      focusCommit(nextIndex);
    }
  };

  if (loading) {
    return (
      <div
        className={["git-graph-empty git-graph-state", className]
          .filter(Boolean)
          .join(" ")}
      >
        Loading commit graph...
      </div>
    );
  }

  if (!commits.length) {
    return (
      <div
        className={["git-graph-empty git-graph-state", className]
          .filter(Boolean)
          .join(" ")}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={["git-graph", className].filter(Boolean).join(" ")}
      role="listbox"
      aria-label="Repository commit graph"
      style={{ "--graph-width": `${graphWidth}px` } as CSSProperties}
    >
      {commits.map((commit, index) => {
        const selected = commit.hash === selectedHash;
        const timestamp = formatTimestamp(commit.authoredAt);
        const isHead = commitHasHeadRef(commit);

        return (
          <button
            key={commit.hash}
            ref={(node) => {
              if (node) rowRefs.current.set(commit.hash, node);
              else rowRefs.current.delete(commit.hash);
            }}
            type="button"
            role="option"
            aria-selected={selected}
            className={`git-graph-row${selected ? " selected" : ""}`}
            tabIndex={index === tabbableIndex ? 0 : -1}
            onClick={() => onSelectCommit(commit)}
            onKeyDown={(event) => handleRowKeyDown(event, index)}
            title={`${commit.shortHash} - ${commit.subject}`}
            style={{ height: rowHeight }}
          >
            <svg
              className="git-graph-lanes"
              width={graphWidth}
              height={rowHeight}
              viewBox={`0 0 ${graphWidth} ${rowHeight}`}
              aria-hidden="true"
            >
              {commit.segments.map((segment, segmentIndex) => (
                <path
                  key={`${segment.fromLane}:${segment.toLane}:${segment.kind}:${segmentIndex}`}
                  className={`git-graph-segment ${segment.kind}`}
                  d={segmentPath(
                    segment.fromLane,
                    segment.toLane,
                    rowHeight,
                    laneWidth,
                  )}
                  fill="none"
                  stroke={laneColor(segment.fromLane)}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <circle
                className={`git-graph-dot${isHead ? " head" : ""}`}
                cx={commit.lane * laneWidth + laneWidth / 2}
                cy={rowHeight / 2}
                r={isHead ? 5.5 : 4}
                fill={laneColor(commit.lane)}
                stroke="var(--bg-canvas, #181b22)"
                strokeWidth={isHead ? 2 : 1.5}
              />
            </svg>

            <span className="git-graph-message-cell">
              {commit.refs.length ? (
                <span className="git-ref-labels">
                  {commit.refs.map((ref) => (
                    <span
                      key={`${ref.kind}:${ref.name}`}
                      className={`git-ref-label git-graph-ref ${ref.kind}${
                        ref.current ? " current" : ""
                      }`}
                      data-kind={ref.kind}
                      title={`${ref.kind.replaceAll("-", " ")}: ${ref.name}`}
                    >
                      {ref.name}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="git-graph-message git-graph-subject">
                {commit.subject}
              </span>
            </span>
            <span className="git-graph-author" title={commit.authorEmail}>
              {commit.authorName}
            </span>
            <time
              className="git-graph-time"
              dateTime={commit.authoredAt}
              title={commit.authoredAt}
            >
              {timestamp}
            </time>
          </button>
        );
      })}
    </div>
  );
}
