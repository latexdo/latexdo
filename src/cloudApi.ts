import type { LatexDoApi } from "../electron/preload.cjs";
import type {
  CollaborationState,
  GitDiffEditorInput,
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
  return import.meta.env.VITE_LATEXDO_API_BASE_URL || "";
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
  const existing = window.localStorage.getItem(cloudClientNameKey);
  if (existing) return existing;

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || "this device";
  const created = `LatexDo on ${platform}`.slice(0, 64);
  window.localStorage.setItem(cloudClientNameKey, created);
  return created;
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

function emptyGitStatus(): GitStatusSummary {
  return {
    isRepo: false,
    branch: null,
    entries: [],
    error: "Git actions are not enabled in the hosted editor yet.",
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

    listProject: (projectId) =>
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
        );
      }

      try {
        const state = await requestJson<CollaborationState>(
          `/api/projects/${projectId}/share`,
        );
        if (state.token) {
          rememberShareToken(projectId, state.token);
        }
        return state;
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
      return state;
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
      );
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
    ): Promise<GitDiffEditorInput> => ({
      path: relativePath,
      original: "",
      modified: "",
    }),
    getGitHistory: async (): Promise<GitHistorySummary> => ({
      scope: "repo",
      target: null,
      commits: [],
    }),
    getGitCommitDetails: async (hash) => ({
      hash,
      summary: "Git history is not enabled in the hosted editor yet.",
      body: "",
    }),
    getGitCommitFileDiff: async (
      _projectId,
      relativePath,
    ): Promise<GitDiffEditorInput> => ({
      path: relativePath,
      original: "",
      modified: "",
    }),

    checkForUpdates: async () => ({
      currentVersion: "0.1.0",
      latestVersion: null,
      releaseUrl: "https://latexdo.org/downloads/",
      updateAvailable: false,
    }),

    async openReleasesPage(releaseUrl) {
      window.open(
        releaseUrl || "https://latexdo.org/downloads/",
        "_blank",
        "noopener,noreferrer",
      );
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

    async proofreadDocument(_relativePath, content) {
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
