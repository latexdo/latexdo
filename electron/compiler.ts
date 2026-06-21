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

function parseDiagnostics(
  output: string,
  projectPath: string,
  rootFile: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileLinePattern = /^(.*?\.(?:tex|sty|cls|bib)):(\d+):(?:(\d+):)?\s*(.*)$/gm;
  const warningPattern =
    /^(?:LaTeX|Package [^:]+) Warning:\s*(.+?)(?:\s+on input line (\d+))?\.?$/gm;

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
      source: "latex",
    });
  }

  const outputLines = output.split(/\r?\n/);
  for (let index = 0; index < outputLines.length; index += 1) {
    const errorMatch = outputLines[index].match(/^!\s*(.+)$/);
    if (!errorMatch) {
      continue;
    }

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
        message: cleanLatexMessage(errorMatch[1]),
        source: "latex",
      });
      break;
    }
  }

  for (const match of output.matchAll(warningPattern)) {
    const message = match[1].replace(/\s+/g, " ").trim();
    const line = Number(match[2] ?? 1);
    addDiagnostic({
      file: normalizeDiagnosticFile(projectPath, rootFile),
      line,
      column: 1,
      severity: "warning",
      message,
      source: "latex",
    });
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
