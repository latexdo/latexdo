import React from "react";
import { History, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { DocumentHistorySnapshot } from "../types";

interface HistorySidebarProps {
  activeFilePath?: string;
  snapshots: DocumentHistorySnapshot[];
  onCaptureSnapshot: () => void;
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

function sourceLabel(snapshot: DocumentHistorySnapshot): string {
  if (snapshot.source === "manual") return "Manual";
  if (snapshot.source === "restore") return "Restore point";
  return "Auto";
}

function previewText(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? "Empty document";
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  activeFilePath,
  snapshots,
  onCaptureSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
}) => {
  const sortedSnapshots = React.useMemo(
    () => [...snapshots].sort((a, b) => b.timestamp - a.timestamp),
    [snapshots],
  );
  const activeSnapshots = activeFilePath
    ? sortedSnapshots.filter((snapshot) => snapshot.filePath === activeFilePath)
    : [];
  const projectSnapshots = sortedSnapshots.slice(0, 12);

  return (
    <div className="history-sidebar">
      <div className="history-current-card">
        <div>
          <span className="sidebar-section-label">Current File</span>
          <strong>{activeFilePath ?? "No file open"}</strong>
        </div>
        <button
          className="sidebar-primary-action"
          onClick={onCaptureSnapshot}
          disabled={!activeFilePath}
        >
          <Plus size={14} />
          <span>Capture State</span>
        </button>
      </div>

      <div className="history-section-heading">
        <History size={13} />
        <span>Active File Timeline</span>
      </div>
      <div className="history-snapshot-list">
        {activeSnapshots.length ? (
          activeSnapshots.map((snapshot) => (
            <div key={snapshot.id} className="history-snapshot-row">
              <div className="history-snapshot-main">
                <strong>{snapshot.label}</strong>
                <span>
                  {sourceLabel(snapshot)} · {formatSnapshotTime(snapshot.timestamp)}
                </span>
                <small>{previewText(snapshot.content)}</small>
              </div>
              <div className="history-snapshot-actions">
                <button
                  type="button"
                  className="sidebar-mini-action"
                  onClick={() => onRestoreSnapshot(snapshot)}
                >
                  <RefreshCw size={12} />
                  <span>Restore</span>
                </button>
                <button
                  type="button"
                  className="sidebar-mini-action subtle"
                  onClick={() => onDeleteSnapshot(snapshot.id)}
                  title="Delete snapshot"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="sidebar-empty-state">
            Open a document and capture a state. Auto history is recorded after edits.
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
              className="scm-history-row"
              onClick={() => onRestoreSnapshot(snapshot)}
              title="Restore this snapshot"
            >
              <strong>{snapshot.fileName}</strong>
              <span>
                {sourceLabel(snapshot)} · {formatSnapshotTime(snapshot.timestamp)}
              </span>
            </button>
          ))
        ) : (
          <div className="sidebar-empty-state compact">No local history yet.</div>
        )}
      </div>
    </div>
  );
};
