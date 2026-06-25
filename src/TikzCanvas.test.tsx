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

describe("TikzCanvas interactions", () => {
  it("selects a drawn shape and allows it to move", () => {
    const { container } = render(<TikzCanvas />);
    const svg = getSvg(container);

    fireEvent.click(screen.getByTitle("Rectangle (R)"));
    fireEvent.mouseDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(svg);

    expect(screen.getByText("Selected: rect")).toBeInTheDocument();
    expect(screen.getByTitle("Select (V)")).toHaveClass("active");
    expect(generatedCode(container)).toContain("(2,14) rectangle (4,12)");

    fireEvent.mouseDown(svg, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 225 });
    fireEvent.mouseUp(svg);

    expect(generatedCode(container)).toContain("(3,12.5) rectangle (5,10.5)");
  });
});
