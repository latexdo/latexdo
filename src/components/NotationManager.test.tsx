import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotationManager } from "./NotationManager";

function installClipboardMock() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText,
      readText: vi.fn().mockResolvedValue(""),
    },
  });
  return { writeText };
}

describe("NotationManager", () => {
  beforeEach(() => {
    installClipboardMock();
  });

  it("inserts equation templates", () => {
    const onInsertCode = vi.fn();
    render(<NotationManager content="" onInsertCode={onInsertCode} />);

    fireEvent.click(screen.getByTitle("Numbered equation"));

    expect(onInsertCode).toHaveBeenCalledWith(
      expect.stringContaining("\\begin{equation}"),
    );
  });

  it("filters and copies symbols from the palette", async () => {
    const { writeText } = installClipboardMock();
    render(<NotationManager content="" />);

    fireEvent.click(screen.getByRole("button", { name: "Symbols" }));
    fireEvent.change(screen.getByPlaceholderText(/search symbols/i), {
      target: { value: "beta" },
    });
    fireEvent.click(screen.getByTitle("\\beta — Click to copy"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("\\beta");
    });
    expect(screen.getByText("Copied \\beta")).toBeVisible();
  });

  it("adds custom notation and copies a reusable definition", () => {
    const { writeText } = installClipboardMock();
    render(<NotationManager content="" />);

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/lambda/), {
      target: { value: "\\lambda" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Description/i), {
      target: { value: "regularization weight" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    const customRow = screen.getByText("\\lambda").closest("div");
    expect(customRow).not.toBeNull();
    expect(screen.getByText("regularization weight")).toBeVisible();

    fireEvent.click(within(customRow as HTMLElement).getByRole("button"));
    expect(writeText).toHaveBeenCalledWith("\\newcommand{\\lambda}{\\lambda}");
  });

  it("offers definitions for detected undefined notation", () => {
    const onInsertCode = vi.fn();
    render(
      <NotationManager
        content={"\\section{Method}\nWe optimize $\\theta + x$."}
        onInsertCode={onInsertCode}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Detected" }));

    expect(screen.getByText("Detected Symbols")).toBeVisible();
    expect(screen.getAllByText("Undefined").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Define" })[0]);
    expect(onInsertCode).toHaveBeenCalledWith(
      expect.stringMatching(/^\\newcommand\{\\(?:theta|x)\}/),
    );
  });
});
