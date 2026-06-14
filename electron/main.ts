import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileLatex } from "./compiler.js";
import { backwardSyncTex, forwardSyncTex } from "./synctex.js";
import type { CompileRequest, ProjectEntry } from "./types.js";
import { registerTerminalIpc } from "./terminal.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let welcomeProjectPromise: Promise<string> | null = null;
const starterDocument = String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{microtype}
\usepackage{hyperref}

\title{My LatexDo Document}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Start writing here.

\end{document}
`;

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(projectPath: string, targetPath: string): void {
  if (!isInside(projectPath, targetPath)) {
    throw new Error("The requested path is outside the open project.");
  }
}

function resolveProjectPath(projectPath: string, relativePath: string): string {
  const cleanPath = relativePath.trim();
  if (!cleanPath || path.isAbsolute(cleanPath)) {
    throw new Error("Enter a relative path inside the project.");
  }

  const targetPath = path.resolve(projectPath, cleanPath);
  assertInside(projectPath, targetPath);
  return targetPath;
}

function starterContent(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".tex" && path.basename(relativePath) === "main.tex") {
    return starterDocument;
  }
  if (extension === ".bib") {
    return "% Add BibTeX entries here.\n";
  }
  return "";
}

async function listProject(
  projectPath: string,
  directory = projectPath,
): Promise<ProjectEntry[]> {
  const hidden = new Set([".git", ".latexdo", "node_modules", "dist"]);
  const entries = await readdir(directory, { withFileTypes: true });
  const result: ProjectEntry[] = [];

  for (const entry of entries) {
    if (hidden.has(entry.name) || entry.name === ".DS_Store") {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(projectPath, absolutePath);

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: absolutePath,
        relativePath,
        type: "directory",
        children: await listProject(projectPath, absolutePath),
      });
    } else {
      result.push({
        name: entry.name,
        path: absolutePath,
        relativePath,
        type: "file",
      });
    }
  }

  return result.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function initializeWelcomeProject(): Promise<string> {
  const projectPath = path.join(app.getPath("userData"), "projects", "Welcome");
  const mainFile = path.join(projectPath, "main.tex");

  try {
    await stat(mainFile);
  } catch {
    const source = app.isPackaged
      ? path.join(process.resourcesPath, "examples", "welcome")
      : path.join(process.cwd(), "examples", "welcome");
    await mkdir(projectPath, { recursive: true });
    await cp(source, projectPath, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }

  return projectPath;
}

function ensureWelcomeProject(): Promise<string> {
  welcomeProjectPromise ??= initializeWelcomeProject().catch((error) => {
    welcomeProjectPromise = null;
    throw error;
  });
  return welcomeProjectPromise;
}

function createWindow(): void {
  nativeTheme.themeSource = "dark";
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "LatexDo",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void window.loadFile(path.join(currentDirectory, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  registerTerminalIpc();
  ipcMain.handle("project:get-welcome", ensureWelcomeProject);
  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Open LaTeX project",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("project:create", async () => {
    const result = await dialog.showSaveDialog({
      title: "Create LaTeX project",
      defaultPath: path.join(app.getPath("documents"), "My LaTeX Project"),
      buttonLabel: "Create Project",
      nameFieldLabel: "Project name",
      showsTagField: false,
    });
    if (result.canceled || !result.filePath) {
      return null;
    }

    const projectPath = result.filePath;
    try {
      await mkdir(projectPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("A file or folder with that project name already exists.");
      }
      throw error;
    }
    await writeFile(path.join(projectPath, "main.tex"), starterDocument, "utf8");
    return projectPath;
  });
  ipcMain.handle("project:list", async (_event, projectPath: string) => {
    return listProject(projectPath);
  });
  ipcMain.handle(
    "file:read",
    async (_event, projectPath: string, filePath: string) => {
      assertInside(projectPath, filePath);
      return readFile(filePath, "utf8");
    },
  );
  ipcMain.handle(
    "file:write",
    async (
      _event,
      projectPath: string,
      filePath: string,
      content: string,
    ) => {
      assertInside(projectPath, filePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    },
  );
  ipcMain.handle(
    "file:create",
    async (_event, projectPath: string, relativePath: string) => {
      const filePath = resolveProjectPath(projectPath, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      try {
        await writeFile(filePath, starterContent(relativePath), {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`"${relativePath}" already exists.`);
        }
        throw error;
      }
      return filePath;
    },
  );
  ipcMain.handle(
    "folder:create",
    async (_event, projectPath: string, relativePath: string) => {
      const folderPath = resolveProjectPath(projectPath, relativePath);
      try {
        await mkdir(folderPath, { recursive: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`"${relativePath}" already exists.`);
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error("Create the parent folder first.");
        }
        throw error;
      }
      return folderPath;
    },
  );
  ipcMain.handle("latex:compile", async (_event, request: CompileRequest) => {
    const rootPath = path.join(request.projectPath, request.rootFile);
    assertInside(request.projectPath, rootPath);
    return compileLatex(request);
  });
  ipcMain.handle(
    "pdf:read",
    async (_event, projectPath: string, pdfPath: string) => {
      assertInside(projectPath, pdfPath);
      return readFile(pdfPath);
    },
  );
  ipcMain.handle(
    "synctex:forward",
    async (
      _event,
      projectPath: string,
      pdfPath: string,
      inputPath: string,
      line: number,
      column: number,
    ) => {
      assertInside(projectPath, pdfPath);
      assertInside(projectPath, inputPath);
      return forwardSyncTex(
        projectPath,
        pdfPath,
        inputPath,
        line,
        column,
      );
    },
  );
  ipcMain.handle(
    "synctex:backward",
    async (
      _event,
      projectPath: string,
      pdfPath: string,
      page: number,
      x: number,
      y: number,
    ) => {
      assertInside(projectPath, pdfPath);
      return backwardSyncTex(projectPath, pdfPath, page, x, y);
    },
  );

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
