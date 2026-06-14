import { contextBridge, ipcRenderer } from "electron";
import type {
  CompileRequest,
  CompileResult,
  ProjectEntry,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
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
};

contextBridge.exposeInMainWorld("latexdo", api);

const terminalApi = {
  create: (options?: { cwd?: string }) =>
    ipcRenderer.invoke("terminal:create", options),

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
