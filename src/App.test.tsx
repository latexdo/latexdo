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
import { fallbackExtensionCatalog, type LatexDoExtensionCatalog } from "./extensions";
import {
  defaultSettings,
  installedExtensionsStorageKey,
  settingsStorageKey,
} from "./features/settings/settings";
import type {
  GitDiffSession,
  GitGraphCommit,
  GitStatusSummary,
  OpenProject,
  ProjectEntry,
  ProofreadingSettings,
  SpellCheckerSettings,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateInstallResult,
} from "./types";

const editorChangeHandlers = vi.hoisted(
  () => new Map<string, (value: string) => void>(),
);

vi.mock("@monaco-editor/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      defaultValue,
      value,
      onChange,
      path,
    }: {
      defaultValue?: string;
      value?: string;
      onChange?: (value: string) => void;
      path?: string;
    }) => {
      if (path) {
        editorChangeHandlers.set(path, (nextValue) => onChange?.(nextValue));
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
    }: {
      defaultValue?: string;
      value?: string;
      onChange?: (value: string) => void;
      path?: string;
    }) => {
      if (path) {
        editorChangeHandlers.set(path, (nextValue) => onChange?.(nextValue));
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
    onNavigate,
  }: {
    onNavigate: (location: {
      page: number;
      x: number;
      y: number;
      word?: string;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-pdf-preview"
      onDoubleClick={() => onNavigate({ page: 2, x: 42, y: 84, word: "Text" })}
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

const entries: ProjectEntry[] = [
  {
    name: "main.tex",
    path: "/Users/omar/project/main.tex",
    relativePath: "main.tex",
    type: "file",
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
    openProject: vi.fn().mockResolvedValue(project),
    createProject: vi.fn().mockResolvedValue(project),
    listProject: vi.fn().mockResolvedValue(entries),
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
    moveEntry: vi.fn().mockResolvedValue("main.tex"),
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
    onUpdateProgress: vi.fn((_callback: (progress: UpdateDownloadProgress) => void) =>
      vi.fn(),
    ),
    openReleasesPage: vi.fn().mockResolvedValue(undefined),
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
    expect(screen.getByText("Ready")).toBeVisible();
  });
}

async function installExtensionByName(name: string) {
  fireEvent.click(screen.getByTitle("Extension Store"));
  const card = (await screen.findByText(name)).closest("article");
  expect(card).not.toBeNull();
  fireEvent.click(
    within(card as HTMLElement).getByRole("button", { name: /install/i }),
  );
}

async function closeSettingsDialog() {
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: /settings/i })).not.toBeInTheDocument();
  });
}

describe("App critical UI controls", () => {
  beforeEach(() => {
    editorChangeHandlers.clear();
    window.localStorage.clear();
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

  it("keeps optional workbench tools hidden until their extensions are installed", async () => {
    installLatexDoMock();

    render(<App />);

    expect(screen.queryByTitle("Citation Manager")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Table Generator")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Figure → TikZ Converter")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Notation Manager")).not.toBeInTheDocument();

    await installExtensionByName("Citation Workbench");
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

    fireEvent.click(screen.getByTitle("Extension Store"));
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
      JSON.stringify({
        ...defaultSettings,
        citationAssistantEnabled: false,
        projectBibliographyEnabled: false,
      }),
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
});
