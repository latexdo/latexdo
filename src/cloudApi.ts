import type { LatexDoApi } from "../electron/preload.cjs";
import type { CompileResult } from "../electron/types";
import type {
  CollaborationState,
  CollaboratorPermission,
  CollaboratorRole,
  PermissionUpdate,
  GitDiffSession,
  GitDiffPreview,
  GitDiscardResult,
  GitHistorySummary,
  GitStatusSummary,
  OpenProject,
  ProofreadingSettings,
  SpellCheckerSettings,
} from "./types";
import { appVersion } from "./appVersion";
import {
  collaborationHeaders,
  resolveCollaborationApiBaseUrl,
} from "./collaboration/collaborationApi";
import {
  rememberShareToken,
  shareTokenForProject,
} from "./collaboration/collaborationStorage";

type CloudLatexDoApi = LatexDoApi & {
  runtime: "cloud";
};

const cloudSpellCheckerSettingsKey = "latexdo.cloud.spellchecker";
const cloudProofreadingSettingsKey = "latexdo.cloud.proofreading";
const cloudActiveProjectKey = "latexdo.cloud.activeProject";
const extensionStoreCatalogUrl = "https://store.latexdo.org/extensions/catalog.json";
const defaultRequestTimeoutMs = 15_000;
const binaryRequestTimeoutMs = 30_000;
const compileRequestTimeoutMs = 75_000;
const importRequestTimeoutMs = 75_000;
const hostedImportFileLimitBytes = 5 * 1024 * 1024;
const hostedAssetLimitBytes = 2 * 1024 * 1024;
const hostedPdfLimitBytes = 25 * 1024 * 1024;
const maxSafeRequestRetries = 2;
const maxRetryDelayMs = 2_000;

type RequestPolicy = {
  timeoutMs?: number;
  retries?: number;
};

type HostedImportResponse = {
  project?: OpenProject;
  relativePath: string;
  sourcePath: string;
  converter: "pandoc";
  warnings: string[];
  mediaFiles?: string[];
};

type OwnedProjectDirectory = {
  projects: Array<{ id: string; name: string; updatedAt: number }>;
};

class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    this.name = "RequestTimeoutError";
  }
}

const defaultProofreadingSettings: ProofreadingSettings = {
  enabled: false,
  serverUrl: "",
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

async function apiUrl(path: string): Promise<string> {
  const base = (await resolveCollaborationApiBaseUrl()).replace(/\/+$/, "");
  return `${base}${path}`;
}

function isSafeRequest(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maxRetryDelayMs, seconds * 1000);
    }

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(maxRetryDelayMs, Math.max(0, date - Date.now()));
    }
  }

  const ceiling = Math.min(maxRetryDelayMs, 200 * 2 ** attempt);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

function abortError(): DOMException {
  return new DOMException("Request cancelled.", "AbortError");
}

async function boundedResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} exceeds its download limit.`);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`${label} exceeds its download limit.`);
    }
    return bytes;
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
        throw new Error(`${label} exceeds its download limit.`);
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
}

async function waitForRetry(delayMs: number, signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw abortError();
  }
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const sourceSignal = options.signal;
  let timedOut = false;
  const onAbort = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) {
    throw abortError();
  }
  sourceSignal?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new RequestTimeoutError(timeoutMs);
    }
    if (sourceSignal?.aborted) {
      throw abortError();
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", onAbort);
  }
}

async function requestResponse(
  path: string,
  options: RequestInit = {},
  shareToken?: string,
  policy: RequestPolicy = {},
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const safeRequest = isSafeRequest(method);
  const retries = safeRequest
    ? Math.max(
        0,
        Math.min(maxSafeRequestRetries, policy.retries ?? maxSafeRequestRetries),
      )
    : 0;
  const timeoutMs = Math.max(1, policy.timeoutMs ?? defaultRequestTimeoutMs);
  const headers = new Headers(options.headers);
  if (
    options.body !== undefined &&
    options.body !== null &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  const authenticationHeaders = collaborationHeaders(shareToken);
  for (const [key, value] of Object.entries(authenticationHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        await apiUrl(path),
        { ...options, method, headers },
        timeoutMs,
      );
    } catch (error) {
      if (
        attempt >= retries ||
        error instanceof RequestTimeoutError ||
        options.signal?.aborted
      ) {
        throw error;
      }
      await waitForRetry(retryDelayMs(null, attempt), options.signal);
      continue;
    }

    if (attempt < retries && isRetryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      await waitForRetry(retryDelayMs(response, attempt), options.signal);
      continue;
    }
    return response;
  }
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  shareToken?: string,
  policy: RequestPolicy = {},
): Promise<T> {
  const response = await requestResponse(path, options, shareToken, policy);

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

function chooseHostedImportFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), {
      once: true,
    });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

async function hostedImportPayload(
  accept: string,
  projectId?: string,
): Promise<{ fileName: string; contentBase64: string; projectId?: string } | null> {
  const file = await chooseHostedImportFile(accept);
  if (!file) return null;
  if (file.size > hostedImportFileLimitBytes) {
    throw new Error("Hosted imports are limited to 5 MB per file.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > hostedImportFileLimitBytes) {
    throw new Error("The selected import file could not be read safely.");
  }
  return {
    ...(projectId ? { projectId } : {}),
    fileName: file.name,
    contentBase64: bytesToBase64(bytes),
  };
}

function normalizeHostedImport(value: HostedImportResponse): HostedImportResponse {
  if (
    !value ||
    typeof value.relativePath !== "string" ||
    typeof value.sourcePath !== "string" ||
    value.converter !== "pandoc" ||
    !Array.isArray(value.warnings)
  ) {
    throw new Error("The hosted importer returned an invalid response.");
  }
  return {
    ...value,
    warnings: value.warnings
      .filter((warning) => typeof warning === "string")
      .slice(0, 20),
    mediaFiles: Array.isArray(value.mediaFiles)
      ? value.mediaFiles.filter((path) => typeof path === "string")
      : [],
  };
}

function readLocalSetting<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function activeCloudProjectId(): string {
  return (window.localStorage.getItem(cloudActiveProjectKey) ?? "").trim();
}

function rememberActiveCloudProject(projectId: string): void {
  if (projectId) window.localStorage.setItem(cloudActiveProjectKey, projectId);
}

function openProjectFromSummary(project: { id: string; name: string }): OpenProject {
  return { id: project.id, name: project.name, rootPath: "" };
}

function initialShareToken(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = hashParams.get("share") ?? searchParams.get("share");
  if (!token) return null;
  searchParams.delete("share");
  hashParams.delete("share");
  const nextSearch = searchParams.toString();
  const nextHash = hashParams.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
  return token;
}

function localShareState(projectId: string): CollaborationState {
  const token = shareTokenForProject(projectId);
  return token
    ? {
        enabled: true,
        token,
        shareUrl: `${window.location.origin}${window.location.pathname}#share=${encodeURIComponent(token)}`,
        projectId,
        users: [],
      }
    : {
        enabled: false,
        users: [],
      };
}

function shareUrlForToken(token: string): string {
  return `${window.location.origin}${window.location.pathname}#share=${encodeURIComponent(token)}`;
}

function normalizeCollaborationState(
  projectId: string,
  state: CollaborationState,
): CollaborationState {
  const token = state.token ?? shareTokenForProject(projectId);
  if (!token) {
    return state;
  }
  return {
    ...state,
    token,
    shareUrl: state.shareUrl ?? shareUrlForToken(token),
    projectId: state.projectId ?? projectId,
  };
}

function emptyGitStatus(): GitStatusSummary {
  return {
    isRepo: false,
    branch: null,
    entries: [],
    error: "Git actions are not enabled in the hosted editor yet.",
  };
}

function unavailableGitDiffSession(
  relativePath: string,
  originalLabel = "Index",
  modifiedLabel = "Working Tree",
): GitDiffSession {
  return {
    id: `cloud-git-diff:${relativePath}:${originalLabel}:${modifiedLabel}`,
    relativePath,
    originalRef: { kind: "empty" },
    modifiedRef: { kind: "empty" },
    originalContent: "",
    modifiedContent: "",
    originalLabel,
    modifiedLabel,
    status: "modified",
    language: "plaintext",
    message: "Git diff is not enabled in the hosted editor yet.",
  };
}

function cloudUnavailable(feature: string): Error {
  return new Error(`${feature} is not enabled in the hosted editor yet.`);
}

function hostedCompileFailure(
  rootFile: string,
  message: string,
  detail: string,
): CompileResult {
  return {
    ok: false,
    durationMs: 0,
    output: `${message}\n\n${detail}`,
    diagnostics: [
      {
        file: rootFile,
        line: 1,
        column: 1,
        severity: "warning",
        message,
        detail,
        source: "latex",
      },
    ],
    error: message,
  };
}

function hostedCompileUnavailableResult(rootFile: string): CompileResult {
  return hostedCompileFailure(
    rootFile,
    "PDF compilation is not enabled on this hosted backend yet.",
    "Your project, review threads, and rebuttal data are saved in the cloud. " +
      "Use the desktop app to compile PDFs until hosted compilation is enabled.",
  );
}

export function createCloudLatexDoApi(): CloudLatexDoApi {
  const compileControllers = new Map<string, AbortController>();
  const joinCollaboration = async (token: string) => {
    const body = await requestJson<{
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
    rememberShareToken(body.project.id, token);
    rememberActiveCloudProject(body.project.id);
    body.collaboration = normalizeCollaborationState(
      body.project.id,
      body.collaboration,
    );
    return body;
  };

  return {
    runtime: "cloud",

    openProject: async () => {
      const token = initialShareToken();
      if (token) {
        return (await joinCollaboration(token)).project;
      }

      let directory: OwnedProjectDirectory = { projects: [] };
      try {
        directory = await requestJson<OwnedProjectDirectory>("/api/projects");
      } catch {
        // The collaboration backend has no owned-project directory; fall back
        // to the stored share token or a fresh session project below.
      }
      const projects = Array.isArray(directory.projects)
        ? directory.projects.filter(
            (project) =>
              project &&
              typeof project.id === "string" &&
              typeof project.name === "string",
          )
        : [];
      const activeProjectId = activeCloudProjectId();
      const ownedActiveProject = projects.find(
        (project) => project.id === activeProjectId,
      );
      if (ownedActiveProject) return openProjectFromSummary(ownedActiveProject);

      const activeShareToken = activeProjectId
        ? shareTokenForProject(activeProjectId)
        : undefined;
      if (activeShareToken) {
        return (await joinCollaboration(activeShareToken)).project;
      }

      const recentProject = projects[0];
      if (recentProject) {
        rememberActiveCloudProject(recentProject.id);
        return openProjectFromSummary(recentProject);
      }

      const project = await requestJson<OpenProject>("/api/projects/open", {
        method: "POST",
        body: JSON.stringify({}),
      });
      rememberActiveCloudProject(project.id);
      return project;
    },

    restoreCloudProject: async () => null,

    createProject: async (options) => {
      const project = await requestJson<OpenProject>("/api/projects", {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      });
      rememberActiveCloudProject(project.id);
      return project;
    },

    listProject: (projectId, _options) =>
      requestJson(
        `/api/projects/${projectId}/files`,
        {},
        shareTokenForProject(projectId),
      ),

    readFile: (projectId, relativePath) =>
      requestJson<{ content: string }>(
        `/api/projects/${projectId}/files/content?${filePathQuery(relativePath)}`,
        {},
        shareTokenForProject(projectId),
      ).then((body: { content: string }) => body.content),

    writeFile: (projectId, relativePath, content) =>
      requestJson<void>(
        `/api/projects/${projectId}/files/content?${filePathQuery(relativePath)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
        shareTokenForProject(projectId),
      ),

    fileExists: (projectId, relativePath) =>
      requestJson<{ exists: boolean }>(
        `/api/projects/${projectId}/files/exists?${filePathQuery(relativePath)}`,
        {},
        shareTokenForProject(projectId),
      ).then((body) => body.exists),

    createFile: (projectId, relativePath) =>
      requestJson<{ relativePath: string }>(
        `/api/projects/${projectId}/files`,
        {
          method: "POST",
          body: JSON.stringify({ relativePath, type: "file" }),
        },
        shareTokenForProject(projectId),
      ).then((body) => body.relativePath),

    createFolder: (projectId, relativePath) =>
      requestJson<{ relativePath: string }>(
        `/api/projects/${projectId}/files`,
        {
          method: "POST",
          body: JSON.stringify({ relativePath, type: "directory" }),
        },
        shareTokenForProject(projectId),
      ).then((body) => body.relativePath),

    getDroppedFilePaths: () => [],

    importExternalFiles: async () => {
      throw cloudUnavailable("File drop import");
    },

    chooseImportExternalFiles: async () => {
      throw cloudUnavailable("Tree file import");
    },

    importDocx: async (projectId) => {
      const payload = await hostedImportPayload(
        ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        projectId,
      );
      if (!payload) return null;
      const imported = normalizeHostedImport(
        await requestJson<HostedImportResponse>(
          "/api/import/docx",
          {
            method: "POST",
            headers: projectId ? { "x-latexdo-project-id": projectId } : undefined,
            body: JSON.stringify(payload),
          },
          projectId ? shareTokenForProject(projectId) : undefined,
          { timeoutMs: importRequestTimeoutMs, retries: 0 },
        ),
      );
      if (imported.project) rememberActiveCloudProject(imported.project.id);
      return {
        ...imported,
        mediaFiles: imported.mediaFiles ?? [],
        assetDirectory: "media",
      };
    },

    importMarkdown: async (projectId) => {
      const payload = await hostedImportPayload(
        ".md,.markdown,text/markdown,text/plain",
        projectId,
      );
      if (!payload) return null;
      const imported = normalizeHostedImport(
        await requestJson<HostedImportResponse>(
          "/api/import/markdown",
          {
            method: "POST",
            headers: projectId ? { "x-latexdo-project-id": projectId } : undefined,
            body: JSON.stringify(payload),
          },
          projectId ? shareTokenForProject(projectId) : undefined,
          { timeoutMs: importRequestTimeoutMs, retries: 0 },
        ),
      );
      if (imported.project) rememberActiveCloudProject(imported.project.id);
      return imported;
    },

    moveEntry: (projectId, fromRelativePath, toRelativePath) =>
      requestJson<{ relativePath: string }>(
        `/api/projects/${projectId}/files/move`,
        {
          method: "POST",
          body: JSON.stringify({ fromRelativePath, toRelativePath }),
        },
        shareTokenForProject(projectId),
      ).then((body) => body.relativePath),

    getGitStatus: async () => emptyGitStatus(),

    getCollaborationState: async (projectId) => {
      const token = shareTokenForProject(projectId);
      if (token) {
        return requestJson<CollaborationState>(
          `/api/shares/${encodeURIComponent(token)}/presence`,
          {
            method: "POST",
            body: JSON.stringify({ currentFile: null }),
          },
          token,
        ).then((state) => normalizeCollaborationState(projectId, state));
      }

      try {
        const state = await requestJson<CollaborationState>(
          `/api/projects/${projectId}/share`,
        );
        if (state.token) {
          rememberShareToken(projectId, state.token);
        }
        return normalizeCollaborationState(projectId, state);
      } catch {
        return localShareState(projectId);
      }
    },

    createCollaborationLink: async (projectId) => {
      const state = await requestJson<CollaborationState>(
        `/api/projects/${projectId}/share`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      if (state.token) {
        rememberShareToken(projectId, state.token);
      }
      return normalizeCollaborationState(projectId, state);
    },

    joinCollaboration,

    updateCollaborationPresence: async (projectId, currentFile) => {
      const token = shareTokenForProject(projectId);
      if (!token) return localShareState(projectId);

      return requestJson<CollaborationState>(
        `/api/shares/${encodeURIComponent(token)}/presence`,
        {
          method: "POST",
          body: JSON.stringify({
            currentFile: currentFile ?? null,
          }),
        },
        token,
      ).then((state) => normalizeCollaborationState(projectId, state));
    },

    getCollaborationPermissions: async (projectId) => {
      const token = shareTokenForProject(projectId);
      if (!token) {
        return { permissions: [], isAdmin: false, currentUserRole: "viewer" as const };
      }

      try {
        const result = await requestJson<{
          permissions: CollaboratorPermission[];
          isAdmin: boolean;
          currentUserRole: CollaboratorRole;
        }>(`/api/shares/${encodeURIComponent(token)}/permissions`, {}, token);
        return result;
      } catch {
        return { permissions: [], isAdmin: false, currentUserRole: "viewer" as const };
      }
    },

    updateCollaborationPermission: async (projectId, update: PermissionUpdate) => {
      const token = shareTokenForProject(projectId);
      if (!token) {
        throw new Error("No share token for this project");
      }

      return requestJson<CollaboratorPermission>(
        `/api/shares/${encodeURIComponent(token)}/permissions`,
        {
          method: "PUT",
          body: JSON.stringify(update),
        },
        token,
      );
    },

    removeCollaborator: async (projectId, clientIdToRemove: string) => {
      const token = shareTokenForProject(projectId);
      if (!token) {
        throw new Error("No share token for this project");
      }

      return requestJson<void>(
        `/api/shares/${encodeURIComponent(token)}/collaborators/${encodeURIComponent(clientIdToRemove)}`,
        {
          method: "DELETE",
        },
        token,
      );
    },

    isProjectAdmin: async (projectId) => {
      const token = shareTokenForProject(projectId);
      if (!token) return false;
      try {
        const result = await requestJson<{
          isAdmin: boolean;
        }>(`/api/shares/${encodeURIComponent(token)}/permissions`, {}, token);
        return result.isAdmin;
      } catch {
        return false;
      }
    },

    stageGitFile: async () => {
      throw cloudUnavailable("Git staging");
    },
    unstageGitFile: async () => {
      throw cloudUnavailable("Git unstaging");
    },
    commitGit: async () => {
      throw cloudUnavailable("Git commits");
    },
    getGitDiff: async (_projectId, relativePath): Promise<GitDiffPreview> => ({
      path: relativePath,
      diff: "Git diff is not enabled in the hosted editor yet.",
    }),
    discardGitFile: async (): Promise<GitDiscardResult> => ({
      discarded: false,
    }),
    stageAllGit: async () => {
      throw cloudUnavailable("Git staging");
    },
    unstageAllGit: async () => {
      throw cloudUnavailable("Git unstaging");
    },
    discardAllGit: async (): Promise<GitDiscardResult> => ({
      discarded: false,
    }),
    getGitEditorDiff: async (
      _projectId,
      relativePath,
      area,
    ): Promise<GitDiffSession> =>
      area === "staged"
        ? unavailableGitDiffSession(relativePath, "HEAD", "Index")
        : unavailableGitDiffSession(relativePath),
    getGitHistory: async (): Promise<GitHistorySummary> => ({
      scope: "repo",
      target: null,
      commits: [],
    }),
    getGitCommitDetails: async (hash) => ({
      hash,
      shortHash: hash.slice(0, 7),
      summary: "Git history is not enabled in the hosted editor yet.",
      body: "",
      authorName: "",
      authorEmail: "",
      authoredAt: "",
      committerName: "",
      committerEmail: "",
      committedAt: "",
      parents: [],
      refs: [],
      changedFiles: [],
    }),
    getGitCommitFileDiff: async (_projectId, relativePath): Promise<GitDiffSession> =>
      unavailableGitDiffSession(relativePath, "Parent", "Commit"),
    getGitBlame: async () => [],
    revealGitFile: async () => {
      throw cloudUnavailable("Reveal file");
    },
    onGitChanged: () => () => {},

    checkForUpdates: async () => ({
      currentVersion: appVersion,
      latestVersion: null,
      releaseUrl: "https://latexdo.org/downloads/",
      updateAvailable: false,
    }),

    updateNow: async () => {
      window.open("https://latexdo.org/downloads/", "_blank", "noopener,noreferrer");
      return {
        currentVersion: appVersion,
        latestVersion: null,
        releaseUrl: "https://latexdo.org/downloads/",
        updateAvailable: false,
        installerPath: null,
        opened: false,
        error: "Install updates from the desktop app.",
      };
    },

    onUpdateProgress: () => () => {},

    async openReleasesPage(releaseUrl) {
      window.open(
        releaseUrl || "https://latexdo.org/downloads/",
        "_blank",
        "noopener,noreferrer",
      );
    },

    async openExternalUrl(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    async fetchExtensionCatalog() {
      const response = await fetch(extensionStoreCatalogUrl, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Store catalog returned HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    },

    async getSpellCheckerSettings() {
      return readLocalSetting(
        cloudSpellCheckerSettingsKey,
        defaultSpellCheckerSettings,
      );
    },

    async updateSpellCheckerSettings(settings) {
      window.localStorage.setItem(
        cloudSpellCheckerSettingsKey,
        JSON.stringify(settings),
      );
      return settings;
    },

    async getProofreadingSettings() {
      return readLocalSetting(
        cloudProofreadingSettingsKey,
        defaultProofreadingSettings,
      );
    },

    async updateProofreadingSettings(settings) {
      window.localStorage.setItem(
        cloudProofreadingSettingsKey,
        JSON.stringify(settings),
      );
      return settings;
    },

    async proofreadDocument(_relativePath, content, _options) {
      return {
        diagnostics: [],
        output: "Proofreading is not enabled in the hosted editor yet.",
        checkedTextLength: content.length,
      };
    },

    compile: async (request) => {
      compileControllers.get(request.projectId)?.abort();
      const controller = new AbortController();
      compileControllers.set(request.projectId, controller);
      try {
        const response = await requestResponse(
          "/api/compile",
          {
            method: "POST",
            body: JSON.stringify(request),
            signal: controller.signal,
          },
          shareTokenForProject(request.projectId),
          { timeoutMs: compileRequestTimeoutMs, retries: 0 },
        );

        if (
          response.status === 404 ||
          response.status === 405 ||
          response.status === 501
        ) {
          await response.body?.cancel().catch(() => undefined);
          return hostedCompileUnavailableResult(request.rootFile);
        }
        if (!response.ok) {
          let message = `${response.status} ${response.statusText}`;
          try {
            const body = (await response.json()) as { error?: string };
            message = body.error || message;
          } catch {
            // Keep the HTTP status fallback.
          }
          return hostedCompileFailure(
            request.rootFile,
            `The hosted compile service reported an error: ${message}`,
            "Your source files are saved. Fix the reported problem or retry, " +
              "or compile with the desktop app.",
          );
        }
        return (await response.json()) as CompileResult;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return hostedCompileFailure(
          request.rootFile,
          `Could not reach the hosted compile service: ${message}`,
          "Your source files are saved. Check your connection and retry, " +
            "or compile with the desktop app.",
        );
      } finally {
        if (compileControllers.get(request.projectId) === controller) {
          compileControllers.delete(request.projectId);
        }
      }
    },

    async cancelCompile(projectId) {
      const controller = compileControllers.get(projectId);
      if (!controller) {
        return false;
      }
      compileControllers.delete(projectId);
      controller.abort();
      return true;
    },

    async compileAsymptote(request) {
      return {
        ok: false,
        durationMs: 0,
        output: "Asymptote compilation is available in the desktop app.",
        diagnostics: [
          {
            file: request.relativePath,
            line: 1,
            column: 1,
            severity: "warning",
            message: "Asymptote compilation is not enabled in the hosted editor.",
            detail:
              "Open this project in the desktop app to compile .asy files with the local Asymptote executable.",
            source: "latex",
          },
        ],
        error: "Desktop app required for Asymptote compilation.",
      };
    },

    async readPdf(projectId, pdfRelativePath) {
      const response = await requestResponse(
        `/api/projects/${projectId}/pdf?${filePathQuery(pdfRelativePath)}`,
        {},
        shareTokenForProject(projectId),
        { timeoutMs: binaryRequestTimeoutMs },
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return boundedResponseBytes(response, hostedPdfLimitBytes, "Hosted PDF");
    },

    async readAsset(projectId, relativePath) {
      const response = await requestResponse(
        `/api/projects/${projectId}/asset?${filePathQuery(relativePath)}`,
        {},
        shareTokenForProject(projectId),
        { timeoutMs: binaryRequestTimeoutMs },
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return boundedResponseBytes(response, hostedAssetLimitBytes, "Hosted asset");
    },

    forwardSyncTex: async () => null,
    backwardSyncTex: async () => null,
    onOpenSpellCheckerSettings: () => () => {},
    onOpenProjectMenu: () => () => {},
    onCreateFileMenu: () => () => {},
    onCreateFolderMenu: () => () => {},
    onImportDocxMenu: () => () => {},
    onImportMarkdownMenu: () => () => {},
  };
}
