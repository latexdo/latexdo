import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeLatexDiagnostic, rankLatexDiagnostics } from "./latexDiagnostics.js";
import type { CompileResult, Diagnostic } from "./types.js";

type CompileLatexRequest = {
  projectPath: string;
  rootFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
};

type CompileAsymptoteRequest = {
  projectPath: string;
  relativePath: string;
};

const executableCandidates =
  process.platform === "darwin"
    ? ["/Library/TeX/texbin/latexmk", "/usr/local/bin/latexmk", "latexmk"]
    : ["latexmk"];

const asymptoteExecutableCandidates =
  process.platform === "darwin"
    ? ["/Library/TeX/texbin/asy", "/usr/local/bin/asy", "asy"]
    : ["asy"];

async function findLatexmk(): Promise<string | null> {
  for (const candidate of executableCandidates) {
    if (!path.isAbsolute(candidate)) {
      return candidate;
    }

    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known TeX installation path.
    }
  }

  return null;
}

async function findAsymptote(): Promise<string | null> {
  for (const candidate of asymptoteExecutableCandidates) {
    if (!path.isAbsolute(candidate)) {
      return candidate;
    }

    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known TeX installation path.
    }
  }

  return null;
}

function cleanLatexMessage(message: string): string {
  return message
    .replace(/^!+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDiagnosticFile(projectPath: string, filePath: string): string {
  const absoluteFile = path.isAbsolute(filePath)
    ? filePath
    : path.join(projectPath, filePath);
  return path.relative(projectPath, absoluteFile);
}

function sanitizeCompileOutput(output: string): string {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd());

  const staleLatexmkFailure =
    lines.some((line) =>
      line.includes("gave an error in previous invocation of latexmk"),
    ) && lines.some((line) => line.includes("Nothing to do for"));

  if (!staleLatexmkFailure) {
    return output.trim();
  }

  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed.startsWith("Rc files read:")) {
      return false;
    }
    if (trimmed === "NONE") {
      return false;
    }
    if (trimmed.startsWith("Latexmk: This is Latexmk")) {
      return false;
    }
    if (trimmed.startsWith("Latexmk: Nothing to do for")) {
      return false;
    }
    if (trimmed.startsWith("Latexmk: All targets")) {
      return false;
    }
    if (trimmed.startsWith("Collected error summary")) {
      return false;
    }
    if (trimmed.includes("gave an error in previous invocation of latexmk")) {
      return false;
    }
    if (trimmed.startsWith("Latexmk: Sometimes, the -f option")) {
      return false;
    }
    if (trimmed.startsWith("to try to force complete processing.")) {
      return false;
    }
    if (trimmed.startsWith("But normally, you will need to correct")) {
      return false;
    }
    if (trimmed.startsWith("error, and then rerun latexmk.")) {
      return false;
    }
    if (trimmed.startsWith("In some cases, it is best to clean out")) {
      return false;
    }
    if (trimmed.startsWith("latexmk after you've corrected the files.")) {
      return false;
    }
    return true;
  });

  return (
    filtered.join("\n").trim() ||
    "LatexDo forced a fresh compile because latexmk was stuck on a previous failed run."
  );
}

async function enrichDiagnostics(
  diagnostics: Diagnostic[],
  output: string,
  projectPath: string,
): Promise<Diagnostic[]> {
  const fileCache = new Map<string, string>();

  const enriched = await Promise.all(
    diagnostics.map(async (diagnostic) => {
      let content: string | undefined;
      if (diagnostic.file) {
        const relativePath = normalizeDiagnosticFile(projectPath, diagnostic.file);
        content = fileCache.get(relativePath);
        if (content === undefined) {
          try {
            content = await readFile(path.join(projectPath, relativePath), "utf8");
          } catch {
            content = "";
          }
          fileCache.set(relativePath, content);
        }
      }

      const analysis = analyzeLatexDiagnostic(diagnostic, content, output);
      return {
        ...diagnostic,
        ...analysis,
      };
    }),
  );
  return rankLatexDiagnostics(enriched);
}

function warningLineRange(message: string): {
  line: number;
  endLine?: number;
} {
  const inputLineMatch = message.match(/\bon input line\s+(\d+)/i);
  if (inputLineMatch) {
    return { line: Number(inputLineMatch[1]) };
  }

  const lineRangeMatch = message.match(/\bat lines?\s+(\d+)(?:--(\d+))?/i);
  if (lineRangeMatch) {
    return {
      line: Number(lineRangeMatch[1]),
      endLine: lineRangeMatch[2] ? Number(lineRangeMatch[2]) : undefined,
    };
  }

  return { line: 1 };
}

function cleanWarningMessage(message: string): string {
  return message
    .replace(/^\([^)]+\)\s*/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\.$/, "")
    .trim();
}

function warningContinuationText(line: string): string | null {
  const packageContinuation = line.match(/^\([^)]+\)\s*(.*)$/);
  if (packageContinuation) {
    return packageContinuation[1].trim();
  }

  if (/^\s{2,}\S/.test(line)) {
    return line.trim();
  }

  return null;
}

function relatedProblemStartIndex(lines: string[], errorIndex: number): number {
  for (
    let index = errorIndex - 1;
    index >= Math.max(0, errorIndex - 4);
    index -= 1
  ) {
    const trimmed = lines[index].trim();
    if (/^Runaway argument\??/i.test(trimmed)) {
      return index;
    }
    if (trimmed && /^!\s*/.test(trimmed)) {
      break;
    }
  }

  return errorIndex;
}

function compilerExcerpt(
  lines: string[],
  startIndex: number,
  maxLines = 10,
): string {
  const excerpt: string[] = [];
  const end = Math.min(lines.length, startIndex + maxLines);
  const startsWithRunawayArgument = /^Runaway argument\??/i.test(
    lines[startIndex]?.trim() ?? "",
  );
  let includedBangLine = /^!\s*/.test(lines[startIndex]?.trim() ?? "");

  for (let index = startIndex; index < end; index += 1) {
    const line = lines[index].trimEnd();
    if (!line.trim() && !excerpt.length) {
      continue;
    }
    if (index > startIndex && /^!\s*/.test(line)) {
      if (includedBangLine || !startsWithRunawayArgument) {
        break;
      }
      includedBangLine = true;
    }

    excerpt.push(line);

    if (/^\?\s*$/.test(line.trim())) {
      break;
    }
  }

  return excerpt.join("\n").trim();
}

function contextualErrorMessage(
  lines: string[],
  errorIndex: number,
  errorText: string,
): string {
  const message = cleanLatexMessage(errorText);
  const startIndex = relatedProblemStartIndex(lines, errorIndex);
  if (startIndex === errorIndex) {
    return message;
  }

  return `${cleanLatexMessage(lines[startIndex])} ${message}`.trim();
}

function lineLocationAfter(
  lines: string[],
  startIndex: number,
): { line: number } | null {
  for (
    let index = startIndex + 1;
    index < Math.min(lines.length, startIndex + 12);
    index += 1
  ) {
    const lineMatch = lines[index].match(/^l\.(\d+)\s*(.*)$/);
    if (lineMatch) {
      return {
        line: Number(lineMatch[1]),
      };
    }
  }

  return null;
}

function fallbackProblemBlock(
  lines: string[],
): { line: number; message: string; excerpt: string } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      continue;
    }

    const bangMatch = trimmed.match(/^!\s*(.+)$/);
    const explicitErrorMatch = trimmed.match(
      /^(?:(?:LaTeX|Package\s+[^:]+|Class\s+[^:]+)\s+Error:\s*.+|Emergency stop\.|Fatal error occurred.*)$/i,
    );
    const isRunawayArgument = /^Runaway argument\??/i.test(trimmed);

    if (!bangMatch && !explicitErrorMatch && !isRunawayArgument) {
      continue;
    }

    const startIndex = isRunawayArgument ? index : relatedProblemStartIndex(lines, index);
    const location = lineLocationAfter(lines, startIndex);
    return {
      line: location?.line ?? 1,
      message: isRunawayArgument
        ? cleanLatexMessage(trimmed)
        : bangMatch
          ? contextualErrorMessage(lines, index, bangMatch[1])
          : cleanLatexMessage(trimmed),
      excerpt: compilerExcerpt(lines, startIndex),
    };
  }

  return null;
}

export function parseDiagnostics(
  output: string,
  projectPath: string,
  rootFile: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileLinePattern = /^(.*?\.(?:tex|sty|cls|bib)):(\d+):(?:(\d+):)?\s*(.*)$/gm;
  const warningStartPattern =
    /^(?:LaTeX|Package\s+[^:]+|Class\s+[^:]+)\s+Warning:\s*(.*)$/;
  const boxWarningPattern =
    /^(?:(?:Over|Under)full \\[hv]box\b.*?)(?:\bat lines?\s+\d+(?:--\d+)?)?.*$/;

  const addDiagnostic = (diagnostic: Diagnostic) => {
    const key = `${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(diagnostic);
    }
  };

  for (const match of output.matchAll(fileLinePattern)) {
    const message = cleanLatexMessage(match[4]);
    const severity = /warning/i.test(message) ? "warning" : "error";
    const file = normalizeDiagnosticFile(projectPath, match[1]);
    addDiagnostic({
      file,
      line: Number(match[2]),
      column: Number(match[3] ?? 1),
      severity,
      message,
      compilerExcerpt: match[0].trim(),
      source: "latex",
    });
  }

  const outputLines = output.split(/\r?\n/);
  for (let index = 0; index < outputLines.length; index += 1) {
    const warningMatch = outputLines[index].match(warningStartPattern);
    if (warningMatch) {
      const warningParts = [warningMatch[1]];
      for (
        let continuationIndex = index + 1;
        continuationIndex < Math.min(outputLines.length, index + 8);
        continuationIndex += 1
      ) {
        const continuationLine = outputLines[continuationIndex];
        fileLinePattern.lastIndex = 0;
        if (
          warningStartPattern.test(continuationLine) ||
          fileLinePattern.test(continuationLine) ||
          /^!\s*/.test(continuationLine)
        ) {
          break;
        }

        const continuation = warningContinuationText(continuationLine);
        if (!continuation) {
          break;
        }
        warningParts.push(continuation);
      }

      const message = cleanWarningMessage(warningParts.join(" "));
      const { line, endLine } = warningLineRange(message);
      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line,
        endLine,
        column: 1,
        severity: "warning",
        message,
        compilerExcerpt: warningParts.join("\n").trim(),
        source: "latex",
      });
      continue;
    }

    const boxWarningMatch = outputLines[index].match(boxWarningPattern);
    if (boxWarningMatch) {
      const message = cleanWarningMessage(boxWarningMatch[0]);
      const { line, endLine } = warningLineRange(message);
      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line,
        endLine,
        column: 1,
        severity: "warning",
        message,
        compilerExcerpt: message,
        source: "latex",
      });
    }
  }

  for (let index = 0; index < outputLines.length; index += 1) {
    const errorMatch = outputLines[index].match(/^!\s*(.+)$/);
    if (!errorMatch) {
      continue;
    }

    const startIndex = relatedProblemStartIndex(outputLines, index);
    const excerpt = compilerExcerpt(outputLines, startIndex);
    const message = contextualErrorMessage(outputLines, index, errorMatch[1]);

    for (
      let contextIndex = index + 1;
      contextIndex < Math.min(outputLines.length, index + 8);
      contextIndex += 1
    ) {
      const lineMatch = outputLines[contextIndex].match(/^l\.(\d+)\s*(.*)$/);
      if (!lineMatch) {
        continue;
      }

      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line: Number(lineMatch[1]),
        column: 1,
        severity: "error",
        message,
        compilerExcerpt: excerpt,
        source: "latex",
      });
      break;
    }
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    const fallback = fallbackProblemBlock(outputLines);
    if (fallback) {
      addDiagnostic({
        file: normalizeDiagnosticFile(projectPath, rootFile),
        line: fallback.line,
        column: 1,
        severity: "error",
        message: fallback.message,
        detail:
          "LaTeX did not report a precise source line for this failure, so LatexDo is showing the first explicit compiler problem.",
        compilerExcerpt: fallback.excerpt,
        source: "latex",
        locationAccuracy: "inferred",
        locationConfidence: 20,
      });
    }
  }

  return diagnostics.slice(0, 100);
}

export async function compileLatex(
  request: CompileLatexRequest,
): Promise<CompileResult> {
  const startedAt = performance.now();
  const latexmk = await findLatexmk();

  if (!latexmk) {
    return {
      ok: false,
      durationMs: 0,
      output: "",
      diagnostics: [],
      error:
        "latexmk was not found. Install MacTeX, TeX Live, or MiKTeX and restart LatexDo.",
    };
  }

  const buildDirectory = path.join(
    request.projectPath,
    ".latexdo",
    "build",
    `job-${randomUUID()}`,
  );
  await mkdir(buildDirectory, { recursive: true });

  const engineFlag = {
    pdflatex: "-pdf",
    xelatex: "-xelatex",
    lualatex: "-lualatex",
  }[request.engine];

  const args = [
    engineFlag,
    "-g",
    "-synctex=1",
    "-interaction=nonstopmode",
    "-file-line-error",
    "-halt-on-error",
    `-outdir=${buildDirectory}`,
    request.rootFile,
  ];

  return new Promise((resolve) => {
    const child = spawn(latexmk, args, {
      cwd: request.projectPath,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:${process.env.PATH ?? ""}`,
      },
      windowsHide: true,
    });

    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.on("error", (error) => {
      const cleanedOutput = sanitizeCompileOutput(output);
      void enrichDiagnostics(
        parseDiagnostics(cleanedOutput, request.projectPath, request.rootFile),
        cleanedOutput,
        request.projectPath,
      ).then((diagnostics) => {
        resolve({
          ok: false,
          durationMs: Math.round(performance.now() - startedAt),
          output: cleanedOutput,
          diagnostics,
          error: error.message,
        });
      });
    });
    child.on("close", (code) => {
      const pdfName = `${path.basename(request.rootFile, path.extname(request.rootFile))}.pdf`;
      const pdfPath = path.join(buildDirectory, pdfName);
      const cleanedOutput = sanitizeCompileOutput(output);
      void enrichDiagnostics(
        parseDiagnostics(cleanedOutput, request.projectPath, request.rootFile),
        cleanedOutput,
        request.projectPath,
      ).then((diagnostics) => {
        resolve({
          ok: code === 0,
          pdfPath: code === 0 ? pdfPath : undefined,
          durationMs: Math.round(performance.now() - startedAt),
          output: cleanedOutput,
          diagnostics,
          error:
            code === 0 ? undefined : `LaTeX exited with code ${code ?? "unknown"}.`,
        });
      });
    });
  });
}

function parseAsymptoteDiagnostics(output: string, relativePath: string): Diagnostic[] {
  if (!output.trim()) {
    return [];
  }

  const lineMatch =
    output.match(/(?:line|:)\s*(\d+)(?:[.:,]\s*(\d+))?/i) ??
    output.match(
      new RegExp(
        `${relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)(?::(\\d+))?`,
      ),
    );
  const line = lineMatch ? Math.max(1, Number(lineMatch[1])) : 1;
  const column = lineMatch?.[2] ? Math.max(1, Number(lineMatch[2])) : 1;
  const firstLine = output
    .split(/\r?\n/)
    .map((lineText) => lineText.trim())
    .find(Boolean);

  return [
    {
      file: relativePath,
      line,
      column,
      severity: "error",
      message: firstLine ?? "Asymptote compilation failed.",
      detail: output.trim().slice(0, 1200),
      source: "latex",
      locationAccuracy: lineMatch ? "line" : "inferred",
    },
  ];
}

export async function compileAsymptote(
  request: CompileAsymptoteRequest,
): Promise<CompileResult> {
  const startedAt = performance.now();
  const asymptote = await findAsymptote();

  if (!asymptote) {
    return {
      ok: false,
      durationMs: 0,
      output: "",
      diagnostics: [],
      error:
        "Asymptote was not found. Install Asymptote from TeX Live, MacTeX, or MiKTeX and restart LatexDo.",
    };
  }

  const buildDirectory = path.join(
    request.projectPath,
    ".latexdo",
    "build",
    `asy-${randomUUID()}`,
  );
  await mkdir(buildDirectory, { recursive: true });

  const outputBase = path.join(
    buildDirectory,
    path.basename(request.relativePath, path.extname(request.relativePath)),
  );
  const outputPdf = `${outputBase}.pdf`;
  const args = ["-f", "pdf", "-o", outputBase, request.relativePath];

  return new Promise((resolve) => {
    const child = spawn(asymptote, args, {
      cwd: request.projectPath,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:${process.env.PATH ?? ""}`,
      },
      windowsHide: true,
    });

    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.on("error", (error) => {
      const cleanedOutput = sanitizeCompileOutput(output);
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        output: cleanedOutput,
        diagnostics: parseAsymptoteDiagnostics(
          cleanedOutput || error.message,
          request.relativePath,
        ),
        error: error.message,
      });
    });
    child.on("close", (code) => {
      const cleanedOutput = sanitizeCompileOutput(output);
      resolve({
        ok: code === 0,
        pdfPath: code === 0 ? outputPdf : undefined,
        durationMs: Math.round(performance.now() - startedAt),
        output: cleanedOutput,
        diagnostics:
          code === 0
            ? []
            : parseAsymptoteDiagnostics(cleanedOutput, request.relativePath),
        error:
          code === 0 ? undefined : `Asymptote exited with code ${code ?? "unknown"}.`,
      });
    });
  });
}
