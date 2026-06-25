import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  GitStatusSummary,
  OpenProject,
  ProjectEntry,
  ProofreadingSettings,
  SpellCheckerSettings,
  UpdateCheckResult,
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
  default: () => <div data-testid="mock-pdf-preview" />,
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

function installLatexDoMock(options?: {
  gitStatus?: GitStatusSummary;
  proofreadingSettings?: ProofreadingSettings;
}) {
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
    getGitEditorDiff: vi.fn().mockResolvedValue({
      path: "main.tex",
      original: "old",
      modified: "new",
    }),
    getGitHistory: vi.fn().mockResolvedValue({
      scope: "repo",
      target: null,
      commits: [],
    }),
    getGitCommitDetails: vi.fn().mockResolvedValue({
      hash: "abcdef1",
      summary: "Commit",
      body: "Commit body",
    }),
    getGitCommitFileDiff: vi.fn().mockResolvedValue({
      path: "main.tex",
      original: "old",
      modified: "new",
    }),
    checkForUpdates: vi.fn().mockResolvedValue(defaultUpdateResult),
    openReleasesPage: vi.fn().mockResolvedValue(undefined),
    getSpellCheckerSettings: vi.fn().mockResolvedValue(defaultSpellCheckerSettings),
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
      durationMs: 12,
      output: "",
      diagnostics: [],
    }),
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
            indexStatus: "M",
            workingTreeStatus: "",
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
            indexStatus: "",
            workingTreeStatus: "M",
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
    expect(await screen.findByText("Discard canceled.")).toBeVisible();

    const discardAll = screen.getByRole("button", {
      name: /discard all unstaged changes/i,
    });
    expect(discardAll).toBeEnabled();
    fireEvent.click(discardAll);

    await waitFor(() => {
      expect(api.discardAllGit).toHaveBeenCalledWith("project-1");
    });
  });
});
