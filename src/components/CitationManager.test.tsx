import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CitationManager } from "./CitationManager";
import { analyzeCitationLibrary } from "../latex/citationAnalysis";

function installClipboardMock() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText,
    },
  });
  return { writeText };
}

const analysis = analyzeCitationLibrary(
  [
    {
      path: "main.tex",
      content: "We cite \\citep{knuth84,missingKey}.",
    },
    {
      path: "refs.bib",
      content: `
@article{knuth84,
  title = {The TeXbook},
  author = {Donald Knuth},
  year = {1984},
  journal = {Computers and Typesetting},
  doi = {10.1000/texbook}
}
@article{duplicateA,
  title = {Duplicate Work},
  author = {A. Author},
  year = {2020},
  journal = {Journal},
  doi = {10.1000/dup}
}
@article{duplicateB,
  title = {Duplicate Work},
  author = {B. Author},
  year = {2020},
  journal = {Journal},
  doi = {10.1000/dup}
}
@misc{metadataDebt,
  year = {2024}
}
`,
    },
  ],
  2026,
);

describe("CitationManager", () => {
  beforeEach(() => {
    installClipboardMock();
  });

  it("searches the library and inserts a selected citation command", () => {
    const onInsertCitation = vi.fn();
    render(<CitationManager analysis={analysis} onInsertCitation={onInsertCitation} />);

    fireEvent.change(screen.getByPlaceholderText(/search by key/i), {
      target: { value: "texbook" },
    });
    fireEvent.change(screen.getByLabelText("Citation command"), {
      target: { value: "citet" },
    });

    const card = screen.getByText("knuth84").closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: "Insert" }),
    );

    expect(onInsertCitation).toHaveBeenCalledWith("knuth84", "citet");
  });

  it("copies cite commands from the library", async () => {
    const { writeText } = installClipboardMock();
    render(<CitationManager analysis={analysis} />);

    const card = screen.getByText("knuth84").closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: /copy cite/i }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("\\cite{knuth84}");
    });
    expect(screen.getByText("Copied knuth84")).toBeVisible();
  });

  it("adds a BibTeX stub for a missing cited key", () => {
    const onAppendBibEntry = vi.fn();
    render(<CitationManager analysis={analysis} onAppendBibEntry={onAppendBibEntry} />);

    fireEvent.click(screen.getByRole("button", { name: "Gaps" }));

    const card = screen.getByText("missingKey").closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: /add stub/i }),
    );

    expect(onAppendBibEntry).toHaveBeenCalledWith(
      "refs.bib",
      expect.stringContaining("@article{missingKey,"),
    );
  });

  it("surfaces duplicate and metadata quality issues", () => {
    render(<CitationManager analysis={analysis} />);

    fireEvent.click(screen.getByRole("button", { name: "Quality" }));

    expect(screen.getByText(/DOI: 10.1000\/dup/i)).toBeVisible();
    expect(screen.getAllByText("metadataDebt").length).toBeGreaterThan(1);
    expect(screen.getByText("Missing title")).toBeVisible();
  });
});
