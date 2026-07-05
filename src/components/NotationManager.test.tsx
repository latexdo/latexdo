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

  it("shows rendered-style output previews for equation templates", () => {
    render(<NotationManager content="" />);

    const equationPreview = screen.getByLabelText("Equation output preview");
    expect(within(equationPreview).getByText("x = y")).toBeVisible();
    expect(within(equationPreview).getByText("(1)")).toBeVisible();
    expect(equationPreview).toHaveClass("notation-manager-template-preview");

    const casesPreview = screen.getByLabelText("Cases output preview");
    expect(within(casesPreview).getByText("f(x) =")).toBeVisible();
    expect(within(casesPreview).getByText("0")).toBeVisible();
    expect(within(casesPreview).getByText("x < 0")).toBeVisible();
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

    expect(screen.getByText("Detected Notation")).toBeVisible();
    expect(screen.getAllByText("Undefined").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Define" })[0]);
    expect(onInsertCode).toHaveBeenCalledWith(
      expect.stringMatching(/^\\newcommand\{\\(?:theta|x)\}/),
    );
  });

  it("keeps detected notation visible while using notation tools", () => {
    render(<NotationManager content={"We optimize $\\theta + x$."} />);

    expect(screen.getByText("Detected Notation")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Symbols" }));

    expect(screen.getByText("Detected Notation")).toBeVisible();
    expect(screen.getAllByText("\\theta").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByPlaceholderText(/search symbols/i)).toBeVisible();
  });
});
