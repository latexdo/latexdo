import { describe, expect, it } from "vitest";
import { parseDiagnostics } from "../../electron/compiler";

const projectPath = "/project";

describe("compiler diagnostics", () => {
  it("parses LaTeX warnings with source line locations", () => {
    const diagnostics = parseDiagnostics(
      "LaTeX Warning: Citation `doe2026' on page 1 undefined on input line 17.",
      projectPath,
      "main.tex",
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        file: "main.tex",
        line: 17,
        severity: "warning",
        message: "Citation `doe2026' on page 1 undefined on input line 17",
      }),
    );
  });

  it("parses package warning continuations that carry the source line", () => {
    const diagnostics = parseDiagnostics(
      [
        "Package hyperref Warning: Token not allowed in a PDF string (Unicode):",
        "(hyperref)                removing `math shift' on input line 42.",
      ].join("\n"),
      projectPath,
      "main.tex",
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        file: "main.tex",
        line: 42,
        severity: "warning",
        message:
          "Token not allowed in a PDF string (Unicode): removing `math shift' on input line 42",
      }),
    );
  });

  it("parses overfull and underfull box warnings as source warnings", () => {
    const diagnostics = parseDiagnostics(
      [
        "Overfull \\hbox (12.5pt too wide) in paragraph at lines 10--12",
        "Underfull \\hbox (badness 10000) in paragraph at lines 20--21",
      ].join("\n"),
      projectPath,
      "main.tex",
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 10,
          endLine: 12,
          severity: "warning",
          message: "Overfull \\hbox (12.5pt too wide) in paragraph at lines 10--12",
        }),
        expect.objectContaining({
          line: 20,
          endLine: 21,
          severity: "warning",
          message: "Underfull \\hbox (badness 10000) in paragraph at lines 20--21",
        }),
      ]),
    );
  });
});
