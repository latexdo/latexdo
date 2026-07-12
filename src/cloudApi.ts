import type { LatexDoApi } from "../electron/preload.cjs";
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

type CloudLatexDoApi = LatexDoApi & {
  runtime: "cloud";
};

const cloudSessionKey = "latexdo.cloud.session";
const cloudClientKey = "latexdo.cloud.client";
const cloudClientNameKey = "latexdo.cloud.clientName";
const cloudShareTokensKey = "latexdo.cloud.shareTokens";
const cloudSpellCheckerSettingsKey = "latexdo.cloud.spellchecker";
const cloudProofreadingSettingsKey = "latexdo.cloud.proofreading";
const extensionStoreCatalogUrl = "https://store.latexdo.org/extensions/catalog.json";
const defaultCollaborationApiBaseUrl = "https://collaborations.latexdo.org";

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

function apiBaseUrl(): string {
  return import.meta.env.VITE_LATEXDO_API_BASE_URL || defaultCollaborationApiBaseUrl;
}

function sessionId(): string {
  const existing = window.localStorage.getItem(cloudSessionKey);
  if (existing) return existing;

  const created =
    crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random()}`;
  window.localStorage.setItem(cloudSessionKey, created);
  return created;
}

function clientId(): string {
  const existing = window.localStorage.getItem(cloudClientKey);
  if (existing) return existing;

  const created =
    crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random()}`;
  window.localStorage.setItem(cloudClientKey, created);
  return created;
}

function clientName(): string {
  return (window.localStorage.getItem(cloudClientNameKey) ?? "").trim().slice(0, 80);
}

function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path}`;
}

function collaborationHeaders(shareToken?: string): Record<string, string> {
  return {
    "x-latexdo-session": sessionId(),
    "x-latexdo-client": clientId(),
    "x-latexdo-client-name": clientName(),
    ...(shareToken ? { "x-latexdo-share-token": shareToken } : {}),
  };
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  shareToken?: string,
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...collaborationHeaders(shareToken),
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

function readLocalSetting<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function shareTokens(): Record<string, string> {
  return readLocalSetting<Record<string, string>>(cloudShareTokensKey, {});
}

function shareTokenForProject(projectId: string): string | undefined {
  return shareTokens()[projectId];
}

function rememberShareToken(projectId: string, token: string): void {
  window.localStorage.setItem(
    cloudShareTokensKey,
    JSON.stringify({ ...shareTokens(), [projectId]: token }),
  );
}

function initialShareToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("share");
  if (!token) return null;
  params.delete("share");
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
  return token;
}

function localShareState(projectId: string): CollaborationState {
  const token = shareTokenForProject(projectId);
  return token
    ? {
        enabled: true,
        token,
        shareUrl: `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(token)}`,
        projectId,
        users: [],
      }
    : {
        enabled: false,
        users: [],
      };
}

function shareUrlForToken(token: string): string {
  return `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(token)}`;
}

function normalizeCollaborationState(
  projectId: string,
  state: CollaborationState,
): CollaborationState {
  if (!state.token) {
    return state;
  }
  return {
    ...state,
    shareUrl: state.shareUrl ?? shareUrlForToken(state.token),
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

export function createCloudLatexDoApi(): CloudLatexDoApi {
  const joinCollaboration = async (token: string) => {
    const body = await requestJson<{
      project: OpenProject;
      collaboration: CollaborationState;
    }>(`/api/shares/${encodeURIComponent(token)}/open`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (body.collaboration.token) {
      rememberShareToken(body.project.id, body.collaboration.token);
    }
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

      return requestJson("/api/projects/open", {
        method: "POST",
        body: JSON.stringify({}),
      });
    },

    createProject: (options) =>
      requestJson("/api/projects", {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      }),

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

    importDocx: async () => {
      throw cloudUnavailable("DOCX import");
    },

    importMarkdown: async () => {
      throw cloudUnavailable("Markdown import");
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
            body: JSON.stringify({ clientId: clientId(), name: clientName() }),
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
            clientId: clientId(),
            name: clientName(),
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
      currentVersion: "0.1.0",
      latestVersion: null,
      releaseUrl: "https://latexdo.org/downloads/",
      updateAvailable: false,
    }),

    updateNow: async () => {
      window.open("https://latexdo.org/downloads/", "_blank", "noopener,noreferrer");
      return {
        currentVersion: "0.1.0",
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

    compile: (request) =>
      requestJson(
        "/api/compile",
        {
          method: "POST",
          body: JSON.stringify(request),
        },
        shareTokenForProject(request.projectId),
      ),

    async cancelCompile(_projectId) {
      return false;
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
      const response = await fetch(
        apiUrl(`/api/projects/${projectId}/pdf?${filePathQuery(pdfRelativePath)}`),
        {
          headers: {
            ...collaborationHeaders(shareTokenForProject(projectId)),
          },
        },
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async readAsset(projectId, relativePath) {
      const response = await fetch(
        apiUrl(`/api/projects/${projectId}/asset?${filePathQuery(relativePath)}`),
        {
          headers: {
            ...collaborationHeaders(shareTokenForProject(projectId)),
          },
        },
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
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
