import { contextBridge, ipcRenderer, webUtils } from "electron";
import { randomUUID } from "node:crypto";
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
  UpdateInstallResult,
} from "./types.js" with { "resolution-mode": "import" };

const collaborationApiBaseUrl =
  process.env.VITE_LATEXDO_API_BASE_URL?.trim() || "https://collaborations.latexdo.org";
const hostedEditorUrl = "https://editor.latexdo.org/";
const cloudSessionKey = "latexdo.cloud.session";
const cloudClientKey = "latexdo.cloud.client";
const cloudClientNameKey = "latexdo.cloud.clientName";
const cloudShareTokensKey = "latexdo.cloud.shareTokens";
const cloudProjectIds = new Set<string>();

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

function readOrCreateStorage(key: string, create: () => string): string {
  const existing = storageGet(key);
  if (existing) return existing;
  const created = create();
  storageSet(key, created);
  return created;
}

function cloudSessionId(): string {
  return readOrCreateStorage(cloudSessionKey, () => `session-${randomUUID()}`);
}

function cloudClientId(): string {
  return readOrCreateStorage(cloudClientKey, () => `client-${randomUUID()}`);
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
  if (token) {
    rememberCloudShareToken(projectId, token);
  }
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
  url.searchParams.set("share", token);
  return url.toString();
}

function cloudHeaders(shareToken?: string): Record<string, string> {
  return {
    "x-latexdo-session": cloudSessionId(),
    "x-latexdo-client": cloudClientId(),
    "x-latexdo-client-name": cloudClientName(),
    ...(shareToken ? { "x-latexdo-share-token": shareToken } : {}),
  };
}

async function cloudRequestJson<T>(
  path: string,
  options: RequestInit = {},
  shareToken?: string,
): Promise<T> {
  const response = await fetch(cloudApiUrl(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...cloudHeaders(shareToken),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      // Keep the HTTP status fallback.
    }
    throw new Error(message);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function filePathQuery(relativePath: string): string {
  return `path=${encodeURIComponent(relativePath)}`;
}

function normalizeCloudState(
  projectId: string,
  state: CollaborationState,
): CollaborationState {
  if (!state.token) {
    return {
      ...state,
      projectId: state.projectId ?? projectId,
    };
  }
  return {
    ...state,
    projectId: state.projectId ?? projectId,
    shareUrl: state.shareUrl ?? cloudShareUrl(state.token),
  };
}

function parseShareTokenInput(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error("Paste a collaboration token.");
  }
  try {
    const url = new URL(value);
    return url.searchParams.get("share")?.trim() || value;
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
    `/api/shares/${encodeURIComponent(token)}/open`,
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

async function uploadLocalProjectToCloud(localProjectId: string): Promise<OpenProject> {
  const cloudProject = await createCloudProject();
  const entries = flattenProjectEntries(
    (await ipcRenderer.invoke("project:list", localProjectId, {
      maxDepth: 50,
      maxEntries: 100_000,
    })) as ProjectEntry[],
  );

  for (const entry of entries.filter((item) => item.type === "directory")) {
    await cloudRequestJson(
      `/api/projects/${encodeURIComponent(cloudProject.id)}/files`,
      {
        method: "POST",
        body: JSON.stringify({
          relativePath: entry.relativePath,
          type: "directory",
        }),
      },
    );
  }

  for (const entry of entries.filter((item) => item.type === "file")) {
    try {
      const content = (await ipcRenderer.invoke(
        "file:read",
        localProjectId,
        entry.relativePath,
      )) as string;
      await cloudRequestJson(
        `/api/projects/${encodeURIComponent(cloudProject.id)}/files/content?${filePathQuery(entry.relativePath)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
      );
    } catch (error) {
      console.warn(
        `Skipping non-text file while sharing: ${entry.relativePath}`,
        error,
      );
    }
  }

  return cloudProject;
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
      ? cloudRequestJson<{ content: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/files/content?${filePathQuery(relativePath)}`,
          {},
          cloudShareTokenForProject(projectId),
        ).then((body) => new TextEncoder().encode(body.content))
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
    ipcRenderer.invoke(
      "file:import-external",
      projectId,
      destinationDirectory,
      filePaths,
    ),
  importDocx: (projectId?: string): Promise<DocxImportResult | null> =>
    ipcRenderer.invoke("docx:import", projectId ?? ""),
  importMarkdown: (projectId?: string): Promise<MarkdownImportResult | null> =>
    ipcRenderer.invoke("markdown:import", projectId ?? ""),
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
        `/api/shares/${encodeURIComponent(token)}/presence`,
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
      `/api/shares/${encodeURIComponent(token)}/presence`,
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
      }>(`/api/shares/${encodeURIComponent(token)}/permissions`, {}, token);
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
      `/api/shares/${encodeURIComponent(token)}/permissions`,
      {
        method: "PUT",
        body: JSON.stringify(update),
      },
      token,
    );
  },
  removeCollaborator: async (projectId: string, clientIdToRemove: string): Promise<void> => {
    const token = cloudShareTokenForProject(projectId);
    if (!isCloudProject(projectId) || !token) {
      throw new Error("No share token for this project");
    }

    await cloudRequestJson<void>(
      `/api/shares/${encodeURIComponent(token)}/collaborators/${encodeURIComponent(clientIdToRemove)}`,
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
      }>(`/api/shares/${encodeURIComponent(token)}/permissions`, {}, token);
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
      ? Promise.resolve(cloudUnsupportedCompile(request))
      : ipcRenderer.invoke("latex:compile", request),
  cancelCompile: (projectId: string): Promise<boolean> =>
    isCloudProject(projectId)
      ? Promise.resolve(false)
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
      ? Promise.reject(
          new Error("PDF preview is not available for cloud collaboration projects."),
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
