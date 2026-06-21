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

    expect(
      screen.getByRole("button", { name: /capture state/i }),
    ).toBeDisabled();
    expect(screen.getByText("No file open")).toBeVisible();
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
        snapshots={[olderMain, otherFile, newerMain]}
        onCaptureSnapshot={vi.fn()}
        onRestoreSnapshot={onRestoreSnapshot}
        onDeleteSnapshot={onDeleteSnapshot}
      />,
    );

    expect(screen.getByRole("button", { name: /capture state/i })).toBeEnabled();
    expect(screen.getByText("Newer main")).toBeVisible();
    expect(screen.getByText("Older main")).toBeVisible();
    expect(screen.queryByText("Appendix state")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /restore/i })[0]);
    expect(onRestoreSnapshot).toHaveBeenCalledWith(newerMain);

    fireEvent.click(screen.getAllByTitle("Delete snapshot")[0]);
    expect(onDeleteSnapshot).toHaveBeenCalledWith("newer-main");
  });
});
