import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fallbackExtensionCatalog } from "./extensions";
import type {
  GitDiffSession,
  GitGraphCommit,
  GitStatusSummary,
  OpenProject,
  ProjectEntry,
  ProofreadingSettings,
  SpellCheckerSettings,
  UpdateCheckResult,
  UpdateInstallResult,
} from "./types";

vi.mock("@monaco-editor/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange?: (value: string) => void;
    }) =>
      React.createElement("textarea", {
        "aria-label": "mock editor",
        value: value ?? "",
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange?.(event.currentTarget.value),
      }),
    DiffEditor: () =>
      React.createElement("div", {
        "data-testid": "mock-diff-editor",
      }),
    loader: {
      config: vi.fn(),
    },
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
    openReleasesPage: vi.fn().mockResolvedValue(undefined),
    getSpellCheckerSettings: vi.fn().mockResolvedValue(defaultSpellCheckerSettings),
    fetchExtensionCatalog: vi.fn().mockResolvedValue(fallbackExtensionCatalog),
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
    onImportDocxMenu: vi.fn(() => vi.fn()),
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

describe("App critical UI controls", () => {
  beforeEach(() => {
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

  it("closes settings and citation manager with Escape", async () => {
    installLatexDoMock();

    render(<App />);

    fireEvent.click(screen.getByLabelText(/open settings/i));
    expect(screen.getByRole("dialog", { name: /settings/i })).toBeVisible();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /settings/i }),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Citation Manager"));
    expect(await screen.findByText("Project Bibliography")).toBeVisible();

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
    await openProjectFromWelcome();

    fireEvent.click(screen.getByTitle("Notation Manager"));

    expect(screen.getAllByText("Notation Manager")).toHaveLength(1);
    expect(screen.getByText("Detected Notation")).toBeVisible();
    expect(screen.getByRole("region", { name: "Detected notation" })).toBeVisible();
  });
});
