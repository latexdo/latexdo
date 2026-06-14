import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
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

function parseDiagnostics(output: string, projectPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileLinePattern = /^(.*?\.tex):(\d+):(?:(\d+):)?\s*(.*)$/gm;
  const warningPattern =
    /^(?:LaTeX|Package [^:]+) Warning:\s*(.+?)(?:\s+on input line (\d+))?\.?$/gm;

  for (const match of output.matchAll(fileLinePattern)) {
    const message = match[4].trim();
    const severity = /warning/i.test(message) ? "warning" : "error";
    const absoluteFile = path.isAbsolute(match[1])
      ? match[1]
      : path.join(projectPath, match[1]);
    const file = path.relative(projectPath, absoluteFile);
    const key = `${file}:${match[2]}:${message}`;

    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push({
        file,
        line: Number(match[2]),
        column: Number(match[3] ?? 1),
        severity,
        message: message.replace(/^!+\s*/, ""),
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
        "latexmk was not found. Install MacTeX, TeX Live, or MiKTeX and restart TeXly.",
    };
  }

  const buildDirectory = path.join(request.projectPath, ".texly", "build");
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
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        output,
        diagnostics: parseDiagnostics(output, request.projectPath),
        error: error.message,
      });
    });
    child.on("close", (code) => {
      const pdfName = `${path.basename(request.rootFile, path.extname(request.rootFile))}.pdf`;
      const pdfPath = path.join(buildDirectory, pdfName);
      resolve({
        ok: code === 0,
        pdfPath: code === 0 ? pdfPath : undefined,
        durationMs: Math.round(performance.now() - startedAt),
        output,
        diagnostics: parseDiagnostics(output, request.projectPath),
        error: code === 0 ? undefined : `LaTeX exited with code ${code ?? "unknown"}.`,
      });
    });
  });
}
