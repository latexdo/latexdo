import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AsymptoteCompileRequest,
  CompileRequest,
  CompileResult,
  CollaborationState,
  CollaboratorPermission,
  CollaboratorRole,
  CreateProjectOptions,
  DocxImportResult,
  MarkdownImportResult,
  GitBlameLine,
  GitChangedEvent,
  GitCommitDetails,
  GitDiscardResult,
  GitDiffSession,
  GitDiffPreview,
  GitHistorySummary,
  GitRevisionRef,
  GitStatusSummary,
  ImportedProjectEntry,
  OpenProject,
  PermissionUpdate,
  ProofreadingResult,
  ProofreadingRequestOptions,
  ProofreadingSettings,
  ProjectEntry,
  ProjectListOptions,
  SpellCheckerSettings,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateInstallResult,
} from "./types.js" with { "resolution-mode": "import" };

const collaborationApiBaseUrl =
  process.env.VITE_LATEXDO_API_BASE_URL?.trim() || "https://editor.latexdo.org";
const hostedEditorUrl = "https://editor.latexdo.org/";
const cloudSessionKey = "latexdo.cloud.session";
const cloudClientKey = "latexdo.cloud.client";
const cloudClientNameKey = "latexdo.cloud.clientName";
const cloudShareTokensKey = "latexdo.cloud.shareTokens";
const cloudSessionTokenKey = "latexdo.cloud.sessionToken";
const cloudSessionExpiresAtKey = "latexdo.cloud.sessionExpiresAt";
const cloudSessionRefreshTokenKey = "latexdo.cloud.sessionRefreshToken";
const cloudActiveProjectKey = "latexdo.cloud.activeProject";
const cloudRequestTimeoutMs = 15_000;
const cloudUploadTimeoutMs = 60_000;
const cloudAssetTimeoutMs = 30_000;
const cloudImportTimeoutMs = 75_000;
const cloudCompileTimeoutMs = 75_000;
const maxCloudFileBytes = 2 * 1024 * 1024;
const maxCloudPdfBytes = 25 * 1024 * 1024;
const maxCloudProjectBytes = 20 * 1024 * 1024;
const maxCloudProjectFiles = 500;
const cloudSessionRefreshSkewMs = 5 * 60_000;
const cloudProjectIds = new Set<string>();

interface CloudSession {
  token: string;
  refreshToken: string;
  sessionId: string;
  clientId: string;
  expiresAt: number;
}

interface HostedImportResponse {
  project?: OpenProject;
  relativePath: string;
  sourcePath: string;
  converter: "pandoc";
  warnings: string[];
  mediaFiles?: string[];
}

class CloudApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

let memoryCloudSession: CloudSession | null = null;
let cloudSessionRequest: Promise<CloudSession> | null = null;
const cloudCompileControllers = new Map<string, AbortController>();

function storageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Local storage is best-effort in the isolated preload world.
  }
}

function storageRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Local storage is best-effort in the isolated preload world.
  }
}

function cloudClientName(): string {
  return (storageGet(cloudClientNameKey) ?? "").trim().slice(0, 80);
}

function cloudShareTokens(): Record<string, string> {
  try {
    const parsed = JSON.parse(storageGet(cloudShareTokensKey) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function cloudShareTokenForProject(projectId: string): string | undefined {
  return cloudShareTokens()[projectId];
}

function rememberCloudShareToken(projectId: string, token: string): void {
  storageSet(
    cloudShareTokensKey,
    JSON.stringify({ ...cloudShareTokens(), [projectId]: token }),
  );
}

function markCloudProject(projectId: string, token?: string): void {
  cloudProjectIds.add(projectId);
  storageSet(cloudActiveProjectKey, projectId);
  if (token) {
    rememberCloudShareToken(projectId, token);
  }
}

function cloudProjectFromSummary(project: { id: string; name: string }): OpenProject {
  return { id: project.id, name: project.name, rootPath: "" };
}

function isCloudProject(projectId: string): boolean {
  return (
    cloudProjectIds.has(projectId) ||
    projectId.startsWith("project_") ||
    projectId.startsWith("session_")
  );
}

function cloudApiUrl(path: string): string {
  return new URL(path, collaborationApiBaseUrl).toString();
}

function cloudShareUrl(token: string): string {
  const url = new URL(hostedEditorUrl);
  url.hash = new URLSearchParams({ share: token }).toString();
  return url.toString();
}

function cloudSessionFromStorage(): CloudSession | null {
  const token = storageGet(cloudSessionTokenKey)?.trim() ?? "";
  const refreshToken = storageGet(cloudSessionRefreshTokenKey)?.trim() ?? "";
  const sessionId = storageGet(cloudSessionKey)?.trim() ?? "";
  const clientId = storageGet(cloudClientKey)?.trim() ?? "";
  const expiresAt = Number(storageGet(cloudSessionExpiresAtKey));
  if (
    (!token && !refreshToken) ||
    !sessionId ||
    !clientId ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }
  return { token, refreshToken, sessionId, clientId, expiresAt };
}

function storeCloudSession(session: CloudSession): CloudSession {
  memoryCloudSession = session;
  storageSet(cloudSessionTokenKey, session.token);
  storageSet(cloudSessionRefreshTokenKey, session.refreshToken);
  storageSet(cloudSessionKey, session.sessionId);
  storageSet(cloudClientKey, session.clientId);
  storageSet(cloudSessionExpiresAtKey, String(session.expiresAt));
  return session;
}

function clearCloudSession(): void {
  memoryCloudSession = null;
  storageRemove(cloudSessionTokenKey);
  storageRemove(cloudSessionExpiresAtKey);
}

function parseCloudSession(value: unknown): CloudSession {
  const record = value as Partial<{
    token: string;
    refreshToken: string;
    sessionId: string;
    clientId: string;
    expiresAt: number | string;
  }>;
  const expiresAt =
    typeof record.expiresAt === "number"
      ? record.expiresAt
      : Date.parse(record.expiresAt ?? "");
  if (
    !record.token?.trim() ||
    !record.refreshToken?.trim() ||
    !record.sessionId?.trim() ||
    !record.clientId?.trim() ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error("Collaboration session response is invalid.");
  }
  return {
    token: record.token,
    refreshToken: record.refreshToken,
    sessionId: record.sessionId,
    clientId: record.clientId,
    expiresAt,
  };
}

async function cloudFetchJson<T>(
  path: string,
  options: RequestInit,
  timeoutMs = cloudRequestTimeoutMs,
): Promise<T> {
  const controller = new AbortController();
  const sourceSignal = options.signal;
  let timedOut = false;
  const abortFromSource = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) {
    throw new Error("Cloud request cancelled.");
  }
  sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(cloudApiUrl(path), {
      ...options,
      headers: { "content-type": "application/json", ...options.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: string };
        message = body.error || message;
      } catch {
        // Keep the HTTP status fallback.
      }
      throw new CloudApiError(response.status, message);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (error) {
    if (timedOut) throw new Error("Cloud request timed out.");
    if (sourceSignal?.aborted) throw new Error("Cloud request cancelled.");
    throw error;
  } finally {
    clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

async function issueCloudSession(): Promise<CloudSession> {
  return storeCloudSession(
    parseCloudSession(
      await cloudFetchJson("/api/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    ),
  );
}

async function refreshCloudSession(refreshToken: string): Promise<CloudSession> {
  return storeCloudSession(
    parseCloudSession(
      await cloudFetchJson("/api/sessions/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }),
    ),
  );
}

async function activeCloudSession(): Promise<CloudSession> {
  const stored = memoryCloudSession ?? cloudSessionFromStorage();
  if (stored?.token && stored.expiresAt - Date.now() > cloudSessionRefreshSkewMs) {
    memoryCloudSession = stored;
    return stored;
  }
  if (cloudSessionRequest) return cloudSessionRequest;
  cloudSessionRequest = (async () => {
    if (stored?.refreshToken) {
      return refreshCloudSession(stored.refreshToken);
    }
    return issueCloudSession();
  })();
  try {
    return await cloudSessionRequest;
  } finally {
    cloudSessionRequest = null;
  }
}

async function cloudHeaders(shareToken?: string): Promise<Record<string, string>> {
  const session = await activeCloudSession();
  return {
    authorization: `Bearer ${session.token}`,
    ...(cloudClientName() ? { "x-latexdo-client-name": cloudClientName() } : {}),
    ...(shareToken ? { "x-latexdo-share-token": shareToken } : {}),
  };
}

async function cloudRequestJson<T>(
  path: string,
  options: RequestInit = {},
  shareToken?: string,
  timeoutMs = cloudRequestTimeoutMs,
): Promise<T> {
  const request = async () =>
    cloudFetchJson<T>(
      path,
      {
        ...options,
        headers: {
          ...(await cloudHeaders(shareToken)),
          ...options.headers,
        },
      },
      timeoutMs,
    );
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof CloudApiError) || error.status !== 401) throw error;
    clearCloudSession();
    return request();
  }
}

async function cloudFetchBytes(
  path: string,
  headers: Record<string, string>,
  maxBytes = maxCloudFileBytes,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cloudAssetTimeoutMs);
  try {
    const response = await fetch(cloudApiUrl(path), {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: string };
        message = body.error || message;
      } catch {
        // Keep the HTTP status fallback.
      }
      throw new CloudApiError(response.status, message);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error("Cloud response exceeds its download limit.");
    }
    if (!response.body) {
      throw new Error("Cloud response body is missing.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error("Cloud response exceeds its download limit.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Cloud asset request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function cloudRequestBytes(
  path: string,
  shareToken?: string,
  maxBytes = maxCloudFileBytes,
): Promise<Uint8Array> {
  const request = async () =>
    cloudFetchBytes(path, await cloudHeaders(shareToken), maxBytes);
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof CloudApiError) || error.status !== 401) throw error;
    clearCloudSession();
    return request();
  }
}

function filePathQuery(relativePath: string): string {
  return `path=${encodeURIComponent(relativePath)}`;
}

function normalizeCloudState(
  projectId: string,
  state: CollaborationState,
): CollaborationState {
  const token = state.token ?? cloudShareTokenForProject(projectId);
  if (!token) {
    return {
      ...state,
      projectId: state.projectId ?? projectId,
    };
  }
  return {
    ...state,
    token,
    projectId: state.projectId ?? projectId,
    shareUrl: state.shareUrl ?? cloudShareUrl(token),
  };
}

function parseShareTokenInput(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error("Paste a collaboration token.");
  }
  try {
    const url = new URL(value);
    const fragmentToken = new URLSearchParams(url.hash.replace(/^#/, ""))
      .get("share")
      ?.trim();
    return fragmentToken || url.searchParams.get("share")?.trim() || value;
  } catch {
    return value;
  }
}

function flattenProjectEntries(entries: ProjectEntry[]): ProjectEntry[] {
  const flattened: ProjectEntry[] = [];
  for (const entry of entries) {
    if (entry.limited) continue;
    flattened.push(entry);
    if (entry.children?.length) {
      flattened.push(...flattenProjectEntries(entry.children));
    }
  }
  return flattened;
}

function projectTreeWasLimited(entries: ProjectEntry[]): boolean {
  return entries.some(
    (entry) => Boolean(entry.limited) || projectTreeWasLimited(entry.children ?? []),
  );
}

async function createCloudProject(folderName = "LatexDo Shared Project") {
  const project = await cloudRequestJson<OpenProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ folderName }),
  });
  markCloudProject(project.id);
  return project;
}

async function cloudCreateShare(projectId: string): Promise<CollaborationState> {
  const state = await cloudRequestJson<CollaborationState>(
    `/api/projects/${encodeURIComponent(projectId)}/share`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    cloudShareTokenForProject(projectId),
  );
  if (state.token) {
    markCloudProject(projectId, state.token);
  }
  return normalizeCloudState(projectId, state);
}

async function openCloudShare(tokenOrUrl: string): Promise<{
  project: OpenProject;
  collaboration: CollaborationState;
}> {
  const token = parseShareTokenInput(tokenOrUrl);
  const opened = await cloudRequestJson<{
    project: OpenProject;
    collaboration: CollaborationState;
  }>(
    "/api/shares/open",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    token,
  );
  markCloudProject(opened.project.id, token);
  return {
    project: opened.project,
    collaboration: normalizeCloudState(opened.project.id, opened.collaboration),
  };
}

async function restoreCloudProject(): Promise<OpenProject | null> {
  const activeProjectId = storageGet(cloudActiveProjectKey)?.trim() ?? "";
  if (!activeProjectId) return null;

  const directory = await cloudRequestJson<{
    projects?: Array<{ id?: unknown; name?: unknown; updatedAt?: unknown }>;
  }>("/api/projects");
  const activeProject = directory.projects?.find(
    (project) => project.id === activeProjectId && typeof project.name === "string",
  );
  if (activeProject && typeof activeProject.id === "string") {
    markCloudProject(activeProject.id);
    return cloudProjectFromSummary({
      id: activeProject.id,
      name: activeProject.name as string,
    });
  }

  const shareToken = cloudShareTokenForProject(activeProjectId);
  if (!shareToken) {
    storageRemove(cloudActiveProjectKey);
    return null;
  }
  try {
    return (await openCloudShare(shareToken)).project;
  } catch (error) {
    if (error instanceof CloudApiError && [403, 404].includes(error.status)) {
      storageRemove(cloudActiveProjectKey);
      return null;
    }
    throw error;
  }
}

async function uploadLocalProjectToCloud(localProjectId: string): Promise<OpenProject> {
  const cloudProject = await createCloudProject();
  const tree = (await ipcRenderer.invoke("project:list", localProjectId, {
    maxDepth: 50,
    maxEntries: 2_000,
  })) as ProjectEntry[];
  if (projectTreeWasLimited(tree)) {
    throw new Error("The local project tree exceeds the cloud upload scan limit.");
  }
  const fileEntries = flattenProjectEntries(tree).filter(
    (entry) => entry.type === "file",
  );
  if (fileEntries.length > maxCloudProjectFiles) {
    throw new Error(`Cloud projects are limited to ${maxCloudProjectFiles} files.`);
  }

  const files: { path: string; contentBase64: string }[] = [];
  let totalBytes = 0;
  for (const entry of fileEntries) {
    const content = (await ipcRenderer.invoke(
      "file:read-cloud-upload",
      localProjectId,
      entry.relativePath,
    )) as { contentBase64?: unknown; size?: unknown };
    if (
      typeof content.contentBase64 !== "string" ||
      typeof content.size !== "number" ||
      !Number.isSafeInteger(content.size) ||
      content.size < 0 ||
      content.size > maxCloudFileBytes
    ) {
      throw new Error(`${entry.relativePath} could not be prepared for upload.`);
    }
    totalBytes += content.size;
    if (totalBytes > maxCloudProjectBytes) {
      throw new Error("Cloud projects are limited to 20 MiB.");
    }
    files.push({ path: entry.relativePath, contentBase64: content.contentBase64 });
  }

  await cloudRequestJson(
    `/api/projects/${encodeURIComponent(cloudProject.id)}/files/batch`,
    {
      method: "PUT",
      body: JSON.stringify({ files, replace: true }),
    },
    undefined,
    cloudUploadTimeoutMs,
  );

  return cloudProject;
}

async function importCloudDocument(
  projectId: string,
  kind: "docx" | "markdown",
): Promise<DocxImportResult | MarkdownImportResult | null> {
  const selected = (await ipcRenderer.invoke("file:choose-hosted-import", kind)) as {
    fileName?: unknown;
    contentBase64?: unknown;
  } | null;
  if (!selected) return null;
  if (
    typeof selected.fileName !== "string" ||
    !selected.fileName ||
    typeof selected.contentBase64 !== "string"
  ) {
    throw new Error("The selected import could not be prepared.");
  }
  const imported = await cloudRequestJson<HostedImportResponse>(
    `/api/import/${kind}`,
    {
      method: "POST",
      headers: { "x-latexdo-project-id": projectId },
      body: JSON.stringify({
        projectId,
        fileName: selected.fileName,
        contentBase64: selected.contentBase64,
      }),
    },
    cloudShareTokenForProject(projectId),
    cloudImportTimeoutMs,
  );
  if (
    !imported ||
    typeof imported.relativePath !== "string" ||
    typeof imported.sourcePath !== "string" ||
    imported.converter !== "pandoc" ||
    !Array.isArray(imported.warnings)
  ) {
    throw new Error("The hosted importer returned an invalid response.");
  }
  const warnings = imported.warnings
    .filter((warning): warning is string => typeof warning === "string")
    .slice(0, 20);
  if (kind === "docx") {
    return {
      ...imported,
      warnings,
      mediaFiles: Array.isArray(imported.mediaFiles)
        ? imported.mediaFiles.filter(
            (relativePath): relativePath is string => typeof relativePath === "string",
          )
        : [],
      assetDirectory: "media",
    };
  }
  return { ...imported, warnings };
}

async function compileCloudProject(request: CompileRequest): Promise<CompileResult> {
  cloudCompileControllers.get(request.projectId)?.abort();
  const controller = new AbortController();
  cloudCompileControllers.set(request.projectId, controller);
  try {
    return await cloudRequestJson<CompileResult>(
      "/api/compile",
      {
        method: "POST",
        body: JSON.stringify(request),
        signal: controller.signal,
      },
      cloudShareTokenForProject(request.projectId),
      cloudCompileTimeoutMs,
    );
  } finally {
    if (cloudCompileControllers.get(request.projectId) === controller) {
      cloudCompileControllers.delete(request.projectId);
    }
  }
}

function cloudUnsupportedCompile(request: CompileRequest): CompileResult {
  return {
    ok: false,
    durationMs: 0,
    output:
      "This is a cloud collaboration project. Local desktop compilation is available for folders opened from disk.",
    diagnostics: [
      {
        file: request.rootFile,
        line: 1,
        column: 1,
        severity: "warning",
        message: "Cloud collaboration project is open.",
        detail:
          "Save a local copy or open a local folder to run the desktop TeX engine.",
        source: "latex",
      },
    ],
    error: "Local compilation is not available for cloud collaboration projects.",
  };
}

function emptyCloudGitStatus(): GitStatusSummary {
  return {
    isRepo: false,
    branch: null,
    entries: [],
    error: "Git actions are not available for cloud collaboration projects.",
  };
}

const api = {
  runtime: "desktop",
  openProject: (): Promise<OpenProject | null> => ipcRenderer.invoke("project:open"),
  restoreCloudProject,
  createProject: (options?: CreateProjectOptions): Promise<OpenProject | null> =>
    options === undefined
      ? ipcRenderer.invoke("project:create")
      : ipcRenderer.invoke("project:create", options),
  listProject: (
    projectId: string,
    options?: ProjectListOptions,
  ): Promise<ProjectEntry[]> =>
    isCloudProject(projectId)
      ? cloudRequestJson<ProjectEntry[]>(
          `/api/projects/${encodeURIComponent(projectId)}/files`,
          {},
          cloudShareTokenForProject(projectId),
        )
      : options === undefined
        ? ipcRenderer.invoke("project:list", projectId)
        : ipcRenderer.invoke("project:list", projectId, options),
  readFile: (projectId: string, relativePath: string): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ content: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/content?${filePathQuery(relativePath)}`,
          {},
          cloudShareTokenForProject(projectId),
        ).then((body) => body.content)
      : ipcRenderer.invoke("file:read", projectId, relativePath),
  readAsset: (projectId: string, relativePath: string): Promise<Uint8Array> =>
    isCloudProject(projectId)
      ? cloudRequestBytes(
          `/api/projects/${encodeURIComponent(projectId)}/asset?${filePathQuery(relativePath)}`,
          cloudShareTokenForProject(projectId),
        )
      : ipcRenderer.invoke("asset:read", projectId, relativePath),
  writeFile: (
    projectId: string,
    relativePath: string,
    content: string,
  ): Promise<void> =>
    isCloudProject(projectId)
      ? cloudRequestJson<void>(
          `/api/projects/${encodeURIComponent(projectId)}/files/content?${filePathQuery(relativePath)}`,
          {
            method: "PUT",
            body: JSON.stringify({ content }),
          },
          cloudShareTokenForProject(projectId),
        )
      : ipcRenderer.invoke("file:write", projectId, relativePath, content),
  fileExists: (projectId: string, relativePath: string): Promise<boolean> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ exists: boolean }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/exists?${filePathQuery(relativePath)}`,
          {},
          cloudShareTokenForProject(projectId),
        ).then((body) => body.exists)
      : ipcRenderer.invoke("file:exists", projectId, relativePath),
  createFile: (projectId: string, relativePath: string): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ relativePath: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files`,
          {
            method: "POST",
            body: JSON.stringify({ relativePath, type: "file" }),
          },
          cloudShareTokenForProject(projectId),
        ).then((body) => body.relativePath)
      : ipcRenderer.invoke("file:create", projectId, relativePath),
  createFolder: (projectId: string, relativePath: string): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ relativePath: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files`,
          {
            method: "POST",
            body: JSON.stringify({ relativePath, type: "directory" }),
          },
          cloudShareTokenForProject(projectId),
        ).then((body) => body.relativePath)
      : ipcRenderer.invoke("folder:create", projectId, relativePath),
  getDroppedFilePaths: (files: File[]): string[] =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  importExternalFiles: (
    projectId: string,
    destinationDirectory: string,
    filePaths: string[],
  ): Promise<ImportedProjectEntry[]> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error(
            "File and folder drop import is not available for cloud projects. Use DOCX or Markdown import.",
          ),
        )
      : ipcRenderer.invoke(
          "file:import-external",
          projectId,
          destinationDirectory,
          filePaths,
        ),
  chooseImportExternalFiles: (
    projectId: string,
    destinationDirectory: string,
  ): Promise<ImportedProjectEntry[]> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error(
            "Tree file import is not available for cloud projects. Use DOCX or Markdown import.",
          ),
        )
      : ipcRenderer.invoke(
          "file:choose-import-external",
          projectId,
          destinationDirectory,
        ),
  importDocx: (projectId?: string): Promise<DocxImportResult | null> =>
    projectId && isCloudProject(projectId)
      ? (importCloudDocument(projectId, "docx") as Promise<DocxImportResult | null>)
      : ipcRenderer.invoke("docx:import", projectId ?? ""),
  importMarkdown: (projectId?: string): Promise<MarkdownImportResult | null> =>
    projectId && isCloudProject(projectId)
      ? (importCloudDocument(
          projectId,
          "markdown",
        ) as Promise<MarkdownImportResult | null>)
      : ipcRenderer.invoke("markdown:import", projectId ?? ""),
  moveEntry: (
    projectId: string,
    fromRelativePath: string,
    toRelativePath: string,
  ): Promise<string> =>
    isCloudProject(projectId)
      ? cloudRequestJson<{ relativePath: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/move`,
          {
            method: "POST",
            body: JSON.stringify({ fromRelativePath, toRelativePath }),
          },
          cloudShareTokenForProject(projectId),
        ).then((body) => body.relativePath)
      : ipcRenderer.invoke("entry:move", projectId, fromRelativePath, toRelativePath),
  getGitStatus: (projectId: string): Promise<GitStatusSummary> =>
    isCloudProject(projectId)
      ? Promise.resolve(emptyCloudGitStatus())
      : ipcRenderer.invoke("git:status", projectId),
  getCollaborationState: async (projectId: string): Promise<CollaborationState> => {
    if (!isCloudProject(projectId)) {
      return {
        enabled: false,
        users: [],
      };
    }

    const token = cloudShareTokenForProject(projectId);
    if (token) {
      return cloudRequestJson<CollaborationState>(
        "/api/shares/presence",
        {
          method: "POST",
          body: JSON.stringify({ currentFile: null }),
        },
        token,
      ).then((state) => normalizeCloudState(projectId, state));
    }

    return cloudRequestJson<CollaborationState>(
      `/api/projects/${encodeURIComponent(projectId)}/share`,
    ).then((state) => normalizeCloudState(projectId, state));
  },
  createCollaborationLink: async (projectId: string): Promise<CollaborationState> => {
    if (isCloudProject(projectId)) {
      return cloudCreateShare(projectId);
    }
    const cloudProject = await uploadLocalProjectToCloud(projectId);
    return cloudCreateShare(cloudProject.id);
  },
  joinCollaboration: (
    token: string,
  ): Promise<{
    project: OpenProject;
    collaboration: CollaborationState;
  }> => openCloudShare(token),
  updateCollaborationPresence: async (
    projectId: string,
    currentFile?: string | null,
  ): Promise<CollaborationState> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      return {
        enabled: false,
        users: [],
      };
    }

    return cloudRequestJson<CollaborationState>(
      "/api/shares/presence",
      {
        method: "POST",
        body: JSON.stringify({ currentFile: currentFile ?? null }),
      },
      token,
    ).then((state) => normalizeCloudState(projectId, state));
  },
  getCollaborationPermissions: async (
    projectId: string,
  ): Promise<{
    permissions: CollaboratorPermission[];
    isAdmin: boolean;
    currentUserRole: CollaboratorRole;
  }> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      return { permissions: [], isAdmin: false, currentUserRole: "viewer" };
    }

    try {
      const result = await cloudRequestJson<{
        permissions: CollaboratorPermission[];
        isAdmin: boolean;
        currentUserRole: CollaboratorRole;
      }>("/api/shares/permissions", {}, token);
      return result;
    } catch {
      return { permissions: [], isAdmin: false, currentUserRole: "viewer" };
    }
  },
  updateCollaborationPermission: async (
    projectId: string,
    update: PermissionUpdate,
  ): Promise<CollaboratorPermission> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      throw new Error("No share token for this project");
    }

    return cloudRequestJson<CollaboratorPermission>(
      "/api/shares/permissions",
      {
        method: "PUT",
        body: JSON.stringify(update),
      },
      token,
    );
  },
  removeCollaborator: async (
    projectId: string,
    clientIdToRemove: string,
  ): Promise<void> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      throw new Error("No share token for this project");
    }

    await cloudRequestJson<void>(
      `/api/shares/collaborators/${encodeURIComponent(clientIdToRemove)}`,
      {
        method: "DELETE",
      },
      token,
    );
  },
  isProjectAdmin: async (projectId: string): Promise<boolean> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      return false;
    }
    try {
      const result = await cloudRequestJson<{
        isAdmin: boolean;
      }>("/api/shares/permissions", {}, token);
      return result.isAdmin;
    } catch {
      return false;
    }
  },
  stageGitFile: (projectId: string, relativePath: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:stage", projectId, relativePath),
  unstageGitFile: (projectId: string, relativePath: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:unstage", projectId, relativePath),
  commitGit: (projectId: string, message: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:commit", projectId, message),
  getGitDiff: (projectId: string, relativePath: string): Promise<GitDiffPreview> =>
    isCloudProject(projectId)
      ? Promise.resolve({
          path: relativePath,
          diff: "Git diff is not available for cloud collaboration projects.",
        })
      : ipcRenderer.invoke("git:diff", projectId, relativePath),
  discardGitFile: (
    projectId: string,
    relativePath: string,
  ): Promise<GitDiscardResult> =>
    isCloudProject(projectId)
      ? Promise.resolve({ discarded: false })
      : ipcRenderer.invoke("git:discard", projectId, relativePath),
  stageAllGit: (projectId: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:stage-all", projectId),
  unstageAllGit: (projectId: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:unstage-all", projectId),
  discardAllGit: (projectId: string): Promise<GitDiscardResult> =>
    isCloudProject(projectId)
      ? Promise.resolve({ discarded: false })
      : ipcRenderer.invoke("git:discard-all", projectId),
  getGitEditorDiff: (
    projectId: string,
    relativePath: string,
    area: "staged" | "changes" = "changes",
  ): Promise<GitDiffSession> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:editor-diff", projectId, relativePath, area),
  getGitHistory: (
    projectId: string,
    relativePath?: string,
  ): Promise<GitHistorySummary> =>
    isCloudProject(projectId)
      ? Promise.resolve({ scope: "repo", target: null, commits: [] })
      : ipcRenderer.invoke("git:history", projectId, relativePath),
  getGitCommitDetails: (projectId: string, hash: string): Promise<GitCommitDetails> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:commit-details", projectId, hash),
  getGitCommitFileDiff: (
    projectId: string,
    relativePath: string,
    hash: string,
    parentHash?: string,
  ): Promise<GitDiffSession> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Git actions are not available for cloud collaboration projects."),
        )
      : parentHash === undefined
        ? ipcRenderer.invoke("git:commit-file-diff", projectId, relativePath, hash)
        : ipcRenderer.invoke(
            "git:commit-file-diff",
            projectId,
            relativePath,
            hash,
            parentHash,
          ),
  getGitBlame: (
    projectId: string,
    relativePath: string,
    revision: GitRevisionRef,
  ): Promise<GitBlameLine[]> =>
    isCloudProject(projectId)
      ? Promise.resolve([])
      : ipcRenderer.invoke("git:blame", projectId, relativePath, revision),
  revealGitFile: (projectId: string, relativePath: string): Promise<void> =>
    isCloudProject(projectId)
      ? Promise.reject(
          new Error("Reveal file is not available for cloud collaboration projects."),
        )
      : ipcRenderer.invoke("git:reveal-file", projectId, relativePath),
  onGitChanged: (callback: (event: GitChangedEvent) => void) => {
    const listener = (_event: unknown, payload: GitChangedEvent) => callback(payload);
    ipcRenderer.on("git:changed", listener);
    return () => {
      ipcRenderer.removeListener("git:changed", listener);
    };
  },
  checkForUpdates: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke("app:check-updates"),
  updateNow: (): Promise<UpdateInstallResult> => ipcRenderer.invoke("app:update-now"),
  onUpdateProgress: (callback: (progress: UpdateDownloadProgress) => void) => {
    const listener = (_event: unknown, payload: UpdateDownloadProgress) =>
      callback(payload);
    ipcRenderer.on("app:update-progress", listener);
    return () => {
      ipcRenderer.removeListener("app:update-progress", listener);
    };
  },
  openReleasesPage: (releaseUrl?: string): Promise<void> =>
    ipcRenderer.invoke("app:open-releases", releaseUrl),
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke("app:open-external", url),
  fetchExtensionCatalog: (): Promise<unknown> =>
    ipcRenderer.invoke("extensions:get-catalog"),
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
    options?: ProofreadingRequestOptions,
  ): Promise<ProofreadingResult> =>
    options === undefined
      ? ipcRenderer.invoke("proofread:check", relativePath, content)
      : ipcRenderer.invoke("proofread:check", relativePath, content, options),
  compile: (request: CompileRequest): Promise<CompileResult> =>
    isCloudProject(request.projectId)
      ? compileCloudProject(request).catch((error) => ({
          ...cloudUnsupportedCompile(request),
          error:
            error instanceof Error
              ? error.message
              : "Could not compile the shared project locally.",
        }))
      : ipcRenderer.invoke("latex:compile", request),
  cancelCompile: (projectId: string): Promise<boolean> =>
    isCloudProject(projectId)
      ? Promise.resolve(
          (() => {
            const controller = cloudCompileControllers.get(projectId);
            if (!controller) return false;
            cloudCompileControllers.delete(projectId);
            controller.abort();
            return true;
          })(),
        )
      : ipcRenderer.invoke("latex:compile-cancel", projectId),
  compileAsymptote: (request: AsymptoteCompileRequest): Promise<CompileResult> =>
    isCloudProject(request.projectId)
      ? Promise.resolve({
          ok: false,
          durationMs: 0,
          output:
            "This is a cloud collaboration project. Local Asymptote compilation is available for folders opened from disk.",
          diagnostics: [
            {
              file: request.relativePath,
              line: 1,
              column: 1,
              severity: "warning",
              message: "Cloud collaboration project is open.",
              detail:
                "Save a local copy or open a local folder to run the desktop Asymptote compiler.",
              source: "latex",
            },
          ],
          error:
            "Local Asymptote compilation is not available for cloud collaboration projects.",
        })
      : ipcRenderer.invoke("asymptote:compile", request),
  readPdf: (projectId: string, pdfRelativePath: string): Promise<Uint8Array> =>
    isCloudProject(projectId)
      ? cloudRequestBytes(
          `/api/projects/${encodeURIComponent(projectId)}/pdf?${filePathQuery(pdfRelativePath)}`,
          cloudShareTokenForProject(projectId),
          maxCloudPdfBytes,
        )
      : ipcRenderer.invoke("pdf:read", projectId, pdfRelativePath),
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
  onImportMarkdownMenu: (callback: () => void) => {
    const listener = () => {
      callback();
    };

    ipcRenderer.on("file:import-markdown", listener);

    return () => {
      ipcRenderer.removeListener("file:import-markdown", listener);
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
