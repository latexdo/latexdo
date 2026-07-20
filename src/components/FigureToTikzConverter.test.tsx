import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FigureToTikzConverter } from "./FigureToTikzConverter";

class MockFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;

  readAsDataURL() {
    this.onload?.({ target: { result: "data:image/png;base64,AA==" } });
  }

  readAsText() {
    this.onload?.({ target: { result: mockTextReadResult } });
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

let mockTextReadResult = "";

const sampleDrawio = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
  <diagram id="page-1" name="Flow">
    <mxGraphModel pageWidth="240" pageHeight="180">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="a" value="Input" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="20" y="20" width="80" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="b" value="Output" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="140" y="20" width="80" height="40" as="geometry"/>
        </mxCell>
        <mxCell id="e" value="" style="endArrow=classic;html=1;" edge="1" parent="1" source="a" target="b">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe("FigureToTikzConverter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTextReadResult = "";
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

    expect(screen.getByText(/Drop an image or draw\.io file here/i)).toBeVisible();
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

  it("generates TikZ code from an uploaded draw.io file", async () => {
    mockTextReadResult = sampleDrawio;
    const onInsertCode = vi.fn();
    const { container } = render(<FigureToTikzConverter onInsertCode={onInsertCode} />);

    const input = container.querySelector("input[type='file']");
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [
          new File([sampleDrawio], "flow.drawio", {
            type: "application/xml",
          }),
        ],
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("draw.io Diagram")).toBeVisible();
    expect(screen.getByText("flow.drawio")).toBeVisible();
    expect(
      screen.getByText("Converted 2 shapes, 1 connector, and 2 labels."),
    ).toBeVisible();
    expect(screen.getByText(/Input/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onInsertCode).toHaveBeenCalledWith(expect.stringContaining("Output"));
  });
});
