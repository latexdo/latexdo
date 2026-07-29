import { describe, expect, it } from "vitest";
import {
  cellPlainText,
  parseColumnSpec,
  parseTableAtPosition,
  tablePreviewMarkdown,
} from "./tablePreview";

const document = `\\section{Results}
Text before.

\\begin{table}[htbp]
  \\centering
  \\caption{Accuracy per model}
  \\label{tab:accuracy}
  \\begin{tabular}{|l|c|r|}
    \\hline
    \\textbf{Model} & \\textbf{Top-1} & \\textbf{Params} \\\\
    \\hline
    Baseline & 71.2\\% & 25M \\\\
    Ours & 78.4\\% & 27M \\\\
    \\hline
  \\end{tabular}
\\end{table}

Text after.
`;

describe("parseColumnSpec", () => {
  it("reads alignments and drops rules", () => {
    expect(parseColumnSpec("|l|c|r|")).toEqual(["left", "center", "right"]);
  });

  it("expands repeated specs", () => {
    expect(parseColumnSpec("l*{3}{c}r")).toEqual([
      "left",
      "center",
      "center",
      "center",
      "right",
    ]);
  });

  it("treats paragraph columns as justified", () => {
    expect(parseColumnSpec("p{3cm}@{}>{\\bfseries}lX")).toEqual([
      "justify",
      "left",
      "justify",
    ]);
  });
});

describe("cellPlainText", () => {
  it("unwraps formatting macros and escapes", () => {
    expect(cellPlainText("\\textbf{Top-1} 71.2\\%")).toBe("Top-1 71.2%");
  });

  it("keeps the visible argument of multi-argument macros", () => {
    expect(cellPlainText("\\multirow{2}{*}{Shared}")).toBe("Shared");
    expect(cellPlainText("\\textcolor{red}{Warning}")).toBe("Warning");
  });

  it("drops math delimiters", () => {
    expect(cellPlainText("$\\alpha = 1$")).toBe("\\alpha = 1");
  });
});

describe("parseTableAtPosition", () => {
  it("returns null outside tables", () => {
    expect(parseTableAtPosition(document, 1, 3)).toBeNull();
    expect(parseTableAtPosition(document, 18, 2)).toBeNull();
  });

  it("parses the grid from inside the tabular", () => {
    const table = parseTableAtPosition(document, 12, 8);
    expect(table).not.toBeNull();
    expect(table?.environment).toBe("table");
    expect(table?.gridEnvironment).toBe("tabular");
    expect(table?.columns).toEqual(["left", "center", "right"]);
    expect(table?.caption).toBe("Accuracy per model");
    expect(table?.label).toBe("tab:accuracy");
    expect(table?.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["Model", "Top-1", "Params"],
      ["Baseline", "71.2%", "25M"],
      ["Ours", "78.4%", "27M"],
    ]);
    expect(table?.rows[0].header).toBe(true);
    expect(table?.rows[1].header).toBe(false);
  });

  it("previews the grid when the cursor sits on the caption", () => {
    const table = parseTableAtPosition(document, 6, 5);
    expect(table?.rows).toHaveLength(3);
    expect(table?.caption).toBe("Accuracy per model");
  });

  it("reports the full environment range", () => {
    const table = parseTableAtPosition(document, 5, 3);
    expect(table?.startLine).toBe(4);
    expect(table?.endLine).toBe(16);
    expect(table?.sourceTex.startsWith("\\begin{table}")).toBe(true);
    expect(table?.sourceTex.endsWith("\\end{table}")).toBe(true);
  });

  it("handles booktabs, multicolumn and comments", () => {
    const text = `\\begin{table}
\\begin{tabular}{lcc}
\\toprule
Method & \\multicolumn{2}{c}{Score} \\\\
\\cmidrule(lr){2-3}
 & Dev & Test \\\\
\\midrule
% a comment row & ignored \\\\
A & 1 & 2 \\\\
\\bottomrule
\\end{tabular}
\\end{table}`;
    const table = parseTableAtPosition(text, 4, 3);
    expect(table?.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["Method", "Score"],
      ["", "Dev", "Test"],
      ["A", "1", "2"],
    ]);
    expect(table?.rows[0].cells[1].span).toBe(2);
    expect(table?.rows[0].cells[1].alignment).toBe("center");
  });

  it("treats the row above a booktabs rule as the header", () => {
    const text = `\\begin{tabular}{lr}
\\toprule
Name & Value \\\\
\\midrule
a & 1 \\\\
b & 2 \\\\
\\bottomrule
\\end{tabular}`;
    const table = parseTableAtPosition(text, 5, 2);
    expect(table?.rows.map((row) => [row.header, row.cells[0].text])).toEqual([
      [true, "Name"],
      [false, "a"],
      [false, "b"],
    ]);
  });

  it("supports a bare tabular without a float wrapper", () => {
    const text = `\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}`;
    const table = parseTableAtPosition(text, 2, 2);
    expect(table?.environment).toBe("tabular");
    expect(table?.caption).toBeNull();
    expect(table?.rows).toHaveLength(1);
  });

  it("reads the spec of width-carrying environments", () => {
    const text = `\\begin{tabularx}{\\linewidth}{lX}\na & b \\\\\n\\end{tabularx}`;
    const table = parseTableAtPosition(text, 2, 2);
    expect(table?.columns).toEqual(["left", "justify"]);
    expect(table?.rows[0].cells.map((cell) => cell.text)).toEqual(["a", "b"]);
  });

  it("does not split rows on line breaks inside nested environments", () => {
    const text = `\\begin{tabular}{ll}
a & \\begin{tabular}{c}x \\\\ y\\end{tabular} \\\\
b & c \\\\
\\end{tabular}`;
    const table = parseTableAtPosition(text, 3, 2);
    expect(table?.rows).toHaveLength(2);
  });

  it("picks the innermost tabular when nested", () => {
    const text = `\\begin{tabular}{ll}
a & \\begin{tabular}{c}x \\\\ y\\end{tabular} \\\\
\\end{tabular}`;
    const table = parseTableAtPosition(text, 2, 32);
    expect(table?.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["x"],
      ["y"],
    ]);
  });
});

describe("tablePreviewMarkdown", () => {
  it("renders a markdown table with the caption and label", () => {
    const table = parseTableAtPosition(document, 12, 8);
    expect(table).not.toBeNull();
    expect(tablePreviewMarkdown(table!)).toBe(
      [
        "**Accuracy per model**",
        "",
        "| Model | Top-1 | Params |",
        "| :--- | :---: | ---: |",
        "| Baseline | 71.2% | 25M |",
        "| Ours | 78.4% | 27M |",
        "",
        "`tab:accuracy`",
      ].join("\n"),
    );
  });

  it("escapes pipes inside cells", () => {
    const text = `\\begin{tabular}{l}\na \\| b \\\\\n\\end{tabular}`;
    const table = parseTableAtPosition(text, 2, 2);
    expect(tablePreviewMarkdown(table!)).toContain("\\|");
  });
});
