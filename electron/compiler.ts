import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CompileRequest, CompileResult, Diagnostic } from "./types.js";

const executableCandidates =
  process.platform === "darwin"
    ? ["/Library/TeX/texbin/latexmk", "/usr/local/bin/latexmk", "latexmk"]
    : ["latexmk"];

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

function diagnosticSuggestion(message: string): string | undefined {
  const normalized = message.toLowerCase();

  if (normalized.includes("undefined control sequence")) {
    return "Check the command on that line for a typo, or add the package that defines it.";
  }
  if (normalized.includes("missing $ inserted")) {
    return "Move math-only content into math mode using $...$, \\(...\\), or an equation environment.";
  }
  if (normalized.includes("extra }, or forgotten $")) {
    return "Balance braces and verify that every math opener has a matching closing delimiter.";
  }
  if (normalized.includes("runaway argument")) {
    return "A command or environment argument was not closed. Look just before this line for a missing } or \\end{...}.";
  }
  if (normalized.includes("file `") && normalized.includes("' not found")) {
    return "Verify the filename, extension, and relative path, then make sure the file actually exists in the project.";
  }
  if (normalized.includes("citation") && normalized.includes("undefined")) {
    return "Check the citation key in your .tex file and confirm the matching entry exists in a loaded .bib file.";
  }
  if (normalized.includes("reference") && normalized.includes("undefined")) {
    return "Check the \\label and \\ref names. References also need another compile pass after labels are created.";
  }
  if (normalized.includes("there were undefined references")) {
    return "One or more \\ref commands do not match an existing \\label, or the document needs another compile pass.";
  }
  if (normalized.includes("there were undefined citations")) {
    return "One or more \\cite commands do not match a BibTeX entry, or bibliography processing has not completed.";
  }

  return undefined;
}

function diagnosticDetail(message: string, file: string, line: number): string {
  const location = file ? `${file}:${line}` : `line ${line}`;
  const normalized = message.toLowerCase();

  if (normalized.includes("undefined control sequence")) {
    return `LaTeX found a command it does not know at ${location}.`;
  }
  if (normalized.includes("missing $ inserted")) {
    return `LaTeX found math-only syntax outside math mode near ${location}.`;
  }
  if (normalized.includes("extra }, or forgotten $")) {
    return `The grouping or math delimiters are unbalanced near ${location}.`;
  }
  if (normalized.includes("runaway argument")) {
    return `A command argument or environment likely stays open past ${location}.`;
  }
  if (normalized.includes("file `") && normalized.includes("' not found")) {
    return `A required file could not be loaded while compiling near ${location}.`;
  }
  if (normalized.includes("citation") && normalized.includes("undefined")) {
    return `A citation key used near ${location} does not resolve to a bibliography entry.`;
  }
  if (normalized.includes("reference") && normalized.includes("undefined")) {
    return `A \\ref-style command near ${location} does not resolve to a known label.`;
  }

  return `LaTeX reported a problem near ${location}.`;
}

function extractSourceSnippet(output: string, line: number): string | undefined {
  const escapedLine = String(line).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`l\\.${escapedLine}\\s(.*)`);
  const match = output.match(pattern);
  return match?.[1]?.trim() || undefined;
}

async function enrichDiagnostics(
  diagnostics: Diagnostic[],
  output: string,
  projectPath: string,
): Promise<Diagnostic[]> {
  const fileCache = new Map<string, string>();

  return Promise.all(
    diagnostics.map(async (diagnostic) => {
      const sourceSnippetFromOutput = extractSourceSnippet(output, diagnostic.line);
      let sourceLine = sourceSnippetFromOutput;

      if (!sourceLine && diagnostic.file) {
        const relativePath = normalizeDiagnosticFile(projectPath, diagnostic.file);
        let content = fileCache.get(relativePath);
        if (content === undefined) {
          try {
            content = await readFile(path.join(projectPath, relativePath), "utf8");
          } catch {
            content = "";
          }
          fileCache.set(relativePath, content);
        }

        const lines = content.split(/\r?\n/);
        sourceLine = lines[diagnostic.line - 1]?.trim() || undefined;
      }

      return {
        ...diagnostic,
        detail: diagnosticDetail(
          diagnostic.message,
          diagnostic.file,
          diagnostic.line,
        ),
        suggestion: diagnosticSuggestion(diagnostic.message),
        sourceLine,
      };
    }),
  );
}

function parseDiagnostics(output: string, projectPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileLinePattern = /^(.*?\.tex):(\d+):(?:(\d+):)?\s*(.*)$/gm;
  const warningPattern =
    /^(?:LaTeX|Package [^:]+) Warning:\s*(.+?)(?:\s+on input line (\d+))?\.?$/gm;

  for (const match of output.matchAll(fileLinePattern)) {
    const message = cleanLatexMessage(match[4]);
    const severity = /warning/i.test(message) ? "warning" : "error";
    const file = normalizeDiagnosticFile(projectPath, match[1]);
    const key = `${file}:${match[2]}:${message}`;

    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push({
        file,
        line: Number(match[2]),
        column: Number(match[3] ?? 1),
        severity,
        message,
        source: "latex",
      });
    }
  }

  for (const match of output.matchAll(warningPattern)) {
    const message = match[1].replace(/\s+/g, " ").trim();
    const line = Number(match[2] ?? 1);
    const key = `warning:${line}:${message}`;

    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push({
        file: "",
        line,
        column: 1,
        severity: "warning",
        message,
        source: "latex",
      });
    }
  }

  return diagnostics.slice(0, 100);
}

export async function compileLatex(
  request: CompileRequest,
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

  const buildDirectory = path.join(request.projectPath, ".latexdo", "build");
  await mkdir(buildDirectory, { recursive: true });

  const engineFlag = {
    pdflatex: "-pdf",
    xelatex: "-xelatex",
    lualatex: "-lualatex",
  }[request.engine];

  const args = [
    engineFlag,
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
      void enrichDiagnostics(
        parseDiagnostics(output, request.projectPath),
        output,
        request.projectPath,
      ).then((diagnostics) => {
        resolve({
          ok: false,
          durationMs: Math.round(performance.now() - startedAt),
          output,
          diagnostics,
          error: error.message,
        });
      });
    });
    child.on("close", (code) => {
      const pdfName = `${path.basename(request.rootFile, path.extname(request.rootFile))}.pdf`;
      const pdfPath = path.join(buildDirectory, pdfName);
      void enrichDiagnostics(
        parseDiagnostics(output, request.projectPath),
        output,
        request.projectPath,
      ).then((diagnostics) => {
        resolve({
          ok: code === 0,
          pdfPath: code === 0 ? pdfPath : undefined,
          durationMs: Math.round(performance.now() - startedAt),
          output,
          diagnostics,
          error:
            code === 0 ? undefined : `LaTeX exited with code ${code ?? "unknown"}.`,
        });
      });
    });
  });
}
