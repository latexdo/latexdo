import { contextBridge, ipcRenderer } from "electron";
import type {
  CompileRequest,
  CompileResult,
  ProjectEntry,
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
};

contextBridge.exposeInMainWorld("latexdo", api);

export type LatexDoApi = typeof api;
