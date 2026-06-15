import assert from "node:assert/strict";
import {
  analyzeLatexDiagnostic,
  rankLatexDiagnostics,
} from "../electron/latexDiagnostics.ts";
import type { Diagnostic } from "../electron/types.ts";

function diagnostic(message: string, line: number): Diagnostic {
  return {
    file: "main.tex",
    line,
    column: 1,
    severity: "error",
    message,
    source: "latex",
  };
}

const unknownCommand = analyzeLatexDiagnostic(
  diagnostic("Undefined control sequence.", 3),
  "\\documentclass{article}\n\\begin{document}\nHello \\doesnotexist world\n\\end{document}\n",
  "! Undefined control sequence.\nl.3 Hello \\doesnotexist world",
);
assert.equal(unknownCommand.title, "Unknown LaTeX command");
assert.equal(unknownCommand.line, 3);
assert.equal(unknownCommand.column, 7);
assert.equal(unknownCommand.highlightText, "\\doesnotexist");
assert.equal(unknownCommand.locationAccuracy, "exact");

const missingMathMode = analyzeLatexDiagnostic(
  diagnostic("Missing $ inserted.", 3),
  "\\documentclass{article}\n\\begin{document}\nfile_name\n\\end{document}\n",
  "! Missing $ inserted.\nl.3 file_name",
);
assert.equal(missingMathMode.title, "Math syntax used outside math mode");
assert.equal(missingMathMode.column, 5);
assert.equal(missingMathMode.highlightText, "_");
assert.equal(missingMathMode.fixes?.[0]?.replacement, "\\_");
assert.equal(missingMathMode.fixes?.[0]?.column, 5);

const missingFile = analyzeLatexDiagnostic(
  diagnostic("LaTeX Error: File `missing-image.png' not found.", 3),
  "\\documentclass{article}\n\\begin{document}\n\\includegraphics{missing-image.png}\n\\end{document}\n",
  "",
);
assert.equal(missingFile.title, "Required file not found");
assert.equal(missingFile.column, 18);
assert.equal(missingFile.highlightText, "missing-image.png");

const runawayArgument = analyzeLatexDiagnostic(
  diagnostic("Runaway argument?", 5),
  "\\documentclass{article}\n\\begin{document}\n\\textbf{This argument\ncontinues here\n\\end{document}\n",
  "! Runaway argument?\nl.5 \\end{document}",
);
assert.equal(runawayArgument.title, "Command argument was never closed");
assert.equal(runawayArgument.line, 3);
assert.equal(runawayArgument.column, 8);
assert.equal(runawayArgument.highlightText, "{");
assert.equal(runawayArgument.sourceContext?.find((line) => line.focus)?.line, 3);
assert.equal(runawayArgument.reportedLine, 5);
assert.equal(runawayArgument.locationConfidence, 99);

const unclosedMath = analyzeLatexDiagnostic(
  diagnostic("Missing $ inserted.", 5),
  "\\documentclass{article}\n\\begin{document}\nThe value is $x + 1\nMore text\n\\end{document}\n",
  "! Missing $ inserted.\nl.5 \\end{document}",
);
assert.equal(unclosedMath.title, "Math mode was opened but never closed");
assert.equal(unclosedMath.line, 3);
assert.equal(unclosedMath.column, 14);
assert.equal(unclosedMath.highlightText, "$");
assert.equal(unclosedMath.locationAccuracy, "exact");
assert.equal(unclosedMath.reportedLine, 5);

const mismatchedEnvironment = analyzeLatexDiagnostic(
  diagnostic(
    "LaTeX Error: \\begin{itemize} on input line 3 ended by \\end{enumerate}.",
    5,
  ),
  "\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n\\item One\n\\end{enumerate}\n\\end{document}\n",
  "",
);
assert.equal(
  mismatchedEnvironment.title,
  "Environment is not closed correctly",
);
assert.equal(mismatchedEnvironment.line, 5);
assert.equal(mismatchedEnvironment.column, 1);
assert.equal(mismatchedEnvironment.highlightText, "\\end{enumerate}");
assert.equal(mismatchedEnvironment.locationConfidence, 100);

const extraClosingBrace = analyzeLatexDiagnostic(
  diagnostic("Extra }, or forgotten $.", 4),
  "\\documentclass{article}\n\\begin{document}\nText\nExtra }\n\\end{document}\n",
  "",
);
assert.equal(extraClosingBrace.title, "Unexpected closing brace");
assert.equal(extraClosingBrace.line, 4);
assert.equal(extraClosingBrace.column, 7);
assert.equal(extraClosingBrace.locationConfidence, 100);
assert.equal(extraClosingBrace.fixes?.[0]?.replacement, "");

const commandTypo = analyzeLatexDiagnostic(
  diagnostic("Undefined control sequence.", 3),
  "\\documentclass{article}\n\\begin{document}\n\\secton{Introduction}\n\\end{document}\n",
  "! Undefined control sequence.\nl.3 \\secton{Introduction}",
);
assert.equal(commandTypo.highlightText, "\\secton");
assert.equal(commandTypo.fixes?.[0]?.replacement, "\\section");
assert.equal(commandTypo.fixes?.[0]?.confidence, 98);

const ampersand = analyzeLatexDiagnostic(
  diagnostic("Misplaced alignment tab character &.", 3),
  "\\documentclass{article}\n\\begin{document}\nResearch & Development\n\\end{document}\n",
  "",
);
assert.equal(ampersand.highlightText, "&");
assert.equal(ampersand.fixes?.[0]?.replacement, "\\&");

const environmentFix = analyzeLatexDiagnostic(
  diagnostic(
    "LaTeX Error: \\begin{itemize} on input line 3 ended by \\end{enumerate}.",
    5,
  ),
  "\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n\\item One\n\\end{enumerate}\n\\end{document}\n",
  "",
);
assert.equal(environmentFix.fixes?.[0]?.replacement, "\\end{itemize}");
assert.equal(environmentFix.fixes?.[0]?.confidence, 100);

const ranked = rankLatexDiagnostics([
  {
    ...diagnostic("Runaway argument?", 5),
    title: "Command argument was never closed",
    reportedLine: 5,
  },
  {
    ...diagnostic("Emergency stop.", 5),
    title: "LaTeX compilation error",
    reportedLine: 5,
  },
  {
    ...diagnostic("Reference `later' undefined", 8),
    severity: "warning",
  },
]);
assert.equal(ranked[0].isPrimary, true);
assert.equal(ranked[1].isCascade, true);
assert.match(ranked[1].cascadeReason ?? "", /Fix the primary error first/);
assert.equal(ranked[2].isCascade, false);

console.log("LaTeX diagnostic analysis fixtures passed.");
