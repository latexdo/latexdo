import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createEditorHarness } from "./__tests__/editorHarness";
import { fallbackExtensionCatalog, type LatexDoExtensionCatalog } from "./extensions";
import { aiConfigStorageKey, defaultAiConfig } from "./features/ai/aiConfig";
import {
  bookmarkKey,
  bookmarksStorageKey,
  defaultSettings,
  installedExtensionsStorageKey,
  legalPolicyVersion,
  legalPrivacyUrl,
  legalTermsUrl,
  settingsStorageKey,
} from "./features/settings/settings";
import type { AiSystemCapabilities } from "./features/ai/aiTypes";
import type {
  GitDiffSession,
  GitGraphCommit,
  GitStatusSummary,
  OpenProject,
  ProjectEntry,
  ProofreadingSettings,
  SpellCheckerSettings,
  UpdateAttemptResolution,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateInstallResult,
  WhatsNewResult,
} from "./types";

const editorChangeHandlers = vi.hoisted(
  () => new Map<string, (value: string) => void>(),
);
const editorLifecycle = vi.hoisted(() => ({
  beforeMount: null as null | ((instance: any) => void),
  onMount: null as null | ((editor: any) => void),
}));
vi.mock("./features/editor/nextEdit/monacoNextEditAdapter", () => ({
  installMonacoNextEdit: () => ({ dispose: vi.fn(), updateConfig: vi.fn() }),
}));

const editorOptionsByPath = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@monaco-editor/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      defaultValue,
      value,
      onChange,
      path,
      options,
    }: {
      defaultValue?: string;
      value?: string;
      onChange?: (value: string) => void;
      path?: string;
      options?: unknown;
    }) => {
      if (path) {
        editorChangeHandlers.set(path, (nextValue) => onChange?.(nextValue));
        editorOptionsByPath.set(path, options);
      }
      return React.createElement("textarea", {
        "aria-label": "mock editor",
        value: value ?? defaultValue ?? "",
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange?.(event.currentTarget.value),
      });
    },
    DiffEditor: () =>
      React.createElement("div", {
        "data-testid": "mock-diff-editor",
      }),
    loader: {
      config: vi.fn(),
    },
  };
});

vi.mock("./components/MonacoEditor", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    MonacoEditor: ({
      defaultValue,
      value,
      onChange,
      path,
      options,
      beforeMount,
      onMount,
    }: {
      defaultValue?: string;
      value?: string;
      onChange?: (value: string) => void;
      path?: string;
      options?: unknown;
      beforeMount?: (instance: any) => void;
      onMount?: (editor: any) => void;
    }) => {
      editorLifecycle.beforeMount = beforeMount ?? null;
      editorLifecycle.onMount = onMount ?? null;
      if (path) {
        editorChangeHandlers.set(path, (nextValue) => onChange?.(nextValue));
        editorOptionsByPath.set(path, options);
      }
      return React.createElement("textarea", {
        "aria-label": "mock editor",
        value: value ?? defaultValue ?? "",
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange?.(event.currentTarget.value),
      });
    },
    MonacoDiffEditor: () =>
      React.createElement("div", {
        "data-testid": "mock-diff-editor",
      }),
  };
});

vi.mock("./monaco", () => ({
  monaco: {
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
    editor: {
      ScrollType: {
        Smooth: 1,
      },
    },
  },
}));

vi.mock("./collaboration/MonacoCollaborationBinding", () => ({
  MonacoCollaborationBinding: class {
    readonly key: string;

    constructor(options: {
      projectId: string;
      relativePath: string;
      shareToken?: string;
    }) {
      this.key = `${options.projectId}:${options.relativePath}:${options.shareToken ?? ""}`;
    }

    destroy() {
      // Collaboration transport is outside the App UI tests.
    }
  },
}));

vi.mock("./collaboration/CollaborationContext", () => ({
  useCollaborationContext: () => ({
    apiBaseUrl: "https://collaborations.latexdo.org",
    clientName: "",
    color: "#2f6fdb",
  }),
}));

vi.mock("./PdfPreview", () => ({
  default: ({
    data,
    onNavigate,
  }: {
    data?: Uint8Array;
    onNavigate?: (location: {
      page: number;
      x: number;
      y: number;
      word?: string;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-pdf-preview"
      data-pdf-bytes={data?.byteLength ?? 0}
      onDoubleClick={() => onNavigate?.({ page: 2, x: 42, y: 84, word: "Text" })}
    >
      PDF preview
    </button>
  ),
}));

vi.mock("./TikzCanvas", () => ({
  default: () => <div data-testid="mock-tikz-canvas" />,
}));

vi.mock("./TableCanvas", () => ({
  default: () => <div data-testid="mock-table-canvas" />,
}));

const project: OpenProject = {
  id: "project-1",
  rootPath: "/Users/omar/project",
  name: "paper",
};

const researchSpaceProject: OpenProject = {
  id: "space:/Users/omar/research/research.latexdo-space",
  rootPath: "/Users/omar/research/research.latexdo-space",
  name: "Research Space",
  researchSpace: {
    schemaVersion: 1,
    name: "Research Space",
    filePath: "/Users/omar/research/research.latexdo-space",
    folders: [
      {
        name: "paper-a",
        path: "/Users/omar/research/paper-a",
        kind: "paper",
      },
      {
        name: "shared-bib",
        path: "/Users/omar/research/shared-bib",
        kind: "bibliography",
      },
    ],
  },
};

const entries: ProjectEntry[] = [
  {
    name: "main.tex",
    path: "/Users/omar/project/main.tex",
    relativePath: "main.tex",
    type: "file",
  },
];

const researchSpaceEntries: ProjectEntry[] = [
  {
    name: "paper-a",
    path: "/Users/omar/research/paper-a",
    relativePath: "paper-a",
    type: "directory",
    children: [
      {
        name: "main.tex",
        path: "/Users/omar/research/paper-a/main.tex",
        relativePath: "paper-a/main.tex",
        type: "file",
      },
    ],
  },
  {
    name: "shared-bib",
    path: "/Users/omar/research/shared-bib",
    relativePath: "shared-bib",
    type: "directory",
    children: [
      {
        name: "references.bib",
        path: "/Users/omar/research/shared-bib/references.bib",
        relativePath: "shared-bib/references.bib",
        type: "file",
      },
    ],
  },
];

const defaultSpellCheckerSettings: SpellCheckerSettings = {
  enabled: true,
  languages: ["en-US"],
  customWords: [],
  availableLanguages: ["en-US", "en-GB"],
  usesSystemLanguage: false,
};

const defaultProofreadingSettings: ProofreadingSettings = {
  enabled: true,
  serverUrl: "https://api.languagetool.org/v2/check",
  language: "auto",
  picky: false,
  motherTongue: "",
};

const defaultUpdateResult: UpdateCheckResult = {
  currentVersion: "0.1.0",
  latestVersion: "0.1.0",
  releaseUrl: null,
  updateAvailable: false,
};

const GB = 1024 ** 3;
const highRamCapabilities: AiSystemCapabilities = {
  totalRamBytes: 32 * GB,
  freeRamBytes: 16 * GB,
  totalStorageBytes: 256 * GB,
  freeStorageBytes: 128 * GB,
  modelStoragePath: "/Users/ada/Library/Application Support/LatexDo/models",
  platform: "darwin",
  arch: "arm64",
  cpuCount: 10,
  localAiAvailable: true,
};

const workingTreeDiffSession: GitDiffSession = {
  id: "main.tex:index:working-tree",
  relativePath: "main.tex",
  originalRef: { kind: "index" },
  modifiedRef: { kind: "working-tree" },
  originalContent: "old",
  modifiedContent: "new",
  originalLabel: "Index",
  modifiedLabel: "Working Tree",
  status: "modified",
  language: "latex",
};

const stagedDiffSession: GitDiffSession = {
  ...workingTreeDiffSession,
  id: "main.tex:head:index",
  originalRef: { kind: "commit", hash: "abcdef1234567890" },
  modifiedRef: { kind: "index" },
  originalLabel: "HEAD",
  modifiedLabel: "Index",
  originalShortHash: "abcdef1",
};

function installLatexDoMock(options?: {
  extensionCatalog?: LatexDoExtensionCatalog;
  gitStatus?: GitStatusSummary;
  proofreadingSettings?: ProofreadingSettings;
  updateResult?: UpdateCheckResult;
  updateNowResult?: UpdateInstallResult;
}) {
  const updateResult = options?.updateResult ?? defaultUpdateResult;
  const updateNowResult =
    options?.updateNowResult ??
    ({
      ...updateResult,
      installerPath: null,
      opened: false,
    } satisfies UpdateInstallResult);
  const api = {
    runtime: "desktop",
    openProject: vi.fn().mockResolvedValue(project),
    createProject: vi.fn().mockResolvedValue(project),
    createResearchSpace: vi.fn().mockResolvedValue(researchSpaceProject),
    listProject: vi.fn(async (projectId: string) =>
      projectId === researchSpaceProject.id ? researchSpaceEntries : entries,
    ),
    readFile: vi
      .fn()
      .mockResolvedValue(
        "\\documentclass{article}\n\\begin{document}\nText\n\\end{document}\n",
      ),
    writeFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(false),
    createFile: vi.fn().mockResolvedValue("chapter.tex"),
    createFolder: vi.fn().mockResolvedValue("chapters"),
    getDroppedFilePaths: vi.fn().mockReturnValue([]),
    importExternalFiles: vi.fn().mockResolvedValue([]),
    chooseImportExternalFiles: vi.fn().mockResolvedValue([]),
    importDocx: vi.fn().mockResolvedValue(null),
    importMarkdown: vi.fn().mockResolvedValue(null),
    importPdf: vi.fn().mockResolvedValue(null),
    moveEntry: vi.fn().mockResolvedValue("main.tex"),
    cancelCompile: vi.fn().mockResolvedValue(true),
    compileAsymptote: vi.fn().mockResolvedValue({
      ok: true,
      pdfPath: "drawing.pdf",
      durationMs: 10,
      output: "",
      diagnostics: [],
    }),
    getCollaborationState: vi.fn().mockResolvedValue({ enabled: false, users: [] }),
    createCollaborationLink: vi.fn().mockResolvedValue({
      enabled: true,
      users: [],
      token: "share-token",
      shareUrl: "https://latexdo.org/#share=share-token",
    }),
    rotateCollaborationLink: vi
      .fn()
      .mockResolvedValue({ enabled: true, users: [], token: "new-token" }),
    updateCollaborationPresence: vi
      .fn()
      .mockResolvedValue({ enabled: true, users: [], token: "share-token" }),
    joinCollaboration: vi.fn().mockResolvedValue({
      project,
      collaboration: { enabled: true, users: [], token: "joined-token" },
    }),
    getCollaborationPermissions: vi
      .fn()
      .mockResolvedValue({ permissions: [], isAdmin: true, currentUserRole: "admin" }),
    updateCollaborationPermission: vi.fn().mockResolvedValue(undefined),
    removeCollaborator: vi.fn().mockResolvedValue(undefined),
    getGitStatus: vi.fn().mockResolvedValue(
      options?.gitStatus ?? {
        isRepo: true,
        branch: "main",
        entries: [],
      },
    ),
    stageGitFile: vi.fn().mockResolvedValue(undefined),
    unstageGitFile: vi.fn().mockResolvedValue(undefined),
    commitGit: vi.fn().mockResolvedValue(undefined),
    getGitDiff: vi.fn().mockResolvedValue({ path: "main.tex", diff: "" }),
    discardGitFile: vi.fn().mockResolvedValue({ discarded: false }),
    stageAllGit: vi.fn().mockResolvedValue(undefined),
    unstageAllGit: vi.fn().mockResolvedValue(undefined),
    discardAllGit: vi.fn().mockResolvedValue({ discarded: false }),
    getGitEditorDiff: vi.fn(
      async (_projectId: string, _path: string, area = "changes") =>
        area === "staged" ? stagedDiffSession : workingTreeDiffSession,
    ),
    getGitHistory: vi.fn().mockResolvedValue({
      scope: "repo",
      target: null,
      commits: [],
    }),
    getGitCommitDetails: vi.fn().mockResolvedValue({
      hash: "abcdef1",
      shortHash: "abcdef1",
      summary: "Commit",
      body: "Commit body",
      authorName: "Omar",
      authorEmail: "omar@example.com",
      authoredAt: "2026-07-10T10:00:00Z",
      committerName: "Omar",
      committerEmail: "omar@example.com",
      committedAt: "2026-07-10T10:00:00Z",
      parents: [],
      refs: [],
      changedFiles: [],
    }),
    getGitCommitFileDiff: vi.fn().mockResolvedValue({
      ...workingTreeDiffSession,
      id: "main.tex:parent:commit",
      originalRef: { kind: "empty" },
      modifiedRef: { kind: "commit", hash: "abcdef1234567890" },
      originalLabel: "Empty",
      modifiedLabel: "abcdef1",
    }),
    getGitBlame: vi.fn().mockResolvedValue([]),
    revealGitFile: vi.fn().mockResolvedValue(undefined),
    onGitChanged: vi.fn(() => vi.fn()),
    checkForUpdates: vi.fn().mockResolvedValue(updateResult),
    updateNow: vi.fn().mockResolvedValue(updateNowResult),
    lastUpdateStatus: vi.fn().mockResolvedValue({
      status: "none",
      currentVersion: "0.3.0",
      expectedVersion: null,
    } satisfies UpdateAttemptResolution),
    getWhatsNew: vi.fn().mockResolvedValue({
      fromVersion: null,
      toVersion: "0.3.0",
      releases: [],
      shouldPresent: false,
      notesAvailable: false,
    } satisfies WhatsNewResult),
    markWhatsNewPresented: vi.fn().mockResolvedValue({ ok: true }),
    openReleaseNotesPage: vi.fn().mockResolvedValue({ opened: true }),
    onWhatsNewOpen: vi.fn((_callback: () => void) => vi.fn()),
    onUpdateProgress: vi.fn((_callback: (progress: UpdateDownloadProgress) => void) =>
      vi.fn(),
    ),
    onCompileProgress: vi.fn(
      (_callback: (payload: { projectId: string; progress: number }) => void) =>
        vi.fn(),
    ),
    openReleasesPage: vi.fn().mockResolvedValue(undefined),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    fetchScholarlyJson: vi.fn().mockResolvedValue({}),
    getSpellCheckerSettings: vi.fn().mockResolvedValue(defaultSpellCheckerSettings),
    fetchExtensionCatalog: vi
      .fn()
      .mockResolvedValue(options?.extensionCatalog ?? fallbackExtensionCatalog),
    updateSpellCheckerSettings: vi.fn(
      async (settings: SpellCheckerSettings) => settings,
    ),
    getProofreadingSettings: vi
      .fn()
      .mockResolvedValue(options?.proofreadingSettings ?? defaultProofreadingSettings),
    updateProofreadingSettings: vi.fn(
      async (settings: ProofreadingSettings) => settings,
    ),
    proofreadDocument: vi.fn().mockResolvedValue({
      diagnostics: [],
      output: "No issues found.",
      checkedTextLength: 12,
    }),
    compile: vi.fn().mockResolvedValue({
      ok: true,
      pdfPath: "main.pdf",
      durationMs: 12,
      output: "",
      diagnostics: [],
    }),
    readAsset: vi.fn().mockResolvedValue(new Uint8Array()),
    readPdf: vi.fn().mockResolvedValue(new Uint8Array()),
    forwardSyncTex: vi.fn().mockResolvedValue(null),
    backwardSyncTex: vi.fn().mockResolvedValue(null),
    onOpenSpellCheckerSettings: vi.fn(() => vi.fn()),
    onOpenProjectMenu: vi.fn(() => vi.fn()),
    onCreateFileMenu: vi.fn(() => vi.fn()),
    onCreateFolderMenu: vi.fn(() => vi.fn()),
    onImportDocxMenu: vi.fn((_callback: () => void) => vi.fn()),
    onImportMarkdownMenu: vi.fn(() => vi.fn()),
    onImportPdfMenu: vi.fn(() => vi.fn()),
    onCloseTabMenu: vi.fn(() => vi.fn()),
  };

  Object.defineProperty(window, "latexdo", {
    configurable: true,
    value: api,
  });

  return api;
}

async function openProjectFromWelcome() {
  fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
  await waitFor(() => {
    expect(window.latexdo.openProject).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(screen.getByText("Ready", { selector: ".status-message" })).toBeVisible();
  });
}

function createReviewPdfFile(name = "attention.pdf") {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const file = new File([bytes], name, {
    type: "application/pdf",
  });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () => bytes.buffer,
  });
  return file;
}

function choosePdfForReview(file = createReviewPdfFile()) {
  const input = document.querySelector(
    'input[aria-label="Choose a PDF to review"]',
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
}

async function installExtensionByName(name: string) {
  fireEvent.click(screen.getByTitle("Extensions"));
  const viewDetailsButton = await screen.findByRole("button", {
    name: new RegExp(`view ${escapeRegExp(name)} details`, "i"),
  });
  const card = viewDetailsButton.closest("article");
  expect(card).not.toBeNull();
  fireEvent.click(
    within(card as HTMLElement).getByRole("button", { name: /install/i }),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function closeSettingsDialog() {
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: /settings/i })).not.toBeInTheDocument();
  });
}

function acceptedSettings(overrides: Partial<typeof defaultSettings> = {}) {
  return {
    ...defaultSettings,
    legalAccepted: true,
    legalAcceptedAt: "2026-08-28T00:00:00.000Z",
    legalPolicyVersion,
    ...overrides,
  };
}

function storeAcceptedSettings(overrides: Partial<typeof defaultSettings> = {}) {
  window.localStorage.setItem(
    settingsStorageKey,
    JSON.stringify(acceptedSettings(overrides)),
  );
}

function storeCompleteAiConfig(overrides: Partial<typeof defaultAiConfig> = {}) {
  window.localStorage.setItem(
    aiConfigStorageKey,
    JSON.stringify({
      ...defaultAiConfig,
      setupComplete: true,
      ...overrides,
    }),
  );
}

describe("App critical UI controls", () => {
  beforeEach(() => {
    editorChangeHandlers.clear();
    editorOptionsByPath.clear();
    window.localStorage.clear();
    storeAcceptedSettings();
    Object.defineProperty(window, "aiApi", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn(() => true),
    });
  });

  it("requires Terms and Privacy acceptance before starting", async () => {
    const api = installLatexDoMock();
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(defaultSettings));
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({ ...defaultAiConfig, setupComplete: true }),
    );

    render(<App />);

    const dialog = screen.getByRole("dialog", { name: /terms and privacy/i });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /continue/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
    expect(api.openProject).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("link", { name: /terms of use/i }));
    expect(api.openExternalUrl).toHaveBeenCalledWith(legalTermsUrl);
    fireEvent.click(within(dialog).getByRole("link", { name: /privacy policy/i }));
    expect(api.openExternalUrl).toHaveBeenCalledWith(legalPrivacyUrl);

    fireEvent.click(within(dialog).getByLabelText("Accept Terms of Use"));
    expect(within(dialog).getByRole("button", { name: /continue/i })).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("Accept Privacy Policy"));
    fireEvent.click(within(dialog).getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /terms and privacy/i }),
      ).not.toBeInTheDocument();
    });
    const saved = JSON.parse(
      window.localStorage.getItem(settingsStorageKey) ?? "{}",
    ) as Record<string, unknown>;
    expect(saved.legalAccepted).toBe(true);
    expect(saved.legalAcceptedAt).toEqual(expect.any(String));
    expect(saved.legalPolicyVersion).toBe(legalPolicyVersion);

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
    await waitFor(() => {
      expect(api.openProject).toHaveBeenCalledTimes(1);
    });
  });

  it("creates a Research Space from the welcome screen", async () => {
    const api = installLatexDoMock();

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /new research space/i }));

    await waitFor(() => {
      expect(api.createResearchSpace).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getByText("Research Space", { selector: ".title-project" }),
      ).toBeVisible();
    });
    expect(api.listProject).toHaveBeenCalledWith(
      researchSpaceProject.id,
      expect.any(Object),
    );
    expect(api.readFile).toHaveBeenCalledWith(
      researchSpaceProject.id,
      "paper-a/main.tex",
    );
    expect(
      screen.getByText("Research Space ready", { selector: ".status-message" }),
    ).toBeVisible();
  });

  it("formats the open TeX document when the Prettier titlebar action is clicked", async () => {
    const api = installLatexDoMock();
    api.readFile.mockResolvedValue(
      [
        "\\subsection{Units}",
        "\\begin{itemize}",
        "\\item Use SI units.",
        "\\item Avoid mixing units.",
        "\\end{itemize}",
      ].join("\n"),
    );

    render(<App />);

    expect(
      screen.getByRole("button", { name: /prettier: format latex layout/i }),
    ).toBeDisabled();

    await openProjectFromWelcome();
    const editor = await screen.findByLabelText("mock editor");

    const prettierButton = screen.getByRole("button", {
      name: /prettier: format latex layout/i,
    });
    expect(prettierButton).toBeEnabled();
    fireEvent.click(prettierButton);

    expect(editor).toHaveValue(
      [
        "\\subsection{Units}",
        "",
        "\\begin{itemize}",
        "    \\item Use SI units.",
        "    \\item Avoid mixing units.",
        "\\end{itemize}",
      ].join("\n"),
    );
    expect(
      screen.getByText("Prettier formatted LaTeX document layout.", {
        selector: ".status-message",
      }),
    ).toBeVisible();
  });

  it("edits an open TeX document through the visual editor view", async () => {
    const api = installLatexDoMock();
    api.readFile.mockResolvedValue("\\section{Intro}\nOriginal paragraph.\n");

    render(<App />);

    await openProjectFromWelcome();
    expect(await screen.findByLabelText("mock editor")).toHaveValue(
      "\\section{Intro}\nOriginal paragraph.\n",
    );

    fireEvent.click(screen.getByRole("button", { name: /^Visual$/i }));

    const paragraph = await screen.findByLabelText("Paragraph");
    paragraph.textContent = "Updated paragraph.";
    fireEvent.input(paragraph);

    fireEvent.click(screen.getByRole("button", { name: /^Code$/i }));

    expect(await screen.findByLabelText("mock editor")).toHaveValue(
      "\\section{Intro}\nUpdated paragraph.\n",
    );
  });

  it("shows LatexDo setup before the standalone legal gate on first launch", async () => {
    const api = installLatexDoMock();
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(defaultSettings));
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({ ...defaultAiConfig, setupComplete: false }),
    );

    render(<App />);

    expect(
      screen.getByRole("dialog", { name: /set up your latexdo workspace/i }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog", { name: /terms and privacy/i })).toBeNull();
    expect(screen.getByRole("button", { name: /set up workspace/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));
    expect(api.openProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: /terms of use/i }));
    expect(api.openExternalUrl).toHaveBeenCalledWith(legalTermsUrl);
    fireEvent.click(screen.getByRole("link", { name: /privacy policy/i }));
    expect(api.openExternalUrl).toHaveBeenCalledWith(legalPrivacyUrl);

    fireEvent.click(screen.getByLabelText("Accept Terms of Use and Privacy Policy"));
    fireEvent.click(screen.getByRole("button", { name: /set up workspace/i }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "First name" })).toBeVisible();
    });
    const saved = JSON.parse(
      window.localStorage.getItem(settingsStorageKey) ?? "{}",
    ) as Record<string, unknown>;
    expect(saved.legalAccepted).toBe(true);
    expect(saved.legalAcceptedAt).toEqual(expect.any(String));
    expect(saved.legalPolicyVersion).toBe(legalPolicyVersion);
  });

  it("requires re-acceptance when the stored legal policy version is old", () => {
    installLatexDoMock();
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify(
        acceptedSettings({
          legalPolicyVersion: "old-policy-version",
        }),
      ),
    );
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({ ...defaultAiConfig, setupComplete: true }),
    );

    render(<App />);

    expect(screen.getByRole("dialog", { name: /terms and privacy/i })).toBeVisible();
  });

  it("shows disabled proofreading state and persists the proofreading toggle", async () => {
    const api = installLatexDoMock({
      proofreadingSettings: {
        ...defaultProofreadingSettings,
        enabled: false,
      },
    });

    render(<App />);

    fireEvent.click(screen.getByLabelText(/open settings/i));
    fireEvent.click(screen.getByRole("button", { name: "Language" }));

    expect(await screen.findByText(/Proofreading is disabled/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /proofread now/i })).toBeDisabled();

    const grammarToggle = screen.getByLabelText(/Grammar and style checking/i);
    expect(grammarToggle).not.toBeChecked();

    fireEvent.click(grammarToggle);

    await waitFor(() => {
      expect(api.updateProofreadingSettings).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  it("limits proofreading requests to the current 20k character chunk", async () => {
    const api = installLatexDoMock();
    api.readFile.mockResolvedValue("A".repeat(25_000));

    render(<App />);
    await openProjectFromWelcome();

    fireEvent.click(screen.getByLabelText(/open settings/i));
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(await screen.findByRole("button", { name: /proofread now/i }));

    await waitFor(() => {
      expect(api.proofreadDocument).toHaveBeenCalled();
    });
    const [, sentContent, options] = api.proofreadDocument.mock.calls.at(-1)!;
    expect(sentContent).toHaveLength(20_000);
    expect(options).toEqual(
      expect.objectContaining({
        baseLine: 1,
        baseColumn: 1,
        originalTextLength: 25_000,
        truncated: true,
      }),
    );
  });

  it("opens DOCX import from the welcome screen without an open project", async () => {
    const api = installLatexDoMock();

    render(<App />);

    const welcomeImport = screen.getByText("Import DOCX").closest("button");
    expect(welcomeImport).not.toBeNull();
    fireEvent.click(welcomeImport as HTMLButtonElement);

    await waitFor(() => {
      expect(api.importDocx).toHaveBeenCalledWith(undefined);
    });
  });

  it("opens PDF import from the welcome screen without an open project", async () => {
    const api = installLatexDoMock();

    render(<App />);

    const welcomeImport = screen.getByText("Convert PDF to LaTeX").closest("button");
    expect(welcomeImport).not.toBeNull();
    fireEvent.click(welcomeImport as HTMLButtonElement);

    await waitFor(() => {
      expect(api.importPdf).toHaveBeenCalledWith(undefined);
    });
  });

  it("keeps the welcome page visible when DOCX import is launched from a blank workspace", async () => {
    const api = installLatexDoMock();
    api.importDocx.mockResolvedValue(null);

    render(<App />);

    const closeWelcome = document.querySelector(
      ".welcome-tab .tab-close",
    ) as HTMLElement | null;
    expect(closeWelcome).not.toBeNull();
    fireEvent.click(closeWelcome as HTMLElement);

    expect(screen.getByText("No project is open")).toBeVisible();

    await waitFor(() => {
      expect(api.onImportDocxMenu).toHaveBeenCalled();
    });
    const importDocxCallback = api.onImportDocxMenu.mock.calls.at(-1)?.[0];
    expect(importDocxCallback).toEqual(expect.any(Function));

    await act(async () => {
      importDocxCallback?.();
    });

    await waitFor(() => {
      expect(api.importDocx).toHaveBeenCalledWith(undefined);
    });
    expect(screen.getByText("Start")).toBeVisible();
    expect(screen.getByText("Import DOCX")).toBeVisible();
    expect(screen.queryByText("No project is open")).not.toBeInTheDocument();
  });

  it("centers the empty page state after closing the welcome tab", () => {
    installLatexDoMock();

    render(<App />);

    const closeWelcome = document.querySelector(
      ".welcome-tab .tab-close",
    ) as HTMLElement | null;
    expect(closeWelcome).not.toBeNull();
    fireEvent.click(closeWelcome as HTMLElement);

    expect(screen.getByText("No project is open")).toBeVisible();
    expect(document.querySelector(".source-pane")).toHaveClass("empty-only");
    expect(document.querySelector(".source-toolbar")).not.toBeInTheDocument();
  });

  it("restores the active editor without losing unsaved text after showing welcome", async () => {
    installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();

    const editor = await screen.findByLabelText("mock editor");
    fireEvent.change(editor, {
      target: {
        value:
          "\\documentclass{article}\n\\begin{document}\nUnsaved draft\n\\end{document}\n",
      },
    });

    const welcomeTab = document.querySelector(".welcome-tab") as HTMLElement | null;
    expect(welcomeTab).not.toBeNull();
    fireEvent.click(welcomeTab as HTMLElement);
    expect(screen.getByText("Start")).toBeVisible();

    const closeWelcome = document.querySelector(
      ".welcome-tab .tab-close",
    ) as HTMLElement | null;
    expect(closeWelcome).not.toBeNull();
    fireEvent.click(closeWelcome as HTMLElement);

    expect(
      ((await screen.findByLabelText("mock editor")) as HTMLTextAreaElement).value,
    ).toContain("Unsaved draft");
  });

  it("keeps late editor changes scoped to the tab that emitted them", async () => {
    const api = installLatexDoMock();
    const chapterEntry: ProjectEntry = {
      name: "chapter.tex",
      path: "/Users/omar/project/chapter.tex",
      relativePath: "chapter.tex",
      type: "file",
    };
    api.listProject.mockResolvedValue([entries[0], chapterEntry]);
    api.readFile.mockImplementation(async (_projectId: string, relativePath: string) =>
      relativePath === "chapter.tex" ? "Chapter original\n" : "Main original\n",
    );

    render(<App />);
    await openProjectFromWelcome();

    expect(await screen.findByLabelText("mock editor")).toHaveValue("Main original\n");

    const chapterRow = document.querySelector(
      '.tree-row[title="chapter.tex"]',
    ) as HTMLButtonElement | null;
    expect(chapterRow).not.toBeNull();
    fireEvent.click(chapterRow as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByLabelText("mock editor")).toHaveValue("Chapter original\n");
    });

    act(() => {
      editorChangeHandlers.get(entries[0].path)?.("Late main edit\n");
    });

    expect(screen.getByLabelText("mock editor")).toHaveValue("Chapter original\n");

    const mainTab = within(document.querySelector(".document-tabs") as HTMLElement)
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("main.tex"));
    expect(mainTab).toBeDefined();
    fireEvent.click(mainTab as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByLabelText("mock editor")).toHaveValue("Late main edit\n");
    });
  });

  it("remaps saved bookmarks when document lines change", async () => {
    const api = installLatexDoMock();
    const key = bookmarkKey(project.rootPath, entries[0].relativePath);
    window.localStorage.setItem(bookmarksStorageKey, JSON.stringify({ [key]: [3] }));
    api.readFile.mockResolvedValue("alpha\nbeta\ngamma\n");

    render(<App />);
    await openProjectFromWelcome();

    await screen.findByLabelText("mock editor");
    act(() => {
      editorChangeHandlers.get(entries[0].path)?.("intro\nalpha\nbeta\ngamma\n");
    });

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(bookmarksStorageKey) ?? "{}",
      ) as Record<string, number[]>;
      expect(stored[key]).toEqual([4]);
    });
  });

  it("keeps Monaco in stream selection mode so whole lines can be selected", async () => {
    installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();

    await screen.findByLabelText("mock editor");

    expect(editorOptionsByPath.get(entries[0].path)).toEqual(
      expect.objectContaining({
        columnSelection: false,
        multiCursorModifier: "alt",
      }),
    );
  });

  it("accepts visible Monaco completions with Enter and Tab", async () => {
    installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();

    await screen.findByLabelText("mock editor");

    expect(editorOptionsByPath.get(entries[0].path)).toEqual(
      expect.objectContaining({
        acceptSuggestionOnEnter: "on",
        tabCompletion: "on",
        suggest: expect.objectContaining({
          preview: true,
          showInlineDetails: true,
          showStatusBar: true,
        }),
      }),
    );
  });

  it("applies the saved workspace preset when the app starts", async () => {
    installLatexDoMock();
    storeCompleteAiConfig({ layoutPreset: "focus" });

    render(<App />);

    expect(document.querySelector(".workbench")).toHaveAttribute(
      "data-layout-preset",
      "focus",
    );
    expect(document.querySelector(".sidebar")).not.toBeInTheDocument();

    await openProjectFromWelcome();

    expect(document.querySelector(".preview-pane")).toBeInTheDocument();
    expect(document.querySelector(".bottom-panel")).not.toBeInTheDocument();
  });

  it("changes the live workspace layout from settings", async () => {
    installLatexDoMock();
    storeCompleteAiConfig({ layoutPreset: "balanced" });

    render(<App />);
    await openProjectFromWelcome();
    await screen.findByLabelText("mock editor");

    fireEvent.click(screen.getByLabelText(/open settings/i));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });

    fireEvent.click(within(dialog).getByRole("radio", { name: /Power/i }));
    await waitFor(() => {
      expect(document.querySelector(".workbench")).toHaveAttribute(
        "data-layout-preset",
        "power",
      );
      expect(document.querySelector(".sidebar")).toBeInTheDocument();
      expect(document.querySelector(".bottom-panel")).toBeInTheDocument();
    });

    fireEvent.click(within(dialog).getByRole("radio", { name: /Focus/i }));
    await waitFor(() => {
      expect(document.querySelector(".workbench")).toHaveAttribute(
        "data-layout-preset",
        "focus",
      );
      expect(document.querySelector(".sidebar")).not.toBeInTheDocument();
      expect(document.querySelector(".bottom-panel")).not.toBeInTheDocument();
      expect(editorOptionsByPath.get(entries[0].path)).toEqual(
        expect.objectContaining({
          minimap: expect.objectContaining({ enabled: false }),
        }),
      );
    });

    expect(
      JSON.parse(window.localStorage.getItem(aiConfigStorageKey) ?? "{}").layoutPreset,
    ).toBe("focus");
  });

  it("does not compile while typing by default", async () => {
    const api = installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();
    api.compile.mockClear();

    fireEvent.change(await screen.findByLabelText("mock editor"), {
      target: {
        value:
          "\\documentclass{article}\n\\begin{document}\nTyping should not compile\n\\end{document}\n",
      },
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    });

    expect(api.compile).not.toHaveBeenCalled();
  });

  it("compiles after typing only when live preview is enabled", async () => {
    const api = installLatexDoMock();
    storeAcceptedSettings({ livePreview: true });

    render(<App />);
    await openProjectFromWelcome();
    api.compile.mockClear();

    fireEvent.change(await screen.findByLabelText("mock editor"), {
      target: {
        value:
          "\\documentclass{article}\n\\begin{document}\nLive preview compiles\n\\end{document}\n",
      },
    });

    await waitFor(() => {
      expect(api.compile).toHaveBeenCalledTimes(1);
    });
  });

  it("opens project images as preview tabs from the file tree", async () => {
    const api = installLatexDoMock();
    const imageEntry: ProjectEntry = {
      name: "chart.png",
      path: "/Users/omar/project/figures/chart.png",
      relativePath: "figures/chart.png",
      type: "file",
    };
    api.listProject.mockResolvedValue([...entries, imageEntry]);
    api.readAsset.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));

    render(<App />);
    await openProjectFromWelcome();
    api.getGitBlame.mockClear();

    const imageRow = await waitFor(() => {
      const row = document.querySelector(
        '.tree-row[title="figures/chart.png"]',
      ) as HTMLElement | null;
      expect(row).not.toBeNull();
      return row as HTMLElement;
    });

    fireEvent.click(imageRow);

    await waitFor(() => {
      expect(api.readAsset).toHaveBeenCalledWith(project.id, "figures/chart.png");
    });
    const preview = await screen.findByRole("img", {
      name: "figures/chart.png preview",
    });
    expect(preview.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByLabelText("mock editor")).not.toBeInTheDocument();
    expect(api.readFile).not.toHaveBeenCalledWith(project.id, "figures/chart.png");
    expect(api.getGitBlame).not.toHaveBeenCalled();
  });

  it("opens project PDFs with the PDF.js preview tab from the file tree", async () => {
    const api = installLatexDoMock();
    const pdfEntry: ProjectEntry = {
      name: "diagram.pdf",
      path: "/Users/omar/project/figures/diagram.pdf",
      relativePath: "figures/diagram.pdf",
      type: "file",
    };
    api.listProject.mockResolvedValue([...entries, pdfEntry]);
    api.readAsset.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));

    render(<App />);
    await openProjectFromWelcome();
    api.getGitBlame.mockClear();

    const pdfRow = await waitFor(() => {
      const row = document.querySelector(
        '.tree-row[title="figures/diagram.pdf"]',
      ) as HTMLElement | null;
      expect(row).not.toBeNull();
      return row as HTMLElement;
    });

    fireEvent.click(pdfRow);

    await waitFor(() => {
      expect(api.readAsset).toHaveBeenCalledWith(project.id, "figures/diagram.pdf");
    });
    const preview = await screen.findByTestId("mock-pdf-preview");
    expect(preview).toHaveAttribute("data-pdf-bytes", "4");
    expect(screen.queryByText("PDF preview unavailable.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("mock editor")).not.toBeInTheDocument();
    expect(api.readFile).not.toHaveBeenCalledWith(project.id, "figures/diagram.pdf");
    expect(api.getGitBlame).not.toHaveBeenCalled();
  });

  it("opens arbitrary text extensions from the file tree", async () => {
    const api = installLatexDoMock();
    const scriptEntry: ProjectEntry = {
      name: "analysis.py",
      path: "/Users/omar/project/analysis.py",
      relativePath: "analysis.py",
      type: "file",
    };
    api.listProject.mockResolvedValue([...entries, scriptEntry]);
    api.readFile.mockImplementation(async (_projectId: string, relativePath: string) =>
      relativePath === "analysis.py" ? "print('ok')\n" : "Main original\n",
    );

    render(<App />);
    await openProjectFromWelcome();

    const scriptRow = await waitFor(() => {
      const row = document.querySelector(
        '.tree-row[title="analysis.py"]',
      ) as HTMLElement | null;
      expect(row).not.toBeNull();
      return row as HTMLElement;
    });

    fireEvent.click(scriptRow);

    await waitFor(() => {
      expect(api.readFile).toHaveBeenCalledWith(project.id, "analysis.py");
      expect(screen.getByLabelText("mock editor")).toHaveValue("print('ok')\n");
    });
  });

  it("closes the active editor tab with Cmd/Ctrl+W", async () => {
    installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();

    expect(await screen.findByLabelText("mock editor")).toBeInTheDocument();

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.queryByLabelText("mock editor")).not.toBeInTheDocument();
    });
  });

  it("closes the active asset preview tab with Cmd/Ctrl+W", async () => {
    const api = installLatexDoMock();
    const imageEntry: ProjectEntry = {
      name: "chart.png",
      path: "/Users/omar/project/figures/chart.png",
      relativePath: "figures/chart.png",
      type: "file",
    };
    api.listProject.mockResolvedValue([...entries, imageEntry]);
    api.readAsset.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));

    render(<App />);
    await openProjectFromWelcome();

    const imageRow = await waitFor(() => {
      const row = document.querySelector(
        '.tree-row[title="figures/chart.png"]',
      ) as HTMLElement | null;
      expect(row).not.toBeNull();
      return row as HTMLElement;
    });
    fireEvent.click(imageRow);

    expect(
      await screen.findByRole("img", { name: "figures/chart.png preview" }),
    ).toBeInTheDocument();

    const event = new KeyboardEvent("keydown", {
      key: "w",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(
        screen.queryByRole("img", { name: "figures/chart.png preview" }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("mock editor")).toBeInTheDocument();
    });
  });

  it("shows the main-process read refusal when opening an unsafe text file", async () => {
    const api = installLatexDoMock();
    api.readFile.mockRejectedValue(new Error("File is too large."));

    render(<App />);
    await openProjectFromWelcome();

    const fileRow = document.querySelector(
      '.tree-row[title="main.tex"]',
    ) as HTMLButtonElement | null;
    expect(fileRow).not.toBeNull();
    fireEvent.click(fileRow as HTMLButtonElement);

    expect(await screen.findByText("File is too large.")).toBeVisible();
    expect(screen.queryByLabelText("mock editor")).not.toBeInTheDocument();
  });

  it("fetches working-tree blame for the active document", async () => {
    const api = installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();

    const fileRow = document.querySelector(
      '.tree-row[title="main.tex"]',
    ) as HTMLButtonElement | null;
    expect(fileRow).not.toBeNull();
    fireEvent.click(fileRow as HTMLButtonElement);

    await waitFor(() => {
      expect(api.getGitBlame).toHaveBeenCalledWith(project.id, "main.tex", {
        kind: "working-tree",
      });
    });
  });

  it("shows an error when opening a folder fails", async () => {
    const api = installLatexDoMock();
    api.openProject.mockRejectedValue(new Error("Folder picker failed."));

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));

    expect(await screen.findByText("Folder picker failed.")).toBeVisible();
  });

  it("passes project tree settings when listing a project", async () => {
    const api = installLatexDoMock();

    render(<App />);

    fireEvent.click(screen.getByLabelText(/open settings/i));
    const ignoredNames = screen.getByLabelText("Ignored project tree names");
    fireEvent.change(ignoredNames, {
      target: { value: "vendor\nbuild-cache" },
    });
    fireEvent.click(screen.getByRole("button", { name: /open folder/i }));

    await waitFor(() => {
      expect(api.listProject).toHaveBeenCalled();
    });
    expect(api.listProject).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({
        ignoredNames: ["vendor", "build-cache"],
        maxDepth: 8,
        maxEntries: 5000,
      }),
    );
  });

  it("imports files from the project tree through the native import dialog", async () => {
    const api = installLatexDoMock();
    const treeEntries: ProjectEntry[] = [
      {
        name: "figures",
        path: "/Users/omar/project/figures",
        relativePath: "figures",
        type: "directory",
        children: [],
      },
      ...entries,
    ];
    api.listProject.mockResolvedValue(treeEntries);
    api.chooseImportExternalFiles.mockResolvedValue([
      {
        sourcePath: "/Users/omar/Desktop/chart.png",
        relativePath: "figures/chart.png",
        type: "file",
      },
    ]);

    render(<App />);
    await openProjectFromWelcome();

    fireEvent.click(screen.getByTitle("Actions for figures"));
    fireEvent.click(await screen.findByRole("button", { name: "Import files here" }));

    await waitFor(() => {
      expect(api.chooseImportExternalFiles).toHaveBeenCalledWith(project.id, "figures");
    });
    expect(await screen.findByText("Imported figures/chart.png")).toBeVisible();
  });

  it("decodes encoded spaces in project tree labels", async () => {
    const api = installLatexDoMock();
    api.listProject.mockResolvedValue([
      {
        name: "My%20Draft.tex",
        path: "/Users/omar/project/My%20Draft.tex",
        relativePath: "My%20Draft.tex",
        type: "file",
      },
    ]);

    render(<App />);
    await openProjectFromWelcome();

    expect((await screen.findAllByText("My Draft.tex")).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.queryByText("My%20Draft.tex")).not.toBeInTheDocument();
  });

  it("opens the converted TeX file after importing DOCX into a new project", async () => {
    const api = installLatexDoMock();
    const importedProject: OpenProject = {
      id: "project-2",
      rootPath: "/Users/omar/imported",
      name: "imported",
    };
    const importedEntries: ProjectEntry[] = [
      {
        name: "paper.tex",
        path: "/Users/omar/imported/paper.tex",
        relativePath: "paper.tex",
        type: "file",
      },
    ];

    api.importDocx.mockResolvedValue({
      sourcePath: "/Users/omar/Desktop/paper.docx",
      relativePath: "paper.tex",
      assetDirectory: "assets/paper",
      mediaFiles: [],
      converter: "built-in",
      warnings: [],
      project: importedProject,
    });
    api.listProject.mockImplementation(async (projectId: string) =>
      projectId === importedProject.id ? importedEntries : entries,
    );
    api.readFile.mockResolvedValue(
      "\\documentclass{article}\n\\begin{document}\nImported\n\\end{document}\n",
    );

    render(<App />);

    fireEvent.click(screen.getByText("Import DOCX").closest("button")!);

    await waitFor(() => {
      expect(api.readFile).toHaveBeenCalledWith(importedProject.id, "paper.tex");
    });
    expect(
      ((await screen.findByLabelText("mock editor")) as HTMLTextAreaElement).value,
    ).toContain("Imported");
    expect(screen.getByText(/Imported paper\.docx to paper\.tex/i)).toBeVisible();
  });

  it("opens the reconstructed TeX file after importing PDF into a new project", async () => {
    const api = installLatexDoMock();
    const importedProject: OpenProject = {
      id: "project-2",
      rootPath: "/Users/omar/imported",
      name: "imported",
    };
    const importedEntries: ProjectEntry[] = [
      {
        name: "paper.tex",
        path: "/Users/omar/imported/paper.tex",
        relativePath: "paper.tex",
        type: "file",
      },
    ];

    api.importPdf.mockResolvedValue({
      sourcePath: "/Users/omar/Desktop/paper.pdf",
      relativePath: "paper.tex",
      bibRelativePath: null,
      assetDirectory: null,
      mediaFiles: [],
      converter: "built-in",
      pageCount: 1,
      stats: {
        sections: 1,
        equations: 2,
        figures: 0,
        tables: 0,
        references: 0,
        citations: 0,
        crossReferences: 0,
        lowConfidenceMath: 0,
      },
      warnings: [],
      project: importedProject,
    });
    api.listProject.mockImplementation(async (projectId: string) =>
      projectId === importedProject.id ? importedEntries : entries,
    );
    api.readFile.mockResolvedValue(
      "\\documentclass{article}\n\\begin{document}\nRebuilt\n\\end{document}\n",
    );

    render(<App />);

    fireEvent.click(screen.getByText("Convert PDF to LaTeX").closest("button")!);

    await waitFor(() => {
      expect(api.readFile).toHaveBeenCalledWith(importedProject.id, "paper.tex");
    });
    expect(
      ((await screen.findByLabelText("mock editor")) as HTMLTextAreaElement).value,
    ).toContain("Rebuilt");
    expect(screen.getByText(/Reconstructed paper\.pdf to paper\.tex/i)).toBeVisible();
  });

  it("reviews a paper from the welcome screen as a standalone PDF", async () => {
    const api = installLatexDoMock();

    render(<App />);

    const reviewPaper = screen
      .getByText("Read, annotate, highlight, and ask AI about a PDF")
      .closest("button");
    expect(reviewPaper).not.toBeNull();
    fireEvent.click(reviewPaper as HTMLButtonElement);

    expect(api.createResearchSpace).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.chooseImportExternalFiles).not.toHaveBeenCalled();
    expect(api.importPdf).not.toHaveBeenCalled();

    choosePdfForReview(createReviewPdfFile("attention.pdf"));

    await expect(screen.findByTestId("mock-pdf-preview")).resolves.toBeInTheDocument();
    expect(screen.getByText(/Reviewing attention\.pdf in Reader Mode/i)).toBeVisible();
    expect(api.readAsset).not.toHaveBeenCalled();
  });

  it("reviews a paper from the toolbar without importing it into the current project", async () => {
    const api = installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review an external PDF paper in Reader Mode",
      }),
    );

    choosePdfForReview(createReviewPdfFile("standalone-paper.pdf"));

    expect(api.createResearchSpace).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.chooseImportExternalFiles).not.toHaveBeenCalled();
    expect(api.importPdf).not.toHaveBeenCalled();
    expect(api.readAsset).not.toHaveBeenCalled();
    await expect(screen.findByTestId("mock-pdf-preview")).resolves.toBeInTheDocument();
    expect(
      screen.getByText(/Reviewing standalone-paper\.pdf in Reader Mode/i),
    ).toBeVisible();
  });

  it("opens a standalone PDF for review in the browser runtime without a project", async () => {
    const api = installLatexDoMock();
    api.runtime = "browser";

    render(<App />);

    fireEvent.click(
      screen
        .getByText("Read, annotate, highlight, and ask AI about a PDF")
        .closest("button")!,
    );

    expect(api.createResearchSpace).not.toHaveBeenCalled();
    expect(api.chooseImportExternalFiles).not.toHaveBeenCalled();

    choosePdfForReview(createReviewPdfFile("attention.pdf"));

    await expect(screen.findByTestId("mock-pdf-preview")).resolves.toBeInTheDocument();
    expect(screen.getByText(/Reviewing attention\.pdf in Reader Mode/i)).toBeVisible();
  });

  it("starts the updater from the available update banner", async () => {
    const updateResult: UpdateCheckResult = {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: "https://latexdo.org/downloads/v0.2.0/",
      updateAvailable: true,
    };
    const api = installLatexDoMock({
      updateResult,
      updateNowResult: {
        ...updateResult,
        installerPath: "/Users/omar/Downloads/LatexDo-macos-arm64.dmg",
        opened: true,
      },
    });

    render(<App />);

    const updateButton = await screen.findByRole("button", {
      name: /update now/i,
    });
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(api.updateNow).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the automatic installer handoff when the updater quits the old app", async () => {
    const updateResult: UpdateCheckResult = {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: "https://latexdo.org/downloads/v0.2.0/",
      updateAvailable: true,
      automaticInstallAvailable: true,
    };
    const api = installLatexDoMock({
      updateResult,
      updateNowResult: {
        ...updateResult,
        installerPath: "/Users/omar/Downloads/LatexDo-macos-arm64.dmg",
        opened: true,
        quitScheduled: true,
        manualDownload: false,
      },
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /update now/i }));

    await waitFor(() => {
      expect(api.updateNow).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(
        "Installing LatexDo 0.2.0. LatexDo will quit while the updater finishes.",
      ),
    ).toBeVisible();
  });

  it("shows update download progress and current build details", async () => {
    const updateResult: UpdateCheckResult = {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      releaseUrl: "https://latexdo.org/downloads/v0.2.0/",
      updateAvailable: true,
    };
    const api = installLatexDoMock({ updateResult });

    render(<App />);

    await screen.findByRole("button", { name: /update now/i });
    await waitFor(() => {
      expect(api.onUpdateProgress).toHaveBeenCalledTimes(1);
    });

    const progressListener = api.onUpdateProgress.mock.calls[0]?.[0] as
      | ((progress: UpdateDownloadProgress) => void)
      | undefined;
    expect(progressListener).toBeDefined();

    act(() => {
      progressListener?.({
        status: "downloading",
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
        fileName: "LatexDo-macos-arm64.dmg",
        fileLabel: "macOS Apple Silicon",
        transferredBytes: 5 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        percent: 50,
        message: "Downloading macOS Apple Silicon",
      });
    });

    expect(
      screen.getByText("Current build 0.1.0. Available build 0.2.0."),
    ).toBeVisible();
    expect(
      screen.getByText("Downloading macOS Apple Silicon (50%, 5 MB of 10 MB)"),
    ).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: /update download progress/i }),
    ).toHaveAttribute("aria-valuenow", "50");
  });

  it("shows a manual update button in settings", async () => {
    const api = installLatexDoMock({
      updateResult: {
        currentVersion: "0.1.0",
        latestVersion: "0.1.0",
        releaseUrl: "https://latexdo.org/downloads/",
        updateAvailable: false,
      },
    });

    render(<App />);

    fireEvent.click(screen.getByLabelText(/open settings/i));
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));

    const manualUpdateButton = await screen.findByRole("button", {
      name: /update manually/i,
    });
    fireEvent.click(manualUpdateButton);

    await waitFor(() => {
      expect(api.updateNow).toHaveBeenCalledTimes(1);
    });
  });

  it("shows up-to-date update status with current build details", async () => {
    installLatexDoMock({
      updateResult: {
        currentVersion: "0.2.0",
        latestVersion: "0.2.0",
        releaseUrl: "https://latexdo.org/downloads/",
        updateAvailable: false,
      },
    });

    render(<App />);
    fireEvent.click(screen.getByLabelText(/open settings/i));
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));

    expect(
      await screen.findByText("You are up to date. Current build 0.2.0."),
    ).toBeVisible();
    expect(screen.getByText("Current build 0.2.0. You are up to date.")).toBeVisible();
    expect(screen.getByText("Updates at latexdo.org/downloads/.")).toBeVisible();
  });

  it("opens the downloads page for manual update fallback results", async () => {
    const updateResult: UpdateCheckResult = {
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
      releaseUrl: "https://latexdo.org/downloads/v0.3.0/",
      updateAvailable: true,
      automaticInstallAvailable: false,
    };
    const api = installLatexDoMock({
      updateResult,
      updateNowResult: {
        ...updateResult,
        installerPath: null,
        opened: true,
        restartScheduled: false,
        manualDownload: true,
      },
    });

    render(<App />);

    const updateButton = await screen.findByRole("button", {
      name: /open update/i,
    });
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(api.updateNow).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Opened LatexDo 0.3.0 downloads.")).toBeVisible();
    expect(
      screen.getByText("Available at latexdo.org/downloads/v0.3.0/."),
    ).toBeVisible();
  });

  it("shows the What's New dialog after a confirmed upgrade", async () => {
    const api = installLatexDoMock();
    api.getWhatsNew.mockResolvedValue({
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      releases: [
        {
          schemaVersion: 1,
          product: "LatexDo",
          version: "0.3.0",
          title: "LatexDo 0.3.0",
          summary: "Bigger and faster.",
          publishedAt: "2026-03-01T12:00:00.000Z",
          releaseUrl: "https://latexdo.org/downloads/",
          highlights: [
            {
              id: "latex-reengines",
              category: "compiler",
              title: "Reworked compilation",
              description: "Faster recompiles.",
            },
          ],
        },
      ],
      shouldPresent: true,
      notesAvailable: true,
    });

    render(<App />);

    const dialog = await screen.findByRole("dialog", {
      name: /what.s.new in latexdo 0\.3\.0/i,
    });
    expect(within(dialog).getByText("Reworked compilation")).toBeVisible();
    expect(within(dialog).getByText(/updated from 0\.2\.0/i)).toBeInTheDocument();
  });

  it("dismissing the What's New dialog marks the version presented", async () => {
    const api = installLatexDoMock();
    api.getWhatsNew.mockResolvedValue({
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      releases: [],
      shouldPresent: true,
      notesAvailable: false,
    });

    render(<App />);

    const dialog = await screen.findByRole("dialog", {
      name: /what.s.new in latexdo 0\.3\.0/i,
    });
    expect(
      within(dialog).getByText(/release notes aren.t available right now/i),
    ).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(api.markWhatsNewPresented).toHaveBeenCalledWith("0.3.0");
    });
    expect(
      screen.queryByRole("dialog", { name: /what.s.new/i }),
    ).not.toBeInTheDocument();
  });

  it("does not auto-show the What's New dialog on a fresh install", async () => {
    const api = installLatexDoMock();
    api.getWhatsNew.mockResolvedValue({
      fromVersion: null,
      toVersion: "0.3.0",
      releases: [],
      shouldPresent: false,
      notesAvailable: false,
    });

    render(<App />);

    await waitFor(() => {
      expect(api.getWhatsNew).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByRole("dialog", { name: /what.s.new/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the What's New dialog from the menu event", async () => {
    const api = installLatexDoMock();
    api.getWhatsNew.mockResolvedValue({
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      releases: [],
      shouldPresent: false,
      notesAvailable: false,
    });

    render(<App />);

    const listener = api.onWhatsNewOpen.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(listener).toBeDefined();
    act(() => listener?.());

    expect(
      await screen.findByRole("dialog", { name: /what.s.new in latexdo 0\.3\.0/i }),
    ).toBeVisible();
  });

  it("opens the full release notes page from the modal", async () => {
    const api = installLatexDoMock();
    api.getWhatsNew.mockResolvedValue({
      fromVersion: "0.2.0",
      toVersion: "0.3.0",
      releases: [
        {
          schemaVersion: 1,
          product: "LatexDo",
          version: "0.3.0",
          title: "LatexDo 0.3.0",
          publishedAt: "2026-03-01T12:00:00.000Z",
          releaseUrl: "https://latexdo.org/downloads/",
          highlights: [],
        },
      ],
      shouldPresent: true,
      notesAvailable: true,
    });

    render(<App />);

    const dialog = await screen.findByRole("dialog", {
      name: /what.s.new in latexdo 0\.3\.0/i,
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /view full release notes/i }),
    );

    await waitFor(() => {
      expect(api.openReleaseNotesPage).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps optional workbench tools hidden until their extensions are installed", async () => {
    installLatexDoMock();

    render(<App />);

    expect(screen.queryByTitle("Citation Manager")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Table Generator")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Figure → TikZ Converter")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Notation Manager")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/open settings/i));
    expect(
      within(screen.getByRole("dialog", { name: /settings/i })).queryByRole("button", {
        name: "Extensions",
      }),
    ).not.toBeInTheDocument();
    await closeSettingsDialog();

    await installExtensionByName("Citation Workbench");
    expect(screen.getByText("EXTENSIONS")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: /search extensions/i })).toBeVisible();
    expect(screen.getByTitle("Citation Manager")).toBeVisible();
    expect(
      screen.queryByText("Browse installable LatexDo packs from store.latexdo.org."),
    ).not.toBeInTheDocument();

    await installExtensionByName("Table Generator");
    expect(screen.getByTitle("Table Generator")).toBeVisible();

    await installExtensionByName("Figure Lab");
    expect(screen.getByTitle("Figure → TikZ Converter")).toBeVisible();

    await installExtensionByName("Math Notation Kit");
    expect(screen.getByTitle("Notation Manager")).toBeVisible();

    const tableCard = screen.getByText("Table Generator").closest("article");
    expect(tableCard).not.toBeNull();
    fireEvent.click(
      within(tableCard as HTMLElement).getByRole("button", {
        name: /uninstall/i,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTitle("Table Generator")).not.toBeInTheDocument();
    });
  });

  it("shows extension manifest details from the sidebar list", async () => {
    installLatexDoMock();

    render(<App />);

    fireEvent.click(screen.getByTitle("Extensions"));
    const card = (await screen.findByText("Citation Workbench")).closest("article");
    expect(card).not.toBeNull();

    fireEvent.click(
      within(card as HTMLElement).getByRole("button", {
        name: /view citation workbench details/i,
      }),
    );

    const details = screen.getByRole("region", { name: /extension details/i });
    expect(
      within(details).getByRole("heading", { name: "Citation Workbench" }),
    ).toBeVisible();
    expect(within(details).getByText("Author")).toBeVisible();
    expect(within(details).getByText("LatexDo")).toBeVisible();
    expect(within(details).getByText("latexdo.citation-workbench")).toBeVisible();
    expect(within(details).getByText("Project Bibliography Enabled")).toBeVisible();
  });

  it("shows Citation Manager for older Citation Workbench manifests", async () => {
    const legacyCitationCatalog: LatexDoExtensionCatalog = {
      ...fallbackExtensionCatalog,
      extensions: fallbackExtensionCatalog.extensions.map((extension) =>
        extension.id === "latexdo.citation-workbench"
          ? {
              ...extension,
              contributes: {
                ...extension.contributes,
                featureFlags: {
                  citationAssistantEnabled: true,
                  detectMissingCitations: true,
                  detectUnusedEntries: true,
                  detectDuplicateReferences: true,
                  detectBrokenLinks: true,
                  suggestCitationKeys: true,
                  importMetadataSources: true,
                  warnOldCitations: true,
                },
              },
            }
          : extension,
      ),
    };
    const api = installLatexDoMock({ extensionCatalog: legacyCitationCatalog });

    render(<App />);

    fireEvent.click(screen.getByTitle("Extensions"));
    await waitFor(() => {
      expect(api.fetchExtensionCatalog).toHaveBeenCalledTimes(1);
    });
    await screen.findByText("Live catalog");

    const card = screen.getByText("Citation Workbench").closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: /install/i }),
    );

    expect(screen.getByTitle("Citation Manager")).toBeVisible();
  });

  it("keeps Citation Manager visible when citation checks are disabled", async () => {
    installLatexDoMock();
    window.localStorage.setItem(
      installedExtensionsStorageKey,
      JSON.stringify(["latexdo.citation-workbench"]),
    );
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify(
        acceptedSettings({
          citationAssistantEnabled: false,
          projectBibliographyEnabled: false,
        }),
      ),
    );

    render(<App />);

    expect(screen.getByTitle("Citation Manager")).toBeVisible();
  });

  it("closes settings and citation manager with Escape", async () => {
    installLatexDoMock();

    render(<App />);
    await installExtensionByName("Citation Workbench");
    await closeSettingsDialog();

    fireEvent.click(screen.getByLabelText(/open settings/i));
    expect(screen.getByRole("dialog", { name: /settings/i })).toBeVisible();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /settings/i }),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Citation Manager"));
    expect(
      await screen.findByRole("heading", { name: "Project Bibliography" }),
    ).toBeVisible();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Project Bibliography")).not.toBeInTheDocument();
    });
  });

  it("closes the researcher profile with Escape", async () => {
    installLatexDoMock();

    render(<App />);

    fireEvent.click(screen.getByTitle("Researcher profile"));
    expect(
      await screen.findByRole("dialog", { name: /researcher profile/i }),
    ).toBeVisible();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /researcher profile/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("opens real AI settings from the unconfigured AI sidebar", async () => {
    installLatexDoMock();
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({
        ...defaultAiConfig,
        setupComplete: false,
        provider: "cloud",
        cloud: {
          ...defaultAiConfig.cloud,
          credentialConfigured: false,
        },
      }),
    );

    render(<App />);

    expect(screen.getByText("Set up your LatexDo workspace")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("Set up your LatexDo workspace")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /set up workspace/i }));
    fireEvent.click(await screen.findByRole("button", { name: /skip setup/i }));
    await waitFor(() => {
      expect(
        screen.queryByText("Set up your LatexDo workspace"),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("AI assistant"));
    fireEvent.click(await screen.findByTitle("AI settings"));

    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    expect(within(dialog).getByLabelText("AI selection")).toHaveValue("customize");
    expect(within(dialog).getByLabelText("Custom provider")).toHaveValue(
      `cloud:${defaultAiConfig.cloud.providerId}`,
    );
    expect(
      within(dialog).queryByText("Set up your LatexDo workspace"),
    ).not.toBeInTheDocument();
  });

  it("opens API key and ORCID links through the app external URL API", async () => {
    const api = installLatexDoMock();
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({
        ...defaultAiConfig,
        setupComplete: true,
        provider: "cloud",
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByLabelText(/open settings/i));
    const settingsDialog = await screen.findByRole("dialog", { name: /settings/i });
    fireEvent.click(
      within(settingsDialog).getByRole("button", { name: "AI Assistant" }),
    );
    const providerSelect = within(settingsDialog).getByLabelText(
      "Custom provider",
    ) as HTMLSelectElement;
    const providerKeyUrls = [
      ["cloud:anthropic", "https://console.anthropic.com/settings/keys"],
      ["cloud:openai", "https://platform.openai.com/api-keys"],
      ["cloud:gemini", "https://aistudio.google.com/apikey"],
      ["cloud:groq", "https://console.groq.com/keys"],
      ["cloud:deepseek", "https://platform.deepseek.com/api_keys"],
      ["cloud:mistral", "https://console.mistral.ai/api-keys"],
      ["cloud:openrouter", "https://openrouter.ai/keys"],
    ] as const;
    for (const [provider, url] of providerKeyUrls) {
      fireEvent.change(providerSelect, { target: { value: provider } });
      fireEvent.click(
        within(settingsDialog).getByRole("button", { name: /Get API key/i }),
      );
      expect(api.openExternalUrl).toHaveBeenLastCalledWith(url);
    }

    fireEvent.click(within(settingsDialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByTitle("Researcher profile"));
    const profileDialog = await screen.findByRole("dialog", {
      name: /Researcher profile/i,
    });
    fireEvent.click(within(profileDialog).getByRole("button", { name: /ORCID/i }));
    fireEvent.click(
      within(profileDialog).getByRole("button", {
        name: /Register at orcid\.org/i,
      }),
    );

    expect(api.openExternalUrl).toHaveBeenCalledWith("https://orcid.org/register");
  });

  it("opens provider API key pages from the unconfigured AI sidebar", async () => {
    const api = installLatexDoMock();
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({
        ...defaultAiConfig,
        setupComplete: true,
        provider: "cloud",
        cloud: {
          ...defaultAiConfig.cloud,
          providerId: "openai",
          credentialConfigured: false,
        },
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByTitle("AI assistant"));
    fireEvent.click(await screen.findByRole("button", { name: "Get API key" }));

    expect(api.openExternalUrl).toHaveBeenCalledWith(
      "https://platform.openai.com/api-keys",
    );
  });

  it("fetches Ollama models and starts with no default Ollama model", async () => {
    installLatexDoMock();
    const detectOllama = vi.fn().mockResolvedValue({
      available: true,
      models: ["llama3.1:8b", "mistral:latest"],
    });
    Object.defineProperty(window, "aiApi", {
      configurable: true,
      value: { detectOllama },
    });
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({
        ...defaultAiConfig,
        setupComplete: true,
        provider: "ollama",
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByLabelText(/open settings/i));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "AI Assistant" }));

    const modelSelect = (await within(dialog).findByLabelText(
      "Model",
    )) as HTMLSelectElement;
    expect(modelSelect).toHaveValue("");

    await within(dialog).findByRole("option", { name: "llama3.1:8b" });
    expect(detectOllama).toHaveBeenCalledWith("http://127.0.0.1:11434");

    fireEvent.change(modelSelect, { target: { value: "llama3.1:8b" } });
    expect(modelSelect).toHaveValue("llama3.1:8b");

    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem(aiConfigStorageKey) ?? "{}").ollamaModel,
      ).toBe("llama3.1:8b");
    });
  });

  it("splits LatexDo AI downloads from Local Model GGUF imports", async () => {
    installLatexDoMock();
    const downloadedLatexDoAiModels = [
      {
        id: "qwen2.5-coder-3b",
        fileName: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
        downloaded: true,
        path: "/models/qwen2.5-coder-3b-instruct-q4_k_m.gguf",
        sizeBytes: 1024,
      },
    ];
    const importedModels = [
      ...downloadedLatexDoAiModels,
      {
        id: "custom.gguf",
        fileName: "custom.gguf",
        downloaded: true,
        path: "/models/custom.gguf",
        sizeBytes: 1024,
      },
    ];
    const listModels = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(downloadedLatexDoAiModels)
      .mockResolvedValue(importedModels);
    const downloadModel = vi.fn().mockResolvedValue({ ok: true });
    const importModel = vi.fn().mockResolvedValue({
      id: "custom.gguf",
      fileName: "custom.gguf",
      downloaded: true,
      path: "/models/custom.gguf",
      sizeBytes: 1024,
    });
    Object.defineProperty(window, "aiApi", {
      configurable: true,
      value: {
        listModels,
        downloadModel,
        subscribeDownload: vi.fn(() => vi.fn()),
        importModel,
        getSystemCapabilities: vi.fn().mockResolvedValue(highRamCapabilities),
      },
    });
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({
        ...defaultAiConfig,
        setupComplete: true,
        provider: "local",
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByLabelText(/open settings/i));
    const dialog = await screen.findByRole("dialog", { name: /settings/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "AI Assistant" }));

    const providerSelect = within(dialog).getByLabelText(
      "AI selection",
    ) as HTMLSelectElement;
    expect(providerSelect).toHaveValue("latexdo-tier:latexdo-ai-plus");
    expect(
      await within(dialog).findByRole("option", { name: "LatexDo AI" }),
    ).toBeVisible();
    expect(
      await within(dialog).findByRole("option", { name: "LatexDo AI Plus" }),
    ).toBeVisible();
    expect(within(dialog).getByRole("option", { name: "Customize" })).toBeVisible();
    expect(within(dialog).queryByLabelText("Model")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Import/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(await within(dialog).findByRole("button", { name: /Download/i }));
    await waitFor(() => {
      expect(downloadModel).toHaveBeenCalledWith("latexdo-ai-plus");
    });

    fireEvent.change(providerSelect, { target: { value: "customize" } });
    expect(providerSelect).toHaveValue("customize");
    const customProviderSelect = within(dialog).getByLabelText(
      "Custom provider",
    ) as HTMLSelectElement;
    fireEvent.change(customProviderSelect, { target: { value: "local-model" } });
    expect(customProviderSelect).toHaveValue("local-model");
    expect(await within(dialog).findByLabelText("Model")).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: /Import/i }));
    await waitFor(() => expect(importModel).toHaveBeenCalledTimes(1));
    await within(dialog).findByRole("option", {
      name: /custom\s+·\s+1\.0 KB/i,
    });

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(aiConfigStorageKey) ?? "{}");
      expect(saved.provider).toBe("local");
      expect(saved.modelId).toBe("imported-gguf:custom.gguf");
      expect(saved.modelDownloaded).toBe(true);
    });
  });

  it("creates AI chat tabs from the plus button and closes them", async () => {
    installLatexDoMock();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({
        ...defaultAiConfig,
        setupComplete: true,
        provider: "cloud",
        cloud: {
          ...defaultAiConfig.cloud,
          credentialConfigured: true,
        },
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByTitle("AI assistant"));
    expect(await screen.findByRole("tab", { name: "Chat 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const newChatIcon = screen.getByTitle("New chat").querySelector("svg");
    expect(newChatIcon).not.toBeNull();
    fireEvent.click(newChatIcon as SVGSVGElement);

    expect(await screen.findByRole("tab", { name: "Chat 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem("latexdo.ai.chatTabs.v1") ?? "{}",
      );
      expect(saved.chats).toHaveLength(2);
      expect(saved.activeId).toMatch(/^ai-chat-2-/);
    });
    expect(screen.getByRole("tab", { name: "Chat 1" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Chat 2" }));

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "Chat 2" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Chat 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("restores saved AI chat tabs and messages", async () => {
    installLatexDoMock();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    window.localStorage.setItem(
      aiConfigStorageKey,
      JSON.stringify({
        ...defaultAiConfig,
        setupComplete: true,
        provider: "cloud",
        cloud: {
          ...defaultAiConfig.cloud,
          credentialConfigured: true,
        },
      }),
    );
    window.localStorage.setItem(
      "latexdo.ai.chatTabs.v1",
      JSON.stringify({
        chats: [{ id: "ai-chat-saved", title: "Saved chat" }],
        activeId: "ai-chat-saved",
        nextNumber: 2,
      }),
    );
    window.localStorage.setItem(
      "latexdo.ai.chatState.ai-chat-saved.v1",
      JSON.stringify({
        version: 1,
        messages: [
          {
            id: "saved-user-message",
            role: "user",
            text: "saved question",
            activity: [],
          },
          {
            id: "saved-assistant-message",
            role: "assistant",
            text: "saved answer",
            activity: [],
          },
        ],
        history: [
          { role: "user", content: "saved question" },
          { role: "assistant", content: "saved answer" },
        ],
        updatedAt: Date.now(),
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByTitle("AI assistant"));
    expect(await screen.findByRole("tab", { name: "Saved chat" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("saved question")).toBeVisible();
    expect(screen.getByText("saved answer")).toBeVisible();

    fireEvent.click(screen.getByTitle("Close AI assistant"));
    fireEvent.click(screen.getByTitle("AI assistant"));

    expect(await screen.findByText("saved question")).toBeVisible();
    expect(screen.getByText("saved answer")).toBeVisible();
  });

  it("creates a project from a welcome template", async () => {
    const api = installLatexDoMock();

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /research paper/i }));

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledWith({
        folderName: "Research Paper",
      });
    });
    expect(api.writeFile).toHaveBeenCalledWith(
      "project-1",
      "main.tex",
      expect.stringContaining("\\section{Introduction}"),
    );
    expect(api.writeFile).toHaveBeenCalledWith(
      "project-1",
      "references.bib",
      expect.stringContaining("@misc{latexdo2026"),
    );
  });

  it("disables discard-all when there are no unstaged Git changes", async () => {
    installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [
          {
            path: "main.tex",
            indexStatus: "modified",
            worktreeStatus: "unmodified",
            staged: true,
            unstaged: false,
            untracked: false,
            conflicted: false,
          },
        ],
      },
    });

    render(<App />);
    await openProjectFromWelcome();

    fireEvent.click(screen.getByTitle("Source control"));

    expect(
      await screen.findByRole("button", {
        name: /discard all unstaged changes/i,
      }),
    ).toBeDisabled();
  });

  it("routes destructive Git discard buttons through the preload API", async () => {
    const api = installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [
          {
            path: "main.tex",
            indexStatus: "unmodified",
            worktreeStatus: "modified",
            staged: false,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
        ],
      },
    });

    render(<App />);
    await openProjectFromWelcome();

    fireEvent.click(screen.getByTitle("Source control"));

    const discardFile = await screen.findByRole("button", {
      name: /discard main\.tex/i,
    });
    expect(discardFile).toBeEnabled();
    fireEvent.click(discardFile);

    await waitFor(() => {
      expect(api.discardGitFile).toHaveBeenCalledWith("project-1", "main.tex");
    });

    const discardAll = screen.getByRole("button", {
      name: /discard all unstaged changes/i,
    });
    expect(discardAll).toBeEnabled();
    fireEvent.click(discardAll);

    await waitFor(() => {
      expect(api.discardAllGit).toHaveBeenCalledWith("project-1");
    });
  });

  it("splits source-control changes into expandable directory groups", async () => {
    installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [
          {
            path: "main.tex",
            indexStatus: "unmodified",
            worktreeStatus: "modified",
            staged: false,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
          {
            path: "chapters/intro.tex",
            indexStatus: "unmodified",
            worktreeStatus: "added",
            staged: false,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
        ],
      },
    });

    render(<App />);
    await openProjectFromWelcome();
    fireEvent.click(screen.getByTitle("Source control"));

    expect(
      await screen.findByRole("button", {
        name: /collapse changes group project root/i,
      }),
    ).toHaveAttribute("aria-expanded", "true");

    const chaptersGroup = screen.getByRole("button", {
      name: /collapse changes group chapters/i,
    });
    expect(chaptersGroup).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", {
        name: /open working tree diff for chapters\/intro\.tex/i,
      }),
    ).toBeVisible();

    fireEvent.click(chaptersGroup);

    expect(chaptersGroup).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", {
        name: /open working tree diff for chapters\/intro\.tex/i,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(chaptersGroup);

    expect(
      screen.getByRole("button", {
        name: /open working tree diff for chapters\/intro\.tex/i,
      }),
    ).toBeVisible();
  });

  it("keeps source control visible when Git history data is partial", async () => {
    const api = installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [],
      },
    });
    api.getGitHistory.mockResolvedValue({
      scope: "repo",
      target: null,
      commits: [
        {
          hash: "abcdef1234567890",
          subject: "Partial commit from older backend",
        } as unknown as GitGraphCommit,
      ],
    });

    render(<App />);
    await openProjectFromWelcome();
    fireEvent.click(screen.getByTitle("Source control"));

    expect(await screen.findByText("SOURCE CONTROL")).toBeVisible();
    expect(
      (await screen.findAllByText("Partial commit from older backend"))[0],
    ).toBeVisible();
  });

  it("opens staged and unstaged occurrences as distinct Monaco diff sessions", async () => {
    const api = installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [
          {
            path: "main.tex",
            indexStatus: "modified",
            worktreeStatus: "modified",
            staged: true,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
        ],
      },
    });

    render(<App />);
    await openProjectFromWelcome();
    fireEvent.click(screen.getByTitle("Source control"));

    fireEvent.click(
      await screen.findByRole("button", {
        name: /open working tree diff for main\.tex/i,
      }),
    );

    await waitFor(() => {
      expect(api.getGitEditorDiff).toHaveBeenCalledWith(
        "project-1",
        "main.tex",
        "changes",
      );
    });
    expect(await screen.findByTestId("mock-diff-editor")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /main\.tex \(index\).*main\.tex \(working tree\)/i,
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^main\.tex$/i })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: /open staged diff for main\.tex/i,
      }),
    );
    await waitFor(() => {
      expect(api.getGitEditorDiff).toHaveBeenLastCalledWith(
        "project-1",
        "main.tex",
        "staged",
      );
    });
    expect(
      screen.getByRole("button", {
        name: /main\.tex \(head\).*main\.tex \(index\)/i,
      }),
    ).toBeVisible();
  });

  it("uses PDF inverse search to open the matching source line", async () => {
    const api = installLatexDoMock();
    api.backwardSyncTex.mockResolvedValue({
      file: "main.tex",
      line: 3,
      column: 1,
    });

    render(<App />);
    await openProjectFromWelcome();

    fireEvent.click(screen.getByTitle("Compile"));

    await waitFor(() => {
      expect(api.readPdf).toHaveBeenCalledWith("project-1", "main.pdf");
    });

    fireEvent.doubleClick(await screen.findByTestId("mock-pdf-preview"));

    await waitFor(() => {
      expect(api.backwardSyncTex).toHaveBeenCalledWith(
        "project-1",
        "main.pdf",
        2,
        42,
        84,
      );
    });
    expect(await screen.findByText("Opened main.tex:3 from PDF")).toBeVisible();
  });

  it("opens local document history from the titlebar history button", async () => {
    installLatexDoMock();

    render(<App />);
    await openProjectFromWelcome();

    fireEvent.click(screen.getByRole("button", { name: /open history/i }));

    expect(screen.getByText("HISTORY")).toBeVisible();
    expect(screen.getByText(/No local history yet/i)).toBeVisible();
  });

  it("opens a dedicated notation workspace without a duplicate title", async () => {
    installLatexDoMock();

    render(<App />);
    await installExtensionByName("Math Notation Kit");
    await closeSettingsDialog();
    await openProjectFromWelcome();

    fireEvent.click(screen.getByTitle("Notation Manager"));

    expect(screen.getAllByText("Notation Manager")).toHaveLength(1);
    expect(screen.getByText("Detected Notation")).toBeVisible();
    expect(screen.getByRole("region", { name: "Detected notation" })).toBeVisible();
  });

  it("project workflow saves dirty content before sharing and rotates the token", async () => {
    const api = installLatexDoMock();
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    render(<App />);
    await openProjectFromWelcome();
    fireEvent.change(await screen.findByLabelText("mock editor"), {
      target: { value: "Unsaved paper" },
    });
    fireEvent.click(screen.getAllByTitle("Share project")[0]);
    await waitFor(() =>
      expect(api.createCollaborationLink).toHaveBeenCalledWith(project.id),
    );
    expect(api.writeFile).toHaveBeenCalledWith(project.id, "main.tex", "Unsaved paper");
    expect(api.writeFile.mock.invocationCallOrder.at(-1)).toBeLessThan(
      api.createCollaborationLink.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(copy).toHaveBeenCalledWith("share-token"));
    fireEvent.change(screen.getByLabelText("Collaboration display name"), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Collaboration token")).toHaveValue("new-token"),
    );
    expect(copy).toHaveBeenCalledWith("new-token");
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Share Project" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    expect(
      screen.queryByRole("dialog", { name: "Share Project" }),
    ).not.toBeInTheDocument();
  });
  it("project workflow joins from the welcome screen and reports invalid tokens", async () => {
    const api = installLatexDoMock();
    api.joinCollaboration.mockRejectedValueOnce(new Error("Link expired"));
    render(<App />);
    fireEvent.click(screen.getByTitle("Join shared project"));
    fireEvent.change(screen.getByLabelText("Join collaboration token"), {
      target: { value: " expired " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await screen.findByText("Link expired", { selector: ".share-error" });
    fireEvent.change(screen.getByLabelText("Join collaboration token"), {
      target: { value: "good-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() =>
      expect(api.joinCollaboration).toHaveBeenLastCalledWith("good-token"),
    );
    await screen.findByText("Joined shared project", { selector: ".status-message" });
    expect(
      screen.queryByRole("dialog", { name: "Share Project" }),
    ).not.toBeInTheDocument();
  });
  it("project workflow reports a sharing failure without losing unsaved source", async () => {
    const api = installLatexDoMock();
    api.createCollaborationLink.mockRejectedValue(new Error("Sharing unavailable"));
    render(<App />);
    await openProjectFromWelcome();
    fireEvent.change(await screen.findByLabelText("mock editor"), {
      target: { value: "Retain me" },
    });
    fireEvent.click(screen.getAllByTitle("Share project")[0]);
    await screen.findByText("Sharing unavailable", { selector: ".status-message" });
    expect(screen.getByLabelText("mock editor")).toHaveValue("Retain me");
  });
  it.each(["file", "folder"] as const)(
    "project workflow creates a %s inside the selected directory",
    async (type) => {
      const api = installLatexDoMock();
      const folder: ProjectEntry = {
        name: "sections",
        path: "/Users/omar/project/sections",
        relativePath: "sections",
        type: "directory",
        children: [],
      };
      const created: ProjectEntry = {
        name: "new.tex",
        path: "/Users/omar/project/sections/new.tex",
        relativePath: "sections/new.tex",
        type: "file",
      };
      api.listProject.mockResolvedValue([...entries, folder]);
      api.createFile.mockResolvedValue(created.relativePath);
      render(<App />);
      await openProjectFromWelcome();
      fireEvent.click(screen.getByTitle("Actions for sections"));
      fireEvent.click(screen.getByRole("button", { name: `New ${type}` }));
      fireEvent.change(
        screen.getByLabelText(type === "file" ? "File path" : "Folder path"),
        {
          target: { value: type === "file" ? created.relativePath : "sections/nested" },
        },
      );
      api.listProject.mockResolvedValue([
        ...entries,
        { ...folder, children: [created] },
      ]);
      fireEvent.click(screen.getByRole("button", { name: `Create ${type}` }));
      if (type === "file") {
        await waitFor(() =>
          expect(api.createFile).toHaveBeenCalledWith(project.id, created.relativePath),
        );
        await waitFor(() =>
          expect(api.readFile).toHaveBeenCalledWith(project.id, created.relativePath),
        );
      } else
        await waitFor(() =>
          expect(api.createFolder).toHaveBeenCalledWith(project.id, "sections/nested"),
        );
      await waitFor(() =>
        expect(screen.queryByText(`Create new ${type}`)).not.toBeInTheDocument(),
      );
    },
  );
  it("project workflow exposes native creation errors without closing the form", async () => {
    const api = installLatexDoMock();
    const folder: ProjectEntry = {
      name: "sections",
      path: "/Users/omar/project/sections",
      relativePath: "sections",
      type: "directory",
      children: [],
    };
    api.listProject.mockResolvedValue([...entries, folder]);
    api.createFolder.mockRejectedValue(
      new Error("Error invoking remote method 'project:create-folder': Already exists"),
    );
    render(<App />);
    await openProjectFromWelcome();
    fireEvent.click(screen.getByTitle("Actions for sections"));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    await screen.findByText("Already exists");
    expect(screen.getByLabelText("Folder path")).toHaveValue("sections/chapters");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
  it("project workflow imports dropped files once and preserves their destination", async () => {
    const api = installLatexDoMock();
    api.getDroppedFilePaths.mockReturnValue(["/tmp/a.tex", "/tmp/a.tex", ""]);
    api.importExternalFiles.mockResolvedValue([
      { relativePath: "a.tex", path: "/Users/omar/project/a.tex", type: "file" },
    ]);
    const view = render(<App />);
    await openProjectFromWelcome();
    fireEvent.drop(view.container.querySelector(".file-tree-drop-surface")!, {
      dataTransfer: { files: [new File(["text"], "a.tex")], types: ["Files"] },
    });
    await waitFor(() =>
      expect(api.importExternalFiles).toHaveBeenCalledWith(project.id, "", [
        "/tmp/a.tex",
      ]),
    );
    await screen.findByText("Imported a.tex", { selector: ".status-message" });
  });
  it("project workflow reports compilation failures and saves modified text", async () => {
    const api = installLatexDoMock();
    render(<App />);
    await openProjectFromWelcome();
    fireEvent.change(await screen.findByLabelText("mock editor"), {
      target: { value: "new source" },
    });
    api.compile.mockResolvedValue({
      ok: false,
      durationMs: 5,
      output: "compiler log",
      diagnostics: [],
      error: "Compile failed deliberately",
    });
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await screen.findByText("Compile failed deliberately", {
      selector: ".status-message",
    });
    expect(api.writeFile).toHaveBeenCalledWith(project.id, "main.tex", "new source");
    expect(screen.getByText("compiler log")).toBeInTheDocument();
    api.compile.mockRejectedValue(new Error("Compiler crashed"));
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await screen.findByText("Compiler crashed", { selector: ".status-message" });
  });
  it("project workflow cancels compilation and ignores its late result", async () => {
    const api = installLatexDoMock();
    render(<App />);
    await openProjectFromWelcome();
    let finish!: (value: unknown) => void;
    api.compile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await screen.findByRole("button", { name: "Cancel compile" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel compile" }));
    await waitFor(() => expect(api.cancelCompile).toHaveBeenCalledWith(project.id));
    await act(async () =>
      finish({
        ok: false,
        durationMs: 1,
        output: "",
        diagnostics: [],
        error: "Late failure",
      }),
    );
    expect(
      screen.queryByText("Late failure", { selector: ".status-message" }),
    ).not.toBeInTheDocument();
  });

  it("project workflow stages, unstages and commits source-control changes", async () => {
    const api = installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [
          {
            path: "main.tex",
            indexStatus: "modified",
            worktreeStatus: "modified",
            staged: true,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
        ],
      },
    });
    render(<App />);
    await openProjectFromWelcome();
    fireEvent.click(screen.getByTitle("Source control"));
    fireEvent.click(await screen.findByRole("button", { name: "Stage main.tex" }));
    await screen.findByText("Staged main.tex", { selector: ".status-message" });
    expect(api.stageGitFile).toHaveBeenCalledWith(project.id, "main.tex");
    fireEvent.click(screen.getByRole("button", { name: "Unstage main.tex" }));
    await screen.findByText("Unstaged main.tex", { selector: ".status-message" });
    expect(api.unstageGitFile).toHaveBeenCalledWith(project.id, "main.tex");
    fireEvent.click(screen.getByRole("button", { name: "Stage all changes" }));
    await waitFor(() => expect(api.stageAllGit).toHaveBeenCalledWith(project.id));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stage all changes" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unstage all changes" }));
    await waitFor(() => expect(api.unstageAllGit).toHaveBeenCalledWith(project.id));
    fireEvent.change(screen.getByPlaceholderText("Commit message"), {
      target: { value: "Save research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Created commit", { selector: ".status-message" });
    expect(api.commitGit).toHaveBeenCalledWith(project.id, "Save research");
    expect(screen.getByPlaceholderText("Commit message")).toHaveValue("");
    api.commitGit.mockRejectedValueOnce(new Error("Commit rejected"));
    fireEvent.change(screen.getByPlaceholderText("Commit message"), {
      target: { value: "Retry research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText("Commit rejected", { selector: ".status-message" });
    expect(screen.getByPlaceholderText("Commit message")).toHaveValue("Retry research");
  });
  it("project workflow closes an obsolete diff when its file is staged", async () => {
    const api = installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [
          {
            path: "main.tex",
            indexStatus: "unmodified",
            worktreeStatus: "modified",
            staged: false,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
        ],
      },
    });
    render(<App />);
    await openProjectFromWelcome();
    fireEvent.click(screen.getByTitle("Source control"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open working tree diff for main.tex",
      }),
    );
    await screen.findByTestId("mock-diff-editor");
    fireEvent.click(screen.getByRole("button", { name: "Stage main.tex" }));
    await waitFor(() =>
      expect(screen.queryByTestId("mock-diff-editor")).not.toBeInTheDocument(),
    );
    expect(api.stageGitFile).toHaveBeenCalledWith(project.id, "main.tex");
  });
  it("project workflow reveals a Git file and opens its source from the context menu", async () => {
    const api = installLatexDoMock({
      gitStatus: {
        isRepo: true,
        branch: "main",
        entries: [
          {
            path: "main.tex",
            indexStatus: "unmodified",
            worktreeStatus: "modified",
            staged: false,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
        ],
      },
    });
    render(<App />);
    await openProjectFromWelcome();
    fireEvent.click(screen.getByTitle("Source control"));
    const entry = await screen.findByRole("button", {
      name: "Open working tree diff for main.tex",
    });
    fireEvent.contextMenu(entry, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in File Manager" }));
    await waitFor(() =>
      expect(api.revealGitFile).toHaveBeenCalledWith(project.id, "main.tex"),
    );
    fireEvent.contextMenu(entry);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open File History" }));
    await waitFor(() =>
      expect(api.getGitHistory).toHaveBeenCalledWith(project.id, "main.tex"),
    );
    fireEvent.doubleClick(entry);
    expect(await screen.findByLabelText("mock editor")).toBeVisible();
  });

  async function mountEditorIntegration(content: string) {
    editorLifecycle.beforeMount = null;
    editorLifecycle.onMount = null;
    const api = installLatexDoMock();
    api.listProject.mockResolvedValue([
      ...entries,
      {
        name: "refs.bib",
        path: "/Users/omar/project/refs.bib",
        relativePath: "refs.bib",
        type: "file",
      },
    ]);
    api.readFile.mockImplementation(async (_id: string, file: string) =>
      file.endsWith(".bib")
        ? "@article{ada2026,title={Computing},author={Ada Lovelace},year={2026}}"
        : content,
    );
    render(<App />);
    await openProjectFromWelcome();
    await screen.findByLabelText("mock editor");
    await waitFor(() =>
      expect(editorLifecycle.beforeMount).toEqual(expect.any(Function)),
    );
    const harness = createEditorHarness(
      content,
      "/Users/omar/project/main.tex",
      (text) => editorChangeHandlers.get("/Users/omar/project/main.tex")?.(text),
    );
    Reflect.deleteProperty(globalThis, "__latexdoMonacoProviderGeneration");
    await act(async () => {
      editorLifecycle.beforeMount!(harness.instance);
      editorLifecycle.onMount!(harness.editor);
    });
    return { api, ...harness };
  }
  it("editor integration registers real language providers, themes and command actions", async () => {
    const h = await mountEditorIntegration(
      "\\section{Intro}\n\\begin{itemize}\n\\item First\n\\end{itemize}\n\\url{https://latexdo.org}\n",
    );
    expect(h.instance.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: "latex" }),
    );
    expect(h.instance.editor.defineTheme.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(h.actions.has("latexdo.continueLatexList")).toBe(true);
    const folds = h.providers
      .get("latex:FoldingRange")![0]
      .provideFoldingRanges(h.model);
    expect(folds).toEqual(
      expect.arrayContaining([expect.objectContaining({ start: 2, end: 4 })]),
    );
    const links = h.providers.get("latex:Link")![0].provideLinks(h.model).links;
    expect(links[0].url).toBe("https://latexdo.org");
    h.select(h.model.getValue().indexOf("https") + 3);
    await act(async () => {
      await h.run("latexdo.openLinkAtCursor");
    });
    expect(h.api.openExternalUrl).toHaveBeenCalledWith("https://latexdo.org");
    await act(async () => {
      h.run("latexdo.showCompletionDetails");
      h.run("latexdo.hideCompletionDetails");
    });
    expect(h.editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "toggleSuggestionDetails",
      null,
    );
  });
  it("editor integration previews inline graphics, caches bytes and handles missing or PDF figures", async () => {
    const h = await mountEditorIntegration("\\includegraphics{figures/plot.png}");
    h.api.fileExists.mockResolvedValue(true);
    h.api.readAsset.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const provider = h.providers.get("latex:Hover")![1];
    let hover = await provider.provideHover(h.model, { lineNumber: 1, column: 22 });
    expect(hover.contents[0].value).toContain("data:image/png;base64,");
    expect(hover.contents[0].value).toContain("figures/plot.png");
    const count = h.api.readAsset.mock.calls.length;
    await provider.provideHover(h.model, { lineNumber: 1, column: 22 });
    expect(h.api.readAsset).toHaveBeenCalledTimes(count);
    h.setText("\\includegraphics{figures/chart.pdf}");
    hover = await provider.provideHover(h.model, { lineNumber: 1, column: 22 });
    expect(hover.contents[0].value).toContain(
      "PDF figures preview in the compiled PDF",
    );
    h.setText("\\includegraphics{missing}");
    h.api.fileExists.mockResolvedValue(false);
    hover = await provider.provideHover(h.model, { lineNumber: 1, column: 20 });
    expect(hover.contents[0].value).toContain("Figure not found");
    h.setText("plain prose");
    expect(
      await provider.provideHover(h.model, { lineNumber: 1, column: 4 }),
    ).toBeNull();
  });
  it("editor integration renders equation hovers and never interprets ordinary prose as mathematics", async () => {
    const h = await mountEditorIntegration("A formula $x^2+y^2$ in prose.");
    const provider = h.providers.get("latex:Hover")![1];
    const hover = await provider.provideHover(h.model, { lineNumber: 1, column: 14 });
    expect(hover.contents[0].value).toContain("![equation](data:image/svg+xml");
    expect(
      await provider.provideHover(h.model, { lineNumber: 1, column: 2 }),
    ).toBeNull();
  });
  it("editor integration hides complete LaTeX commands and comments when raw mode is disabled", async () => {
    storeAcceptedSettings({ showRawLatex: false });
    const h = await mountEditorIntegration(
      "Text \\section[Short [title]]{Long {title}}\n% comment\n\\textbf{multi\nline}",
    );
    // Trigger a document update after the editor boundary is mounted.
    await act(async () =>
      editorChangeHandlers.get("/Users/omar/project/main.tex")!(
        h.model.getValue() + "\n",
      ),
    );
    await waitFor(() =>
      expect(
        h.editor.deltaDecorations.mock.calls.some((call: any[]) =>
          call[1].some(
            (d: any) => d.options.inlineClassName === "latex-command-hidden",
          ),
        ),
      ).toBe(true),
    );
    const hidden = h.editor.deltaDecorations.mock.calls
      .flatMap((call: any[]) => call[1])
      .filter((d: any) => d.options.inlineClassName === "latex-command-hidden");
    expect(
      hidden.some(
        (d: any) => d.range.startLineNumber === 2 && d.range.endColumn === 10,
      ),
    ).toBe(true);
    expect(
      hidden.some(
        (d: any) => d.range.startLineNumber === 3 && d.range.endLineNumber === 4,
      ),
    ).toBe(true);
  });
  it("editor integration handles cursor, selection and model-change events and AI prerequisites", async () => {
    const h = await mountEditorIntegration("ordinary text");
    await act(async () => {
      h.listeners.get("onDidChangeCursorPosition")!({
        position: { lineNumber: 1, column: 3 },
      });
      h.listeners.get("onDidChangeCursorSelection")!({
        selection: new h.Selection(1, 1, 1, 4),
      });
      h.listeners.get("onDidChangeModelContent")!();
      h.listeners.get("onDidChangeModel")!();
      h.run("latexdo.ai.reformulateSelection");
    });
    expect(screen.getByText("Select text to reformulate.")).toBeVisible();
    h.select(0, 8);
    await act(async () => h.run("latexdo.ai.reformulateSelection"));
    expect(
      screen.getByText(
        "AI is not configured. Open AI settings and choose a provider first.",
      ),
    ).toBeVisible();
    await act(async () => h.run("latexdo.ai.askAboutSelection"));
    expect(screen.getByText("ordinary", { exact: false })).toBeVisible();
  });
  it("editor integration produces command, reference and citation completions and suppresses stale requests", async () => {
    const h = await mountEditorIntegration(
      "\\label{sec:intro}\n\\ref{sec:\n\\cite{ada\n\\sec",
    );
    const provider = h.providers.get("latex:CompletionItem")![0];
    const token = { isCancellationRequested: false };
    h.select(h.model.getValue().length);
    const commands = await provider.provideCompletionItems(
      h.model,
      h.editor.getPosition(),
      {},
      token,
    );
    expect(commands.suggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "\\section" })]),
    );
    h.select(h.model.getValue().indexOf("\\cite") - 1);
    const refs = await provider.provideCompletionItems(
      h.model,
      h.editor.getPosition(),
      {},
      token,
    );
    expect(refs.suggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "sec:intro" })]),
    );
    h.select(
      h.model.getValue().indexOf("\\sec", h.model.getValue().indexOf("\\cite")) - 1,
    );
    const cites = await provider.provideCompletionItems(
      h.model,
      h.editor.getPosition(),
      {},
      token,
    );
    expect(cites.suggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ insertText: "ada2026" })]),
    );
    expect(
      (
        await provider.provideCompletionItems(
          h.model,
          h.editor.getPosition(),
          {},
          { isCancellationRequested: true },
        )
      ).suggestions,
    ).toEqual([]);
    const asymptote = h.providers
      .get("asymptote:CompletionItem")![0]
      .provideCompletionItems(h.model, { lineNumber: 1, column: 2 });
    expect(asymptote.suggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "draw" })]),
    );
  });
  it("editor integration continues LaTeX lists and falls back to ordinary newline outside lists", async () => {
    const content = "\\begin{itemize}\n\\item First\n\\end{itemize}";
    const h = await mountEditorIntegration(content);
    h.select(content.indexOf("First") + 5);
    await act(async () => {
      h.run("latexdo.continueLatexList");
    });
    expect(h.model.getValue()).toContain("\\item First\n\\item ");
    expect(h.editor.executeEdits).toHaveBeenCalledWith(
      "latex-list-enter",
      expect.any(Array),
    );
    h.setText("ordinary text");
    h.select(3);
    await act(async () => {
      h.run("latexdo.continueLatexList");
    });
    expect(h.editor.trigger).toHaveBeenCalledWith("keyboard", "type", { text: "\n" });
    h.select(0, 4);
    await act(async () => {
      h.run("latexdo.continueLatexList");
    });
    expect(h.editor.trigger).toHaveBeenCalledTimes(2);
  });
  it("editor integration persists bookmarks and navigates to their source lines", async () => {
    const h = await mountEditorIntegration("First\nSecond\nThird");
    h.select(6);
    await act(async () => {
      h.run("latexdo.toggleBookmark");
    });
    expect(screen.getByText("Bookmarked line 2")).toBeVisible();
    const saved = JSON.parse(localStorage.getItem(bookmarksStorageKey) ?? "{}");
    expect(Object.values(saved)).toContainEqual([2]);
    h.select(0);
    await act(async () => {
      h.run("latexdo.nextBookmark");
    });
    expect(h.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 1 });
    expect(h.editor.revealLineInCenter).toHaveBeenCalledWith(2, 1);
  });
  it("editor integration formats tables through the registered editor action", async () => {
    const content = "\\begin{tabular}{ll}\na&long\\\\\nlong&b\\\\\n\\end{tabular}";
    const h = await mountEditorIntegration(content);
    h.select(content.indexOf("a&"));
    await act(async () => {
      h.run("latexdo.formatLatexTable");
    });
    expect(h.model.getValue()).toContain("a    & long");
    expect(screen.getByText("Formatted LaTeX table columns.")).toBeVisible();
  });
  it.each([
    ["Bold", "\\textbf{passage}"],
    ["Italic", "\\emph{passage}"],
    ["Underline", "\\underline{passage}"],
    ["Inline math", "$passage$"],
    ["Section", "\\section{passage}"],
    ["Subsection", "\\subsection{passage}"],
    ["Equation", "\\begin{equation}\npassage\n\\end{equation}"],
    ["Bullet list", "\\begin{itemize}"],
    ["Numbered list", "\\begin{enumerate}"],
    ["Cite", "\\cite{passage}"],
    ["Ref", "\\ref{passage}"],
    ["Link", "\\href{url}{passage}"],
  ])("editor integration applies %s to the selected text", async (label, expected) => {
    const h = await mountEditorIntegration("A passage here.");
    h.select(2, 9);
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "LaTeX formatting" })).getByRole(
        "button",
        { name: label },
      ),
    );
    expect(h.model.getValue()).toContain(expected);
    expect(h.model.getValue()).toMatch(/^A /);
    expect(h.model.getValue()).toMatch(/ here\.$/);
  });
  it("editor integration creates a review thread, saves comments, inserts it into TeX and removes it", async () => {
    const h = await mountEditorIntegration("A passage to review.");
    h.select(2, 9);
    fireEvent.click(screen.getByTitle("Reviewer Mode"));
    fireEvent.click(
      screen.getByRole("button", { name: /new.*thread|new.*conversation|add.*chat/i }),
    );
    expect(screen.getByTitle("Click to jump to selection")).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("Write a review message..."), {
      target: { value: "Please clarify this claim." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send review message" }));
    expect(await screen.findByText("Please clarify this claim.")).toBeVisible();
    await waitFor(() =>
      expect(h.api.writeFile).toHaveBeenCalledWith(
        project.id,
        ".latexdo/review_data.json",
        expect.stringContaining("Please clarify this claim."),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /insert.*tex/i }));
    expect(h.model.getValue()).toContain("Please clarify this claim.");
    fireEvent.click(screen.getByTitle("Delete review chat"));
    await waitFor(() =>
      expect(screen.queryByText("Please clarify this claim.")).not.toBeInTheDocument(),
    );
    expect(h.model.getValue()).not.toContain("Please clarify this claim.");
  });
  it("editor integration builds and edits rebuttal items and writes a response letter", async () => {
    const h = await mountEditorIntegration("A disputed passage.");
    h.select(2, 10);
    fireEvent.click(screen.getByTitle("Rebuttal Mode"));
    fireEvent.click(screen.getByRole("button", { name: "New Rebuttal Item" }));
    fireEvent.change(screen.getByPlaceholderText("What did the reviewer say?"), {
      target: { value: "Explain the method." },
    });
    fireEvent.change(screen.getByPlaceholderText("How do you respond?"), {
      target: { value: "We added an explanation." },
    });
    fireEvent.change(
      screen.getByPlaceholderText("The manuscript text being discussed."),
      { target: { value: "Old method" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("The revised manuscript text or a unified diff."),
      { target: { value: "Detailed method" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Export Response" }));
    await waitFor(() =>
      expect(h.api.writeFile).toHaveBeenCalledWith(
        project.id,
        "rebuttal-letter.tex",
        expect.stringContaining("We added an explanation."),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete rebuttal item" }));
    expect(screen.queryByDisplayValue("Explain the method.")).not.toBeInTheDocument();
  });
  it("editor integration captures local history and restores an older state without overwriting disk", async () => {
    const h = await mountEditorIntegration("Original passage.");
    fireEvent.click(screen.getByRole("button", { name: /open history/i }));
    fireEvent.click(screen.getByRole("button", { name: "Capture state" }));
    await waitFor(() =>
      expect(screen.queryByText(/No local history yet/i)).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("mock editor"), {
      target: { value: "Edited passage." },
    });
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() =>
      expect(screen.getByLabelText("mock editor")).toHaveValue("Original passage."),
    );
    expect(screen.getByText(/Restored main.tex from history/)).toBeVisible();
    expect(
      h.api.writeFile.mock.calls.filter(([, file]) => file === "main.tex"),
    ).toEqual([]);
  });
});
