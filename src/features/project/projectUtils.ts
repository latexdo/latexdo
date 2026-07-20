import type { ProjectEntry } from "../../types";
import { fileNameForDisplay } from "../../pathDisplay";

export function fileName(filePath: string): string {
  return fileNameForDisplay(filePath);
}

export function languageFor(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "tex" || extension === "sty" || extension === "cls") {
    return "latex";
  }
  if (extension === "asy") {
    return "asymptote";
  }
  if (extension === "bib") {
    return "bibtex";
  }
  if (extension === "json") {
    return "json";
  }
  if (extension === "md") {
    return "markdown";
  }
  return "plaintext";
}

export function flattenEntries(entries: ProjectEntry[]): ProjectEntry[] {
  return entries.flatMap((entry) => [
    entry,
    ...(entry.children ? flattenEntries(entry.children) : []),
  ]);
}

export function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`;
}

export function normalizeRelativePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/(^|\/)\.\//g, "$1");
}

export function lineColumnAtOffset(
  content: string,
  offset: number,
): {
  line: number;
  column: number;
} {
  let line = 1;
  let column = 1;
  const safeOffset = Math.max(0, Math.min(content.length, offset));

  for (let index = 0; index < safeOffset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

export function joinRelativePath(directory: string, name: string): string {
  return normalizeRelativePath(`${directory}/${name}`).replace(/^\/+/, "");
}

export function createPathInDirectory(directory: string, name: string): string {
  const normalizedDirectory = normalizeRelativePath(directory).replace(/\/+$/, "");
  return normalizedDirectory ? joinRelativePath(normalizedDirectory, name) : name;
}

const imageFileExtensions = new Set(["png", "jpg", "jpeg", "pdf", "svg"]);

export function isImagePath(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return Boolean(extension && imageFileExtensions.has(extension));
}

export function latexSafeImagePath(filePath: string): string {
  return normalizeRelativePath(filePath).replace(/^\/+/, "");
}

export function latexFigureLabel(filePath: string): string {
  const baseName = fileName(filePath)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return baseName || "image";
}

export function latexFigureCode(filePath: string): string {
  const imagePath = latexSafeImagePath(filePath);
  const label = latexFigureLabel(filePath);
  return [
    "\\begin{figure}[ht]",
    "\\centering",
    `\\includegraphics[width=0.8\\textwidth]{${imagePath}}`,
    "\\caption{}",
    `\\label{fig:${label}}`,
    "\\end{figure}",
  ].join("\n");
}
