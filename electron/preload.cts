import { contextBridge, ipcRenderer } from "electron";
import type {
  CompileRequest,
  CompileResult,
  DocxImportResult,
  GitCommitDetails,
  GitDiscardResult,
  GitDiffEditorInput,
  GitDiffPreview,
  GitHistorySummary,
  GitStatusSummary,
  OpenProject,
  ProofreadingResult,
  ProofreadingSettings,
  ProjectEntry,
  SpellCheckerSettings,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
  UpdateCheckResult,
} from "./types.js" with { "resolution-mode": "import" };

const api = {
  openProject: (): Promise<OpenProject | null> => ipcRenderer.invoke("project:open"),
  createProject: (): Promise<OpenProject | null> =>
    ipcRenderer.invoke("project:create"),
  listProject: (projectId: string): Promise<ProjectEntry[]> =>
    ipcRenderer.invoke("project:list", projectId),
  readFile: (projectId: string, relativePath: string): Promise<string> =>
    ipcRenderer.invoke("file:read", projectId, relativePath),
  writeFile: (
    projectId: string,
    relativePath: string,
    content: string,
  ): Promise<void> =>
    ipcRenderer.invoke("file:write", projectId, relativePath, content),
  fileExists: (projectId: string, relativePath: string): Promise<boolean> =>
    ipcRenderer.invoke("file:exists", projectId, relativePath),
  createFile: (projectId: string, relativePath: string): Promise<string> =>
    ipcRenderer.invoke("file:create", projectId, relativePath),
  createFolder: (projectId: string, relativePath: string): Promise<string> =>
    ipcRenderer.invoke("folder:create", projectId, relativePath),
  importDocx: (projectId?: string): Promise<DocxImportResult | null> =>
    ipcRenderer.invoke("docx:import", projectId ?? ""),
  moveEntry: (
    projectId: string,
    fromRelativePath: string,
    toRelativePath: string,
  ): Promise<string> =>
    ipcRenderer.invoke("entry:move", projectId, fromRelativePath, toRelativePath),
  getGitStatus: (projectId: string): Promise<GitStatusSummary> =>
    ipcRenderer.invoke("git:status", projectId),
  stageGitFile: (projectId: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("git:stage", projectId, relativePath),
  unstageGitFile: (projectId: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("git:unstage", projectId, relativePath),
  commitGit: (projectId: string, message: string): Promise<void> =>
    ipcRenderer.invoke("git:commit", projectId, message),
  getGitDiff: (projectId: string, relativePath: string): Promise<GitDiffPreview> =>
    ipcRenderer.invoke("git:diff", projectId, relativePath),
  discardGitFile: (
    projectId: string,
    relativePath: string,
  ): Promise<GitDiscardResult> =>
    ipcRenderer.invoke("git:discard", projectId, relativePath),
  stageAllGit: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("git:stage-all", projectId),
  unstageAllGit: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("git:unstage-all", projectId),
  discardAllGit: (projectId: string): Promise<GitDiscardResult> =>
    ipcRenderer.invoke("git:discard-all", projectId),
  getGitEditorDiff: (
    projectId: string,
    relativePath: string,
  ): Promise<GitDiffEditorInput> =>
    ipcRenderer.invoke("git:editor-diff", projectId, relativePath),
  getGitHistory: (
    projectId: string,
    relativePath?: string,
  ): Promise<GitHistorySummary> =>
    ipcRenderer.invoke("git:history", projectId, relativePath),
  getGitCommitDetails: (projectId: string, hash: string): Promise<GitCommitDetails> =>
    ipcRenderer.invoke("git:commit-details", projectId, hash),
  getGitCommitFileDiff: (
    projectId: string,
    relativePath: string,
    hash: string,
  ): Promise<GitDiffEditorInput> =>
    ipcRenderer.invoke("git:commit-file-diff", projectId, relativePath, hash),
  checkForUpdates: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke("app:check-updates"),
  openReleasesPage: (): Promise<void> => ipcRenderer.invoke("app:open-releases"),
  getSpellCheckerSettings: (): Promise<SpellCheckerSettings> =>
    ipcRenderer.invoke("spellchecker:get-settings"),
  updateSpellCheckerSettings: (
    settings: SpellCheckerSettings,
  ): Promise<SpellCheckerSettings> =>
    ipcRenderer.invoke("spellchecker:update-settings", settings),
  getProofreadingSettings: (): Promise<ProofreadingSettings> =>
    ipcRenderer.invoke("proofread:get-settings"),
  updateProofreadingSettings: (
    settings: ProofreadingSettings,
  ): Promise<ProofreadingSettings> =>
    ipcRenderer.invoke("proofread:update-settings", settings),
  proofreadDocument: (
    relativePath: string,
    content: string,
  ): Promise<ProofreadingResult> =>
    ipcRenderer.invoke("proofread:check", relativePath, content),
  compile: (request: CompileRequest): Promise<CompileResult> =>
    ipcRenderer.invoke("latex:compile", request),
  readPdf: (projectId: string, pdfRelativePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke("pdf:read", projectId, pdfRelativePath),
  forwardSyncTex: (
    projectId: string,
    pdfRelativePath: string,
    inputRelativePath: string,
    line: number,
    column: number,
  ): Promise<SyncTexPdfLocation | null> =>
    ipcRenderer.invoke(
      "synctex:forward",
      projectId,
      pdfRelativePath,
      inputRelativePath,
      line,
      column,
    ),
  backwardSyncTex: (
    projectId: string,
    pdfRelativePath: string,
    page: number,
    x: number,
    y: number,
  ): Promise<SyncTexSourceLocation | null> =>
    ipcRenderer.invoke("synctex:backward", projectId, pdfRelativePath, page, x, y),
  onOpenSpellCheckerSettings: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("tools:open-spellchecker", listener);

    return () => {
      ipcRenderer.removeListener("tools:open-spellchecker", listener);
    };
  },
  onOpenProjectMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:open-project", listener);

    return () => {
      ipcRenderer.removeListener("file:open-project", listener);
    };
  },
  onCreateFileMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:create-dialog", listener);

    return () => {
      ipcRenderer.removeListener("file:create-dialog", listener);
    };
  },
  onCreateFolderMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("folder:create-dialog", listener);

    return () => {
      ipcRenderer.removeListener("folder:create-dialog", listener);
    };
  },
  onImportDocxMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:import-docx", listener);

    return () => {
      ipcRenderer.removeListener("file:import-docx", listener);
    };
  },
};

contextBridge.exposeInMainWorld("latexdo", api);

const terminalApi = {
  create: (options: { projectId: string }) =>
    ipcRenderer.invoke("terminal:create", options) as Promise<{
      id: number;
      mode: "pty" | "pipe";
    }>,

  write: (id: number, data: string) => ipcRenderer.send("terminal:write", { id, data }),

  resize: (id: number, cols: number, rows: number) =>
    ipcRenderer.send("terminal:resize", { id, cols, rows }),

  dispose: (id: number) => ipcRenderer.send("terminal:dispose", { id }),

  onData: (callback: (payload: { id: number; data: string }) => void) => {
    const listener = (_event: unknown, payload: { id: number; data: string }) => {
      callback(payload);
    };

    ipcRenderer.on("terminal:data", listener);

    return () => {
      ipcRenderer.removeListener("terminal:data", listener);
    };
  },

  onExit: (callback: (payload: { id: number; exitCode: number }) => void) => {
    const listener = (_event: unknown, payload: { id: number; exitCode: number }) => {
      callback(payload);
    };

    ipcRenderer.on("terminal:exit", listener);

    return () => {
      ipcRenderer.removeListener("terminal:exit", listener);
    };
  },
};

contextBridge.exposeInMainWorld("terminalApi", terminalApi);

export type LatexDoApi = typeof api;
export type TerminalApi = typeof terminalApi;
