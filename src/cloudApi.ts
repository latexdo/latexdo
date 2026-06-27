import type { LatexDoApi } from "../electron/preload.cjs";
import type {
  GitDiffEditorInput,
  GitDiffPreview,
  GitDiscardResult,
  GitHistorySummary,
  GitStatusSummary,
  ProofreadingSettings,
  SpellCheckerSettings,
} from "./types";

type CloudLatexDoApi = LatexDoApi & {
  runtime: "cloud";
};

const cloudSessionKey = "latexdo.cloud.session";
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

function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path}`;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-latexdo-session": sessionId(),
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
  return {
    runtime: "cloud",

    openProject: () =>
      requestJson("/api/projects/open", {
        method: "POST",
        body: JSON.stringify({}),
      }),

    createProject: (options) =>
      requestJson("/api/projects", {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      }),

    listProject: (projectId) => requestJson(`/api/projects/${projectId}/files`),

    readFile: (projectId, relativePath) =>
      requestJson<{ content: string }>(
        `/api/projects/${projectId}/files/content?${filePathQuery(relativePath)}`,
      ).then((body: { content: string }) => body.content),

    writeFile: (projectId, relativePath, content) =>
      requestJson<void>(
        `/api/projects/${projectId}/files/content?${filePathQuery(relativePath)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
      ),

    fileExists: (projectId, relativePath) =>
      requestJson<{ exists: boolean }>(
        `/api/projects/${projectId}/files/exists?${filePathQuery(relativePath)}`,
      ).then((body) => body.exists),

    createFile: (projectId, relativePath) =>
      requestJson<{ relativePath: string }>(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: JSON.stringify({ relativePath, type: "file" }),
      }).then((body) => body.relativePath),

    createFolder: (projectId, relativePath) =>
      requestJson<{ relativePath: string }>(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: JSON.stringify({ relativePath, type: "directory" }),
      }).then((body) => body.relativePath),

    importDocx: async () => {
      throw cloudUnavailable("DOCX import");
    },

    importMarkdown: async () => {
      throw cloudUnavailable("Markdown import");
    },

    moveEntry: (projectId, fromRelativePath, toRelativePath) =>
      requestJson<{ relativePath: string }>(`/api/projects/${projectId}/files/move`, {
        method: "POST",
        body: JSON.stringify({ fromRelativePath, toRelativePath }),
      }).then((body) => body.relativePath),

    getGitStatus: async () => emptyGitStatus(),
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

    async openReleasesPage() {
      window.open(
        "https://latexdo.org/downloads/",
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
      requestJson("/api/compile", {
        method: "POST",
        body: JSON.stringify(request),
      }),

    async readPdf(projectId, pdfRelativePath) {
      const response = await fetch(
        apiUrl(`/api/projects/${projectId}/pdf?${filePathQuery(pdfRelativePath)}`),
        {
          headers: {
            "x-latexdo-session": sessionId(),
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
