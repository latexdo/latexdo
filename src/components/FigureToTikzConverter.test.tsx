import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FigureToTikzConverter } from "./FigureToTikzConverter";

class MockFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;

  readAsDataURL() {
    this.onload?.({ target: { result: "data:image/png;base64,AA==" } });
  }
}

class MockImage {
  width = 120;
  height = 80;
  onload: (() => void) | null = null;

  set src(_value: string) {
    this.onload?.();
  }
}

function installCanvasMock() {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    })),
  });
}

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

describe("FigureToTikzConverter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("FileReader", MockFileReader);
    vi.stubGlobal("Image", MockImage);
    installClipboardMock();
    installCanvasMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the upload state before an image is provided", () => {
    render(<FigureToTikzConverter />);

    expect(screen.getByText(/Drop an image here, click to upload/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("generates TikZ code from an uploaded image and inserts it", () => {
    const onInsertCode = vi.fn();
    const { container } = render(<FigureToTikzConverter onInsertCode={onInsertCode} />);

    const input = container.querySelector("input[type='file']");
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["image"], "diagram.png", { type: "image/png" })],
      },
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText("Original Image")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /re-analyze/i }));

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText(/Auto-generated from image/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onInsertCode).toHaveBeenCalledWith(
      expect.stringContaining("\\begin{tikzpicture}"),
    );
  });
});
