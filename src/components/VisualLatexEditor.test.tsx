import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  parseLatexToVisualBlocks,
  serializeVisualLatexBlocks,
  VisualLatexEditor,
} from "./VisualLatexEditor";

describe("VisualLatexEditor", () => {
  it("round-trips common LaTeX blocks without losing labels or list structure", () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "",
      "\\section{Introduction}\\label{sec:intro}",
      "This is the first paragraph.",
      "",
      "\\begin{itemize}",
      "  \\item First point",
      "  \\item Second point",
      "\\end{itemize}",
      "",
      "\\end{document}",
      "",
    ].join("\n");

    expect(serializeVisualLatexBlocks(parseLatexToVisualBlocks(source))).toBe(source);
  });

  it("writes heading edits back to LaTeX source", () => {
    const onChange = vi.fn();
    render(
      <VisualLatexEditor
        content={"\\subsection{Old Title}\\label{sec:old}\nBody"}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("subsection title"), {
      target: { value: "Related Work" },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "\\subsection{Related Work}\\label{sec:old}\nBody",
    );
  });

  it("writes list item edits back to itemize blocks", () => {
    const onChange = vi.fn();
    render(
      <VisualLatexEditor
        content={"\\begin{itemize}\n  \\item First\n\\end{itemize}"}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("List item"), {
      target: { value: "Updated point" },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "\\begin{itemize}\n  \\item Updated point\n\\end{itemize}",
    );
  });
});
