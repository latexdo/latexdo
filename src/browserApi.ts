import type { LatexDoApi, TerminalApi } from "../electron/preload.cjs";
import type {
  GitDiffEditorInput,
  GitDiffPreview,
  GitDiscardResult,
  GitHistorySummary,
  GitStatusSummary,
  OpenProject,
  ProjectEntry,
  ProofreadingSettings,
  SpellCheckerSettings,
} from "./types";
import { createCloudLatexDoApi } from "./cloudApi";

type BrowserLatexDoApi = LatexDoApi & {
  runtime: "browser";
};

interface BrowserProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  files: Record<string, string>;
  folders: string[];
  updatedAt: number;
}

interface BrowserStore {
  currentProjectId: string | null;
  projects: BrowserProjectRecord[];
  proofreadingSettings?: ProofreadingSettings;
  spellCheckerSettings?: SpellCheckerSettings;
}

type BrowserTreeNode = {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  children: Map<string, BrowserTreeNode>;
};

const browserStoreKey = "latexdo.browser.workspace.v1";
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

const defaultProofreadingSettings: ProofreadingSettings = {
  enabled: false,
  serverUrl: "https://api.languagetool.org/v2/check",
  language: "auto",
  picky: false,
  motherTongue: "",
};

const defaultSpellCheckerSettings: SpellCheckerSettings = {
  enabled: true,
  languages: ["en-US"],
  customWords: [],
  availableLanguages: ["en-US", "en-GB"],
  usesSystemLanguage: false,
};

function readStore(): BrowserStore {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(browserStoreKey) ?? "",
    ) as Partial<BrowserStore>;
    return {
      currentProjectId:
        typeof parsed.currentProjectId === "string" ? parsed.currentProjectId : null,
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.filter(isProjectRecord)
        : [],
      proofreadingSettings: isProofreadingSettings(parsed.proofreadingSettings)
        ? parsed.proofreadingSettings
        : undefined,
      spellCheckerSettings: isSpellCheckerSettings(parsed.spellCheckerSettings)
        ? parsed.spellCheckerSettings
        : undefined,
    };
  } catch {
    return {
      currentProjectId: null,
      projects: [],
    };
  }
}

function writeStore(store: BrowserStore): void {
  window.localStorage.setItem(browserStoreKey, JSON.stringify(store));
}

function isProjectRecord(value: unknown): value is BrowserProjectRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BrowserProjectRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.rootPath === "string" &&
    typeof record.files === "object" &&
    record.files !== null &&
    !Array.isArray(record.files) &&
    Array.isArray(record.folders)
  );
}

function isProofreadingSettings(value: unknown): value is ProofreadingSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<ProofreadingSettings>;
  return (
    typeof settings.enabled === "boolean" &&
    typeof settings.serverUrl === "string" &&
    typeof settings.language === "string" &&
    typeof settings.picky === "boolean" &&
    typeof settings.motherTongue === "string"
  );
}

function isSpellCheckerSettings(value: unknown): value is SpellCheckerSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<SpellCheckerSettings>;
  return (
    typeof settings.enabled === "boolean" &&
    Array.isArray(settings.languages) &&
    Array.isArray(settings.customWords) &&
    Array.isArray(settings.availableLanguages) &&
    typeof settings.usesSystemLanguage === "boolean"
  );
}

function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random()}`;
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/(^|\/)\.\//g, "$1")
    .replace(/\/+$/, "");

  if (
    !normalized ||
    normalized === "." ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Use a relative path inside the browser workspace.");
  }

  return normalized;
}

function parentPath(relativePath: string): string {
  const parts = relativePath.split("/");
  parts.pop();
  return parts.join("/");
}

function baseName(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

function projectToOpenProject(project: BrowserProjectRecord): OpenProject {
  return {
    id: project.id,
    rootPath: project.rootPath,
    name: project.name,
  };
}

function starterContent(relativePath: string): string {
  if (baseName(relativePath) === "main.tex") {
    return starterDocument;
  }
  if (relativePath.endsWith(".bib")) {
    return "% Add BibTeX entries here.\n";
  }
  return "";
}

function createProjectRecord(
  folderName = "LatexDo Browser Project",
): BrowserProjectRecord {
  const id = makeId();
  const name = folderName.trim() || "LatexDo Browser Project";
  return {
    id,
    name,
    rootPath: `browser://latexdo/${id}/${encodeURIComponent(name)}`,
    files: {
      "main.tex": starterDocument,
    },
    folders: [],
    updatedAt: Date.now(),
  };
}

function currentOrNewProject(store: BrowserStore): BrowserProjectRecord {
  const current =
    store.projects.find((project) => project.id === store.currentProjectId) ??
    store.projects[0];

  if (current) {
    store.currentProjectId = current.id;
    return current;
  }

  const project = createProjectRecord();
  store.projects.push(project);
  store.currentProjectId = project.id;
  return project;
}

function findProject(store: BrowserStore, projectId: string): BrowserProjectRecord {
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("The requested browser workspace is not open.");
  }
  return project;
}

function updateProject(
  projectId: string,
  update: (project: BrowserProjectRecord) => void,
): BrowserProjectRecord {
  const store = readStore();
  const project = findProject(store, projectId);
  update(project);
  project.updatedAt = Date.now();
  store.currentProjectId = project.id;
  writeStore(store);
  return project;
}

function allFolderPaths(project: BrowserProjectRecord): string[] {
  const folders = new Set(project.folders.map(normalizeRelativePath));

  Object.keys(project.files).forEach((filePath) => {
    const parts = filePath.split("/");
    parts.pop();
    let current = "";
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    });
  });

  return [...folders].sort((left, right) => left.localeCompare(right));
}

function ensureDirectoryNode(
  root: BrowserTreeNode,
  relativePath: string,
): BrowserTreeNode {
  let current = root;
  let currentPath = "";

  relativePath.split("/").forEach((part) => {
    if (!part) return;
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const existing = current.children.get(part);
    if (existing) {
      current = existing;
      return;
    }

    const node: BrowserTreeNode = {
      name: part,
      relativePath: currentPath,
      type: "directory",
      children: new Map(),
    };
    current.children.set(part, node);
    current = node;
  });

  return current;
}

function treeNodeToEntry(
  project: BrowserProjectRecord,
  node: BrowserTreeNode,
): ProjectEntry {
  const path = `${project.rootPath}/${node.relativePath}`;
  if (node.type === "file") {
    return {
      name: node.name,
      path,
      relativePath: node.relativePath,
      type: "file",
    };
  }

  return {
    name: node.name,
    path,
    relativePath: node.relativePath,
    type: "directory",
    children: sortedEntries(project, node),
  };
}

function sortedEntries(
  project: BrowserProjectRecord,
  node: BrowserTreeNode,
): ProjectEntry[] {
  return [...node.children.values()]
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map((child) => treeNodeToEntry(project, child));
}

function listProjectEntries(project: BrowserProjectRecord): ProjectEntry[] {
  const root: BrowserTreeNode = {
    name: project.name,
    relativePath: "",
    type: "directory",
    children: new Map(),
  };

  allFolderPaths(project)
    .filter((folder) => !folder.startsWith(".latexdo"))
    .forEach((folder) => ensureDirectoryNode(root, folder));

  Object.keys(project.files)
    .filter((filePath) => !filePath.startsWith(".latexdo/"))
    .forEach((filePath) => {
      const directory = parentPath(filePath);
      const parent = directory ? ensureDirectoryNode(root, directory) : root;
      parent.children.set(baseName(filePath), {
        name: baseName(filePath),
        relativePath: filePath,
        type: "file",
        children: new Map(),
      });
    });

  return sortedEntries(project, root);
}

function browserUnavailable(feature: string): Error {
  return new Error(
    `${feature} is available in the desktop app. The web editor keeps your source files in this browser.`,
  );
}

function emptyGitStatus(): GitStatusSummary {
  return {
    isRepo: false,
    branch: null,
    entries: [],
    error: "Git actions are available in the desktop app.",
  };
}

function createBrowserLatexDoApi(): BrowserLatexDoApi {
  const api: BrowserLatexDoApi = {
    runtime: "browser",

    async openProject() {
      const store = readStore();
      const project = currentOrNewProject(store);
      writeStore(store);
      return projectToOpenProject(project);
    },

    async createProject(options) {
      const store = readStore();
      const project = createProjectRecord(options?.folderName);
      store.projects = [project, ...store.projects];
      store.currentProjectId = project.id;
      writeStore(store);
      return projectToOpenProject(project);
    },

    async listProject(projectId) {
      const store = readStore();
      return listProjectEntries(findProject(store, projectId));
    },

    async readFile(projectId, relativePath) {
      const store = readStore();
      const project = findProject(store, projectId);
      const filePath = normalizeRelativePath(relativePath);
      const content = project.files[filePath];
      if (content === undefined) {
        throw new Error(`"${filePath}" does not exist in this browser workspace.`);
      }
      return content;
    },

    async writeFile(projectId, relativePath, content) {
      updateProject(projectId, (project) => {
        const filePath = normalizeRelativePath(relativePath);
        project.files[filePath] = content;
      });
    },

    async fileExists(projectId, relativePath) {
      const store = readStore();
      const project = findProject(store, projectId);
      const filePath = normalizeRelativePath(relativePath);
      return (
        project.files[filePath] !== undefined ||
        allFolderPaths(project).includes(filePath)
      );
    },

    async createFile(projectId, relativePath) {
      const filePath = normalizeRelativePath(relativePath);
      updateProject(projectId, (project) => {
        if (project.files[filePath] === undefined) {
          project.files[filePath] = starterContent(filePath);
        }
      });
      return filePath;
    },

    async createFolder(projectId, relativePath) {
      const folderPath = normalizeRelativePath(relativePath);
      updateProject(projectId, (project) => {
        const parent = parentPath(folderPath);
        if (parent && !allFolderPaths(project).includes(parent)) {
          throw new Error("Create the parent folder first.");
        }
        project.folders = [...new Set([...project.folders, folderPath])];
      });
      return folderPath;
    },

    async importDocx() {
      throw browserUnavailable("DOCX import");
    },

    async importMarkdown() {
      throw browserUnavailable("Markdown import");
    },

    async moveEntry(projectId, fromRelativePath, toRelativePath) {
      const fromPath = normalizeRelativePath(fromRelativePath);
      const toPath = normalizeRelativePath(toRelativePath);
      updateProject(projectId, (project) => {
        if (project.files[toPath] !== undefined || project.folders.includes(toPath)) {
          throw new Error(`"${toPath}" already exists.`);
        }

        if (project.files[fromPath] !== undefined) {
          project.files[toPath] = project.files[fromPath];
          delete project.files[fromPath];
          return;
        }

        if (!project.folders.includes(fromPath)) {
          throw new Error(`"${fromPath}" does not exist.`);
        }
        if (toPath.startsWith(`${fromPath}/`)) {
          throw new Error("Cannot move a folder into itself.");
        }

        project.folders = project.folders.map((folder) =>
          folder === fromPath || folder.startsWith(`${fromPath}/`)
            ? `${toPath}${folder.slice(fromPath.length)}`
            : folder,
        );
        Object.entries(project.files).forEach(([filePath, content]) => {
          if (filePath.startsWith(`${fromPath}/`)) {
            project.files[`${toPath}${filePath.slice(fromPath.length)}`] = content;
            delete project.files[filePath];
          }
        });
      });
      return toPath;
    },

    async getGitStatus() {
      return emptyGitStatus();
    },

    async stageGitFile() {
      throw browserUnavailable("Git staging");
    },

    async unstageGitFile() {
      throw browserUnavailable("Git unstaging");
    },

    async commitGit() {
      throw browserUnavailable("Git commits");
    },

    async getGitDiff(_projectId, relativePath): Promise<GitDiffPreview> {
      return {
        path: relativePath,
        diff: "Git diff is available in the desktop app.",
      };
    },

    async discardGitFile(): Promise<GitDiscardResult> {
      return {
        discarded: false,
      };
    },

    async stageAllGit() {
      throw browserUnavailable("Git staging");
    },

    async unstageAllGit() {
      throw browserUnavailable("Git unstaging");
    },

    async discardAllGit(): Promise<GitDiscardResult> {
      return {
        discarded: false,
      };
    },

    async getGitEditorDiff(_projectId, relativePath): Promise<GitDiffEditorInput> {
      return {
        path: relativePath,
        original: "",
        modified: "",
      };
    },

    async getGitHistory(): Promise<GitHistorySummary> {
      return {
        scope: "repo",
        target: null,
        commits: [],
      };
    },

    async getGitCommitDetails(hash) {
      return {
        hash,
        summary: "Git history is available in the desktop app.",
        body: "",
      };
    },

    async getGitCommitFileDiff(_projectId, relativePath): Promise<GitDiffEditorInput> {
      return {
        path: relativePath,
        original: "",
        modified: "",
      };
    },

    async checkForUpdates() {
      return {
        currentVersion: "0.1.0",
        latestVersion: null,
        releaseUrl: "https://latexdo.github.io/downloads/",
        updateAvailable: false,
        error: "Update checks are available in the desktop app.",
      };
    },

    async openReleasesPage() {
      window.open(
        "https://latexdo.github.io/downloads/",
        "_blank",
        "noopener,noreferrer",
      );
    },

    async getSpellCheckerSettings() {
      return readStore().spellCheckerSettings ?? defaultSpellCheckerSettings;
    },

    async updateSpellCheckerSettings(settings) {
      const store = readStore();
      store.spellCheckerSettings = settings;
      writeStore(store);
      return settings;
    },

    async getProofreadingSettings() {
      return readStore().proofreadingSettings ?? defaultProofreadingSettings;
    },

    async updateProofreadingSettings(settings) {
      const store = readStore();
      store.proofreadingSettings = settings;
      writeStore(store);
      return settings;
    },

    async proofreadDocument(_relativePath, content) {
      return {
        diagnostics: [],
        output:
          "Browser proofreading is disabled by default. Configure a LanguageTool-compatible server to use it.",
        checkedTextLength: content.length,
      };
    },

    async compile(request) {
      return {
        ok: false,
        durationMs: 0,
        output:
          "The web editor stores and edits LaTeX in your browser. Install the desktop app to run a local TeX engine and render PDFs.",
        diagnostics: [
          {
            file: request.rootFile,
            line: 1,
            column: 1,
            severity: "warning",
            message: "Local LaTeX compilation is available in the desktop app.",
            detail:
              "You can keep editing source in the web editor, then use the desktop app for latexmk, SyncTeX, terminal access, and PDF export.",
            source: "latex",
          },
        ],
        error: "Desktop app required for local PDF compilation.",
      };
    },

    async readPdf() {
      return new Uint8Array();
    },

    async forwardSyncTex() {
      return null;
    },

    async backwardSyncTex() {
      return null;
    },

    onOpenSpellCheckerSettings: () => () => {},
    onOpenProjectMenu: () => () => {},
    onCreateFileMenu: () => () => {},
    onCreateFolderMenu: () => () => {},
    onImportDocxMenu: () => () => {},
    onImportMarkdownMenu: () => () => {},
  };

  return api;
}

function createBrowserTerminalApi(): TerminalApi {
  const dataListeners = new Set<(payload: { id: number; data: string }) => void>();
  const exitListeners = new Set<(payload: { id: number; exitCode: number }) => void>();
  let nextTerminalId = 1;

  const emitData = (id: number, data: string) => {
    dataListeners.forEach((listener) => listener({ id, data }));
  };

  return {
    async create() {
      const id = nextTerminalId;
      nextTerminalId += 1;
      window.setTimeout(() => {
        emitData(
          id,
          "LatexDo web terminal placeholder\r\nInstall the desktop app for a real project shell.\r\n",
        );
      }, 50);
      return {
        id,
        mode: "pipe",
      };
    },
    write(id, data) {
      const command = data.trim();
      if (command) {
        emitData(
          id,
          `$ ${command}\r\nDesktop terminal access is unavailable in the web editor.\r\n`,
        );
      }
    },
    resize() {},
    dispose(id) {
      exitListeners.forEach((listener) => listener({ id, exitCode: 0 }));
    },
    onData(callback) {
      dataListeners.add(callback);
      return () => dataListeners.delete(callback);
    },
    onExit(callback) {
      exitListeners.add(callback);
      return () => exitListeners.delete(callback);
    },
  };
}

export function installBrowserApis(): void {
  if (!window.latexdo) {
    window.latexdo =
      import.meta.env.VITE_LATEXDO_RUNTIME === "cloud"
        ? createCloudLatexDoApi()
        : createBrowserLatexDoApi();
  }
  if (!window.terminalApi) {
    window.terminalApi = createBrowserTerminalApi();
  }
}
