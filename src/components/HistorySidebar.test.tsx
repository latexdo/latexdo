import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistorySidebar } from "./HistorySidebar";
import type { DocumentHistorySnapshot } from "../types";

function snapshot(
  overrides: Partial<DocumentHistorySnapshot>,
): DocumentHistorySnapshot {
  return {
    id: "snapshot-1",
    filePath: "main.tex",
    fileName: "main.tex",
    label: "Initial draft",
    content: "\\section{Intro}",
    timestamp: Date.UTC(2026, 0, 1, 12, 0),
    source: "manual",
    ...overrides,
  };
}

describe("HistorySidebar", () => {
  it("disables manual capture when no file is active", () => {
    render(
      <HistorySidebar
        snapshots={[]}
        onCaptureSnapshot={vi.fn()}
        onRestoreSnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /capture state/i })).toBeDisabled();
    expect(screen.getAllByText("No file open")[0]).toBeVisible();
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText(/No local history yet/i)).toBeVisible();
  });

  it("restores and deletes active-file snapshots without mixing other files", () => {
    const onRestoreSnapshot = vi.fn();
    const onDeleteSnapshot = vi.fn();
    const olderMain = snapshot({
      id: "older-main",
      label: "Older main",
      content: "Old main content",
      timestamp: Date.UTC(2026, 0, 1, 12, 0),
    });
    const newerMain = snapshot({
      id: "newer-main",
      label: "Newer main",
      content: "New main content",
      timestamp: Date.UTC(2026, 0, 2, 12, 0),
    });
    const otherFile = snapshot({
      id: "other-file",
      filePath: "appendix.tex",
      fileName: "appendix.tex",
      label: "Appendix state",
      timestamp: Date.UTC(2026, 0, 3, 12, 0),
    });

    render(
      <HistorySidebar
        activeFilePath="main.tex"
        activeFileContent="New main content"
        snapshots={[olderMain, otherFile, newerMain]}
        onCaptureSnapshot={vi.fn()}
        onRestoreSnapshot={onRestoreSnapshot}
        onDeleteSnapshot={onDeleteSnapshot}
      />,
    );

    expect(screen.getByRole("button", { name: /capture state/i })).toBeEnabled();
    expect(screen.getByLabelText("History summary")).toHaveTextContent(
      /2\s*File states/,
    );
    expect(screen.getByLabelText("History summary")).toHaveTextContent(
      /3\s*Project states/,
    );
    expect(screen.getAllByText("Newer main")[0]).toBeVisible();
    expect(screen.getByText("Older main")).toBeVisible();
    expect(screen.queryByText("Appendix state")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    expect(onRestoreSnapshot).toHaveBeenCalledWith(newerMain);

    fireEvent.click(screen.getByTitle("Delete snapshot"));
    expect(onDeleteSnapshot).toHaveBeenCalledWith("newer-main");
  });

  it("selects snapshots like a timeline and updates restore actions", () => {
    const onRestoreSnapshot = vi.fn();
    const olderMain = snapshot({
      id: "older-main",
      label: "Older main",
      content: "Old main content",
      timestamp: Date.UTC(2026, 0, 1, 12, 0),
    });
    const newerMain = snapshot({
      id: "newer-main",
      label: "Newer main",
      content: "New main content\nAdded line",
      timestamp: Date.UTC(2026, 0, 2, 12, 0),
    });

    render(
      <HistorySidebar
        activeFilePath="main.tex"
        activeFileContent="New main content\nAdded line\nWorking edit"
        snapshots={[olderMain, newerMain]}
        onCaptureSnapshot={vi.fn()}
        onRestoreSnapshot={onRestoreSnapshot}
        onDeleteSnapshot={vi.fn()}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/snapshot diff preview/i)).toHaveTextContent(
      "Added line",
    );
    expect(screen.getByText("Working copy")).toBeVisible();

    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    expect(onRestoreSnapshot).toHaveBeenCalledWith(olderMain);
  });

  it("loads metadata-only snapshot bodies on demand", () => {
    const onLoadSnapshotContent = vi.fn();
    const metadataOnly = snapshot({
      id: "metadata-only",
      content: undefined,
      contentPath: ".latexdo/history/snapshots/metadata-only.txt",
      preview: "\\section{Stored elsewhere}",
    });

    render(
      <HistorySidebar
        activeFilePath="main.tex"
        snapshots={[metadataOnly]}
        onCaptureSnapshot={vi.fn()}
        onLoadSnapshotContent={onLoadSnapshotContent}
        onRestoreSnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
      />,
    );

    expect(onLoadSnapshotContent).toHaveBeenCalledWith(metadataOnly);
    expect(screen.getByText(/Loading snapshot body/i)).toBeVisible();
    expect(screen.getByText("\\section{Stored elsewhere}")).toBeVisible();
  });

  it("pages large active-file timelines instead of rendering every row", () => {
    const snapshots = Array.from({ length: 85 }, (_, index) =>
      snapshot({
        id: `snapshot-${index}`,
        label: `Snapshot ${index}`,
        content: `Content ${index}`,
        timestamp: Date.UTC(2026, 0, 1, 12, 0) + index,
      }),
    );

    render(
      <HistorySidebar
        activeFilePath="main.tex"
        snapshots={snapshots}
        onCaptureSnapshot={vi.fn()}
        onRestoreSnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("option")).toHaveLength(80);
    fireEvent.click(screen.getByRole("button", { name: /show 5 more/i }));
    expect(screen.getAllByRole("option")).toHaveLength(85);
  });
});
