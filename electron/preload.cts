import { contextBridge, ipcRenderer } from "electron";
import type {
  CompileRequest,
  CompileResult,
  GitCommitDetails,
  GitDiffEditorInput,
  GitDiffPreview,
  GitHistorySummary,
  GitStatusSummary,
  ProofreadingResult,
  ProofreadingSettings,
  ProjectEntry,
  SpellCheckerSettings,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
  UpdateCheckResult,
} from "./types.js" with { "resolution-mode": "import" };

const api = {
  getWelcomeProject: (): Promise<string> =>
    ipcRenderer.invoke("project:get-welcome"),
  openProject: (): Promise<string | null> => ipcRenderer.invoke("project:open"),
  createProject: (): Promise<string | null> =>
    ipcRenderer.invoke("project:create"),
  listProject: (projectPath: string): Promise<ProjectEntry[]> =>
    ipcRenderer.invoke("project:list", projectPath),
  readFile: (projectPath: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke("file:read", projectPath, filePath),
  writeFile: (
    projectPath: string,
    filePath: string,
    content: string,
  ): Promise<void> =>
    ipcRenderer.invoke("file:write", projectPath, filePath, content),
  createFile: (projectPath: string, relativePath: string): Promise<string> =>
    ipcRenderer.invoke("file:create", projectPath, relativePath),
  createFolder: (projectPath: string, relativePath: string): Promise<string> =>
    ipcRenderer.invoke("folder:create", projectPath, relativePath),
  moveEntry: (
    projectPath: string,
    fromRelativePath: string,
    toRelativePath: string,
  ): Promise<string> =>
    ipcRenderer.invoke(
      "entry:move",
      projectPath,
      fromRelativePath,
      toRelativePath,
    ),
  getGitStatus: (projectPath: string): Promise<GitStatusSummary> =>
    ipcRenderer.invoke("git:status", projectPath),
  stageGitFile: (projectPath: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("git:stage", projectPath, relativePath),
  unstageGitFile: (projectPath: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("git:unstage", projectPath, relativePath),
  commitGit: (projectPath: string, message: string): Promise<void> =>
    ipcRenderer.invoke("git:commit", projectPath, message),
  getGitDiff: (
    projectPath: string,
    relativePath: string,
  ): Promise<GitDiffPreview> =>
    ipcRenderer.invoke("git:diff", projectPath, relativePath),
  discardGitFile: (projectPath: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("git:discard", projectPath, relativePath),
  stageAllGit: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke("git:stage-all", projectPath),
  unstageAllGit: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke("git:unstage-all", projectPath),
  discardAllGit: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke("git:discard-all", projectPath),
  getGitEditorDiff: (
    projectPath: string,
    relativePath: string,
  ): Promise<GitDiffEditorInput> =>
    ipcRenderer.invoke("git:editor-diff", projectPath, relativePath),
  getGitHistory: (
    projectPath: string,
    relativePath?: string,
  ): Promise<GitHistorySummary> =>
    ipcRenderer.invoke("git:history", projectPath, relativePath),
  getGitCommitDetails: (
    projectPath: string,
    hash: string,
  ): Promise<GitCommitDetails> =>
    ipcRenderer.invoke("git:commit-details", projectPath, hash),
  getGitCommitFileDiff: (
    projectPath: string,
    relativePath: string,
    hash: string,
  ): Promise<GitDiffEditorInput> =>
    ipcRenderer.invoke("git:commit-file-diff", projectPath, relativePath, hash),
  checkForUpdates: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke("app:check-updates"),
  openReleasesPage: (): Promise<void> =>
    ipcRenderer.invoke("app:open-releases"),
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
  readPdf: (projectPath: string, pdfPath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke("pdf:read", projectPath, pdfPath),
  forwardSyncTex: (
    projectPath: string,
    pdfPath: string,
    inputPath: string,
    line: number,
    column: number,
  ): Promise<SyncTexPdfLocation | null> =>
    ipcRenderer.invoke(
      "synctex:forward",
      projectPath,
      pdfPath,
      inputPath,
      line,
      column,
    ),
  backwardSyncTex: (
    projectPath: string,
    pdfPath: string,
    page: number,
    x: number,
    y: number,
  ): Promise<SyncTexSourceLocation | null> =>
    ipcRenderer.invoke(
      "synctex:backward",
      projectPath,
      pdfPath,
      page,
      x,
      y,
    ),
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
};

contextBridge.exposeInMainWorld("latexdo", api);

const terminalApi = {
  create: (options?: { cwd?: string }) =>
    ipcRenderer.invoke("terminal:create", options) as Promise<{
      id: number;
      mode: "pty" | "pipe";
    }>,

  write: (id: number, data: string) =>
    ipcRenderer.send("terminal:write", { id, data }),

  resize: (id: number, cols: number, rows: number) =>
    ipcRenderer.send("terminal:resize", { id, cols, rows }),

  dispose: (id: number) =>
    ipcRenderer.send("terminal:dispose", { id }),

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
    const listener = (
      _event: unknown,
      payload: { id: number; exitCode: number },
    ) => {
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
