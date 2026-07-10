import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TikzCanvas from "./TikzCanvas";

function getSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg.tikz-svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("TikZ SVG canvas was not rendered");
  }
  return svg;
}

function generatedCode(container: HTMLElement): string {
  const textarea = container.querySelector<HTMLTextAreaElement>(".tikz-code-textarea");
  return textarea?.value ?? "";
}

function expectCodeOrder(code: string, first: string, second: string): void {
  expect(code.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(code.indexOf(second)).toBeGreaterThanOrEqual(0);
  expect(code.indexOf(first)).toBeLessThan(code.indexOf(second));
}

describe("TikzCanvas interactions", () => {
  it("keeps the toolbar stable while selecting and moving a shape", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);

    fireEvent.click(screen.getByTitle("Rectangle (R)"));
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);

    expect(screen.queryByText("Selected: rect")).not.toBeInTheDocument();
    expect(container.querySelector(".tikz-toolbar-selected")).toBeNull();
    expect(container.querySelector(".tikz-toolbar-selected-props")).toBeNull();
    expect(container.querySelector(".tikz-selected-props")).toBeNull();
    expect(screen.getByTitle("Rectangle (R)")).toHaveClass("active");
    expect(generatedCode(container)).toContain("(2,14) rectangle (4,12)");

    fireEvent.click(screen.getAllByTitle("#ef4444")[0]);
    expect(generatedCode(container)).toContain(
      "draw={rgb,255:red,239;green,68;blue,68}",
    );

    fireEvent.click(screen.getByTitle("Select (V)"));
    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 225 });
    fireEvent.mouseUp(svg);

    expect(screen.queryByText("Selected: rect")).not.toBeInTheDocument();
    expect(container.querySelector(".tikz-toolbar-selected")).toBeNull();
    expect(container.querySelector(".tikz-toolbar-selected-props")).toBeNull();
    expect(generatedCode(container)).toContain("(3,12.5) rectangle (5,10.5)");
    expect(generatedCode(container)).toContain(
      "draw={rgb,255:red,239;green,68;blue,68}",
    );
  });

  it("keeps freehand selected after each stroke", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);

    fireEvent.click(screen.getByTitle("Freehand (P)"));
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 110, clientY: 110 });
    fireEvent.mouseUp(svg);

    expect(screen.getByTitle("Freehand (P)")).toHaveClass("active");

    fireEvent.mouseDown(svg, { button: 0, clientX: 130, clientY: 130 });
    fireEvent.mouseMove(svg, { clientX: 140, clientY: 140 });
    fireEvent.mouseUp(svg);

    expect(screen.getByTitle("Freehand (P)")).toHaveClass("active");
    expect(generatedCode(container).match(/\\draw/g)).toHaveLength(2);
  });

  it("offers right-click layer controls for overlapping shapes", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);
    const lowerRect = "(2,14) rectangle (4,12)";
    const upperRect = "(3,13) rectangle (5,11)";

    fireEvent.click(screen.getByTitle("Rectangle (R)"));
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);
    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseMove(svg, { clientX: 250, clientY: 250 });
    fireEvent.mouseUp(svg);

    expectCodeOrder(generatedCode(container), lowerRect, upperRect);

    fireEvent.contextMenu(svg, { clientX: 125, clientY: 125 });

    expect(screen.getByRole("menu", { name: /shape order/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /bring to front/i }));

    expectCodeOrder(generatedCode(container), upperRect, lowerRect);
    expect(
      screen.queryByRole("menu", { name: /shape order/i }),
    ).not.toBeInTheDocument();
  });
});
