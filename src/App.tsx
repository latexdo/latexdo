import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import {
  AlertCircle,
  Blocks,
  BookOpenText,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Code2,
  Command,
  ExternalLink,
  FilePlus2,
  Files,
  FolderPlus,
  FolderOpen,
  GitBranch,
  House,
  LoaderCircle,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  TerminalSquare,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import FileTree from "./FileTree";
import { monaco } from "./monaco";
import type {
  CompileResult,
  Diagnostic,
  Engine,
  OpenDocument,
  ProjectEntry,
} from "./types";

interface AppSettings {
  defaultEngine: Engine;
  editorFontSize: number;
  wordWrap: boolean;
  minimap: boolean;
}

const settingsStorageKey = "latexdo.settings";
const defaultSettings: AppSettings = {
  defaultEngine: "pdflatex",
  editorFontSize: 13.5,
  wordWrap: true,
  minimap: true,
};

function loadSettings(): AppSettings {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(settingsStorageKey) ?? "{}",
    ) as Partial<AppSettings>;
    const defaultEngine =
      saved.defaultEngine === "xelatex" || saved.defaultEngine === "lualatex"
        ? saved.defaultEngine
        : "pdflatex";

    return {
      defaultEngine,
      editorFontSize:
        typeof saved.editorFontSize === "number" &&
        saved.editorFontSize >= 11 &&
        saved.editorFontSize <= 22
          ? saved.editorFontSize
          : defaultSettings.editorFontSize,
      wordWrap:
        typeof saved.wordWrap === "boolean"
          ? saved.wordWrap
          : defaultSettings.wordWrap,
      minimap:
        typeof saved.minimap === "boolean"
          ? saved.minimap
          : defaultSettings.minimap,
    };
  } catch {
    return defaultSettings;
  }
}

const supportedExtensions = new Set([
  "tex",
  "bib",
  "sty",
  "cls",
  "txt",
  "md",
  "json",
]);

const latexSuggestions = [
  ["section", "\\section{${1:title}}"],
  ["subsection", "\\subsection{${1:title}}"],
  ["begin", "\\begin{${1:environment}}\n\t${0}\n\\end{${1:environment}}"],
  ["figure", "\\begin{figure}[ht]\n\t\\centering\n\t\\includegraphics[width=${1:0.8}\\textwidth]{${2:file}}\n\t\\caption{${3:caption}}\n\t\\label{fig:${4:label}}\n\\end{figure}"],
  ["table", "\\begin{table}[ht]\n\t\\centering\n\t\\begin{tabular}{${1:cc}}\n\t\t${0}\n\t\\end{tabular}\n\t\\caption{${2:caption}}\n\\end{table}"],
  ["equation", "\\begin{equation}\n\t${0}\n\\end{equation}"],
  ["itemize", "\\begin{itemize}\n\t\\item ${0}\n\\end{itemize}"],
  ["enumerate", "\\begin{enumerate}\n\t\\item ${0}\n\\end{enumerate}"],
  ["cite", "\\cite{${1:key}}"],
  ["ref", "\\ref{${1:label}}"],
  ["label", "\\label{${1:label}}"],
  ["includegraphics", "\\includegraphics[width=${1:\\textwidth}]{${2:file}}"],
] as const;

function fileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function languageFor(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "tex" || extension === "sty" || extension === "cls") {
    return "latex";
  }
  if (extension === "bib") {
    return "bibtex";
  }
  if (extension === "json") {
    return "json";
  }
  if (extension === "md") {
    return "markdown";
  }
  return "plaintext";
}

function flattenEntries(entries: ProjectEntry[]): ProjectEntry[] {
  return entries.flatMap((entry) => [
    entry,
    ...(entry.children ? flattenEntries(entry.children) : []),
  ]);
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`;
}

export default function App() {
  const [projectPath, setProjectPath] = useState("");
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>([]);
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activePath, setActivePath] = useState("");
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [createDialog, setCreateDialog] = useState<"file" | "folder" | null>(
    null,
  );
  const [createPath, setCreatePath] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [engine, setEngine] = useState<Engine>(settings.defaultEngine);
  const [rootFile, setRootFile] = useState("main.tex");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [panelVisible, setPanelVisible] = useState(false);
  const [activePanel, setActivePanel] = useState<"problems" | "output">(
    "problems",
  );
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Opening workspace…");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfScale, setPdfScale] = useState(100);
  const [splitPercent, setSplitPercent] = useState(52);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const documentsRef = useRef<OpenDocument[]>([]);
  const projectPathRef = useRef("");
  const rootFileRef = useRef(rootFile);
  const engineRef = useRef(engine);
  const pdfUrlRef = useRef("");

  const activeDocument = documents.find(
    (document) => document.path === activePath,
  );
  const showWelcome = welcomeOpen && !activePath;
  const previewShown = previewVisible && !showWelcome;
  const projectName = fileName(projectPath) || "LatexDo";
  const diagnostics = compileResult?.diagnostics ?? [];
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const texFiles = useMemo(
    () =>
      flattenEntries(projectEntries).filter(
        (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
      ),
    [projectEntries],
  );

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

  useEffect(() => {
    rootFileRef.current = rootFile;
  }, [rootFile]);

  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  useEffect(() => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }, [settings]);

  const refreshProject = useCallback(async (path = projectPathRef.current) => {
    if (!path) {
      return [];
    }
    const entries = await window.latexdo.listProject(path);
    setProjectEntries(entries);
    return entries;
  }, []);

  const openDocument = useCallback(
    async (entry: ProjectEntry, targetProject = projectPathRef.current) => {
      if (entry.type !== "file") {
        return;
      }

      const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!supportedExtensions.has(extension)) {
        setStatusMessage(`${entry.name} is not an editable text file`);
        return;
      }

      const existing = documentsRef.current.find(
        (document) => document.path === entry.path,
      );
      if (existing) {
        setActivePath(entry.path);
        return;
      }

      const content = await window.latexdo.readFile(targetProject, entry.path);
      const document: OpenDocument = {
        path: entry.path,
        relativePath: entry.relativePath,
        name: entry.name,
        content,
        savedContent: content,
      };
      setDocuments((current) => [...current, document]);
      setActivePath(entry.path);
      setStatusMessage(`Opened ${entry.relativePath}`);
    },
    [],
  );

  const loadProject = useCallback(
    async (path: string, openFirstDocument = false) => {
      setStatusMessage("Loading project…");
      setProjectPath(path);
      projectPathRef.current = path;
      setDocuments([]);
      documentsRef.current = [];
      setActivePath("");
      setWelcomeOpen(true);
      setCompileResult(null);

      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = "";
        setPdfUrl("");
      }

      const entries = await window.latexdo.listProject(path);
      setProjectEntries(entries);
      const allFiles = flattenEntries(entries);
      const main =
        allFiles.find(
          (entry) => entry.type === "file" && entry.relativePath === "main.tex",
        ) ??
        allFiles.find(
          (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
        );

      if (main) {
        setRootFile(main.relativePath);
        rootFileRef.current = main.relativePath;
        if (openFirstDocument) {
          await openDocument(main, path);
        }
      }
      setStatusMessage("Ready");
    },
    [openDocument],
  );

  useEffect(() => {
    void window.latexdo
      .getWelcomeProject()
      .then((path) => loadProject(path, false))
      .catch((error: unknown) => {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not open workspace",
        );
      });

    return () => {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
      }
    };
  }, [loadProject]);

  const saveDocument = useCallback(
    async (document: OpenDocument) => {
      const currentProject = projectPathRef.current;
      if (!currentProject) {
        return;
      }
      await window.latexdo.writeFile(
        currentProject,
        document.path,
        document.content,
      );
      setDocuments((current) =>
        current.map((item) =>
          item.path === document.path
            ? { ...item, savedContent: item.content }
            : item,
        ),
      );
      setStatusMessage(`Saved ${document.relativePath}`);
    },
    [],
  );

  const saveActive = useCallback(async () => {
    const document = documentsRef.current.find(
      (item) => item.path === activePath,
    );
    if (document) {
      await saveDocument(document);
    }
  }, [activePath, saveDocument]);

  const compile = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject || compiling) {
      return;
    }

    setCompiling(true);
    setStatusMessage(`Compiling ${rootFileRef.current}…`);
    try {
      const dirtyDocuments = documentsRef.current.filter(
        (document) => document.content !== document.savedContent,
      );
      await Promise.all(
        dirtyDocuments.map((document) =>
          window.latexdo.writeFile(
            currentProject,
            document.path,
            document.content,
          ),
        ),
      );
      if (dirtyDocuments.length) {
        setDocuments((current) =>
          current.map((document) => ({
            ...document,
            savedContent: document.content,
          })),
        );
      }

      const result = await window.latexdo.compile({
        projectPath: currentProject,
        rootFile: rootFileRef.current,
        engine: engineRef.current,
      });
      setCompileResult(result);

      if (result.ok && result.pdfPath) {
        const bytes = await window.latexdo.readPdf(
          currentProject,
          result.pdfPath,
        );
        const pdfBytes = new Uint8Array(bytes);
        const nextUrl = URL.createObjectURL(
          new Blob([pdfBytes], { type: "application/pdf" }),
        );
        if (pdfUrlRef.current) {
          URL.revokeObjectURL(pdfUrlRef.current);
        }
        pdfUrlRef.current = nextUrl;
        setPdfUrl(nextUrl);
        setPreviewVisible(true);
        setStatusMessage(`Built successfully in ${formatDuration(result.durationMs)}`);
      } else {
        setPanelVisible(true);
        setActivePanel(result.diagnostics.length ? "problems" : "output");
        setStatusMessage(result.error ?? "Compilation failed");
      }
    } catch (error) {
      setPanelVisible(true);
      setActivePanel("output");
      setStatusMessage(
        error instanceof Error ? error.message : "Compilation failed",
      );
    } finally {
      setCompiling(false);
    }
  }, [compiling]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActive();
      }
      if (modifier && event.key === "Enter") {
        event.preventDefault();
        void compile();
      }
      if (modifier && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarVisible((visible) => !visible);
      }
      if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreatePath("chapter.tex");
        setCreateError("");
        setCreateDialog("file");
      }
      if (event.key === "Escape") {
        setCreateDialog(null);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [compile, saveActive]);

  useEffect(() => {
    if (!activeDocument || !editorRef.current) {
      return;
    }
    const relevantDiagnostics = diagnostics.filter(
      (diagnostic) =>
        !diagnostic.file ||
        diagnostic.file === activeDocument.relativePath ||
        fileName(diagnostic.file) === activeDocument.name,
    );
    monaco.editor.setModelMarkers(
      editorRef.current.getModel()!,
      "latexdo",
      relevantDiagnostics.map((diagnostic) => ({
        startLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endLineNumber: diagnostic.line,
        endColumn: diagnostic.column + 1,
        message: diagnostic.message,
        severity:
          diagnostic.severity === "error"
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
      })),
    );
  }, [activeDocument, diagnostics]);

  const configureMonaco: BeforeMount = (instance) => {
    if (!instance.languages.getLanguages().some(({ id }) => id === "latex")) {
      instance.languages.register({
        id: "latex",
        extensions: [".tex", ".sty", ".cls"],
      });
    }
    if (!instance.languages.getLanguages().some(({ id }) => id === "bibtex")) {
      instance.languages.register({ id: "bibtex", extensions: [".bib"] });
    }

    instance.languages.setMonarchTokensProvider("latex", {
      tokenizer: {
        root: [
          [/%.*$/, "comment"],
          [/\\(?:begin|end)(?=\{)/, "keyword.control"],
          [/\\[a-zA-Z@]+|\\./, "keyword"],
          [/\$[^$]*\$/, "string"],
          [/[{}[\]]/, "delimiter"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
        ],
      },
    });
    instance.languages.setLanguageConfiguration("latex", {
      comments: { lineComment: "%" },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: "$", close: "$" },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "$", close: "$" },
      ],
    });
    instance.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["\\"],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: latexSuggestions.map(([label, insertText]) => ({
            label: `\\${label}`,
            kind: instance.languages.CompletionItemKind.Snippet,
            insertText,
            insertTextRules:
              instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: "LaTeX snippet",
          })),
        };
      },
    });
    instance.editor.defineTheme("latexdo-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6B7280", fontStyle: "italic" },
        { token: "keyword", foreground: "7CA6FF" },
        { token: "keyword.control", foreground: "C099FF" },
        { token: "string", foreground: "8FCB9B" },
        { token: "number", foreground: "E5A66E" },
        { token: "delimiter", foreground: "D5DAE3" },
      ],
      colors: {
        "editor.background": "#15181e",
        "editor.foreground": "#d7dce5",
        "editorLineNumber.foreground": "#4f5663",
        "editorLineNumber.activeForeground": "#aeb5c1",
        "editor.lineHighlightBackground": "#1b1f27",
        "editorCursor.foreground": "#7ca6ff",
        "editor.selectionBackground": "#31538c88",
        "editor.inactiveSelectionBackground": "#283d5f88",
        "editorIndentGuide.background1": "#252a34",
        "editorIndentGuide.activeBackground1": "#3b4352",
      },
    });
  };

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.focus();
  };

  const openProject = async () => {
    const path = await window.latexdo.openProject();
    if (path) {
      await loadProject(path, false);
    }
  };

  const createProject = async () => {
    try {
      const path = await window.latexdo.createProject();
      if (path) {
        await loadProject(path, true);
        setStatusMessage("Project created");
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not create project",
      );
    }
  };

  const openCreateDialog = (type: "file" | "folder") => {
    setCreatePath(type === "file" ? "chapter.tex" : "chapters");
    setCreateError("");
    setCreateDialog(type);
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const relativePath = createPath.trim();
    if (!projectPath || !createDialog || !relativePath) {
      setCreateError("Enter a name or path.");
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      if (createDialog === "file") {
        const path = await window.latexdo.createFile(projectPath, relativePath);
        const entries = await refreshProject(projectPath);
        const entry = flattenEntries(entries).find((item) => item.path === path);
        if (!entry) {
          throw new Error("The file was created but could not be opened.");
        }
        await openDocument(entry);
        setStatusMessage(`Created ${relativePath}`);
      } else {
        await window.latexdo.createFolder(projectPath, relativePath);
        await refreshProject(projectPath);
        setStatusMessage(`Created folder ${relativePath}`);
      }
      setCreateDialog(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Could not create ${createDialog}`;
      setCreateError(message.replace(/^Error invoking remote method '[^']+': /, ""));
    } finally {
      setCreating(false);
    }
  };

  const closeDocument = (path: string) => {
    const target = documents.find((document) => document.path === path);
    if (
      target &&
      target.content !== target.savedContent &&
      !window.confirm(`Close ${target.name} without saving?`)
    ) {
      return;
    }
    const index = documents.findIndex((document) => document.path === path);
    const nextDocuments = documents.filter((document) => document.path !== path);
    setDocuments(nextDocuments);
    if (activePath === path) {
      const nextPath =
        nextDocuments[Math.min(index, nextDocuments.length - 1)]?.path ?? "";
      setActivePath(nextPath);
    }
  };

  const showWelcomePage = () => {
    setWelcomeOpen(true);
    setActivePath("");
    setStatusMessage("Welcome to LatexDo");
  };

  const toggleSidebar = () => {
    setSidebarVisible((visible) => !visible);
  };

  const togglePanel = () => {
    setPanelVisible((visible) => !visible);
  };

  const togglePreview = async () => {
    if (previewShown) {
      setPreviewVisible(false);
      return;
    }

    setPreviewVisible(true);
    if (!showWelcome) {
      return;
    }

    const rootEntry =
      flattenEntries(projectEntries).find(
        (entry) =>
          entry.type === "file" && entry.relativePath === rootFileRef.current,
      ) ??
      flattenEntries(projectEntries).find(
        (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
      );

    if (rootEntry) {
      await openDocument(rootEntry);
    } else {
      setWelcomeOpen(false);
    }
  };

  const closeWelcomePage = (event: React.MouseEvent) => {
    event.stopPropagation();
    setWelcomeOpen(false);
    if (!activePath) {
      setActivePath(documents[0]?.path ?? "");
    }
  };

  const openDiagnostic = async (diagnostic: Diagnostic) => {
    if (!diagnostic.file) {
      return;
    }
    const entry = flattenEntries(projectEntries).find(
      (item) =>
        item.type === "file" &&
        (item.relativePath === diagnostic.file ||
          item.name === fileName(diagnostic.file)),
    );
    if (!entry) {
      return;
    }
    await openDocument(entry);
    requestAnimationFrame(() => {
      editorRef.current?.revealLineInCenter(diagnostic.line);
      editorRef.current?.setPosition({
        lineNumber: diagnostic.line,
        column: diagnostic.column,
      });
      editorRef.current?.focus();
    });
  };

  const startResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const handleMove = (moveEvent: PointerEvent) => {
      const workspace = document.querySelector(".editor-preview")!;
      const bounds = workspace.getBoundingClientRect();
      const percent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplitPercent(Math.min(72, Math.max(28, percent)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-drag">
          <div className="app-mark">
            <span>L</span>
          </div>
          <span className="title-project">{projectName}</span>
          <span className="title-separator">—</span>
          <span>LatexDo</span>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className={`icon-button ${sidebarVisible ? "active" : ""}`}
            onClick={toggleSidebar}
            title="Toggle sidebar (Cmd/Ctrl+B)"
            aria-label="Toggle sidebar"
            aria-pressed={sidebarVisible}
          >
            {sidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button
            type="button"
            className={`icon-button ${panelVisible ? "active" : ""}`}
            onClick={togglePanel}
            title="Toggle panel"
            aria-label="Toggle bottom panel"
            aria-pressed={panelVisible}
          >
            <PanelBottom size={16} />
          </button>
          <button
            type="button"
            className={`icon-button ${previewShown ? "active" : ""}`}
            onClick={() => void togglePreview()}
            title="Toggle PDF preview"
            aria-label="Toggle PDF preview"
            aria-pressed={previewShown}
          >
            {previewShown ? (
              <PanelRightClose size={16} />
            ) : (
              <PanelRightOpen size={16} />
            )}
          </button>
        </div>
      </header>

      <div className="workbench">
        <nav className="activity-bar">
          <div>
            <button
              className="activity-button welcome-activity"
              onClick={showWelcomePage}
              title="Welcome"
            >
              <House size={21} />
            </button>
            <button
              className={`activity-button ${sidebarVisible ? "active" : ""}`}
              onClick={() => setSidebarVisible(true)}
              title="Explorer"
            >
              <Files size={22} />
            </button>
            <button className="activity-button" title="Search">
              <Search size={22} />
            </button>
            <button className="activity-button" title="Source control">
              <GitBranch size={21} />
            </button>
            <button className="activity-button" title="LaTeX tools">
              <BookOpenText size={22} />
            </button>
            <button className="activity-button" title="Extensions">
              <Blocks size={22} />
            </button>
          </div>
          <div>
            <button
              type="button"
              className={`activity-button ${settingsOpen ? "active" : ""}`}
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
              aria-pressed={settingsOpen}
            >
              <Settings size={21} />
            </button>
          </div>
        </nav>

        {sidebarVisible ? (
          <aside className="sidebar">
            <div className="sidebar-header">
              <span>EXPLORER</span>
              <div>
                <button
                  className="small-icon"
                  onClick={() => openCreateDialog("file")}
                  title="New file"
                >
                  <FilePlus2 size={15} />
                </button>
                <button
                  className="small-icon"
                  onClick={() => openCreateDialog("folder")}
                  title="New folder"
                >
                  <FolderPlus size={15} />
                </button>
                <button
                  className="small-icon"
                  onClick={() => void refreshProject()}
                  title="Refresh"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            <button className="project-heading" onClick={openProject}>
              <ChevronDown size={13} />
              <span>{projectName.toUpperCase()}</span>
              <FolderOpen size={14} />
            </button>
            <div className="file-tree">
              <FileTree
                entries={projectEntries}
                activePath={activePath}
                onOpen={openDocument}
              />
            </div>
            <button className="open-folder-button" onClick={openProject}>
              <FolderOpen size={15} />
              Open folder
            </button>
          </aside>
        ) : null}

        <main className="main-area">
          <div className="toolbar">
            <div className="root-control">
              <span className="control-label">ROOT</span>
              <div className="select-wrap">
                <select
                  value={rootFile}
                  onChange={(event) => setRootFile(event.target.value)}
                >
                  {texFiles.map((entry) => (
                    <option key={entry.path} value={entry.relativePath}>
                      {entry.relativePath}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </div>
            </div>
            <div className="toolbar-spacer" />
            <div className="engine-select select-wrap">
              <select
                value={engine}
                onChange={(event) => setEngine(event.target.value as Engine)}
                title="LaTeX engine"
              >
                <option value="pdflatex">pdfLaTeX</option>
                <option value="xelatex">XeLaTeX</option>
                <option value="lualatex">LuaLaTeX</option>
              </select>
              <ChevronDown size={13} />
            </div>
            <button
              className={`compile-button ${compiling ? "compiling" : ""}`}
              onClick={() => void compile()}
              disabled={compiling || !rootFile}
            >
              {compiling ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
              {compiling ? "Compiling" : "Compile"}
            </button>
          </div>

          <div className="document-tabs">
            {welcomeOpen ? (
              <button
                className={`document-tab welcome-tab ${
                  showWelcome ? "active" : ""
                }`}
                onClick={showWelcomePage}
              >
                <span className="welcome-tab-mark">L</span>
                <span>Welcome</span>
                <span className="tab-close" onClick={closeWelcomePage}>
                  <X size={13} />
                </span>
              </button>
            ) : null}
            {documents.map((document) => {
              const dirty = document.content !== document.savedContent;
              return (
                <button
                  key={document.path}
                  className={`document-tab ${
                    !showWelcome && activePath === document.path ? "active" : ""
                  }`}
                  onClick={() => {
                    setActivePath(document.path);
                  }}
                >
                  <Code2 size={14} className="tab-file-icon" />
                  <span>{document.name}</span>
                  <span
                    className={`tab-close ${dirty ? "dirty" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeDocument(document.path);
                    }}
                  >
                    {dirty ? <span className="dirty-dot" /> : <X size={13} />}
                  </span>
                </button>
              );
            })}
            <div className="tabs-fill" />
          </div>

          <div
            className="editor-preview"
            style={
              {
                "--source-width":
                  previewShown ? `${splitPercent}%` : "100%",
              } as React.CSSProperties
            }
          >
            <section className="source-pane">
              {showWelcome ? (
                <div className="welcome-page">
                  <div className="welcome-hero">
                    <div className="welcome-brand">
                      <span>L</span>
                    </div>
                    <div>
                      <h1>LatexDo</h1>
                      <p>Write beautifully. Compile locally.</p>
                    </div>
                  </div>

                  <div className="welcome-grid">
                    <section className="welcome-section">
                      <h2>Start</h2>
                      <button
                        className="welcome-action primary"
                        onClick={() => void createProject()}
                      >
                        <Plus size={18} />
                        <span>
                          <strong>New LaTeX Project</strong>
                          <small>Create a project with a ready-to-build main.tex</small>
                        </span>
                      </button>
                      <button
                        className="welcome-action"
                        onClick={() => openCreateDialog("file")}
                      >
                        <FilePlus2 size={18} />
                        <span>
                          <strong>New File</strong>
                          <small>Add a .tex, .bib, or text file to this project</small>
                        </span>
                      </button>
                      <button className="welcome-action" onClick={openProject}>
                        <FolderOpen size={18} />
                        <span>
                          <strong>Open Folder</strong>
                          <small>Open an existing LaTeX project</small>
                        </span>
                      </button>
                    </section>

                    <section className="welcome-section">
                      <h2>Current Project</h2>
                      <div className="welcome-project-card">
                        <div className="project-card-icon">
                          <BookOpenText size={22} />
                        </div>
                        <div>
                          <strong>{projectName}</strong>
                          <small>{projectPath}</small>
                        </div>
                      </div>
                      {texFiles.slice(0, 4).map((entry) => (
                        <button
                          className="welcome-recent"
                          key={entry.path}
                          onClick={() => void openDocument(entry)}
                        >
                          <Code2 size={15} />
                          <span>{entry.relativePath}</span>
                          <ExternalLink size={13} />
                        </button>
                      ))}
                    </section>
                  </div>

                  <div className="welcome-tip">
                    <Command size={14} />
                    <span>
                      Compile anytime with <kbd>⌘</kbd> <kbd>Enter</kbd>
                    </span>
                  </div>
                </div>
              ) : activeDocument ? (
                <Editor
                  key={activeDocument.path}
                  path={activeDocument.path}
                  value={activeDocument.content}
                  language={languageFor(activeDocument.name)}
                  theme="latexdo-dark"
                  beforeMount={configureMonaco}
                  onMount={handleEditorMount}
                  onChange={(value) =>
                    setDocuments((current) =>
                      current.map((document) =>
                        document.path === activeDocument.path
                          ? { ...document, content: value ?? "" }
                          : document,
                      ),
                    )
                  }
                  options={{
                    fontFamily:
                      "'SFMono-Regular', 'Cascadia Code', 'Fira Code', Menlo, monospace",
                    fontSize: settings.editorFontSize,
                    lineHeight: 22,
                    minimap: { enabled: settings.minimap, scale: 0.75 },
                    padding: { top: 16, bottom: 24 },
                    renderWhitespace: "selection",
                    smoothScrolling: true,
                    cursorSmoothCaretAnimation: "on",
                    bracketPairColorization: { enabled: true },
                    guides: { bracketPairs: true, indentation: true },
                    wordWrap: settings.wordWrap ? "on" : "off",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fixedOverflowWidgets: true,
                    suggest: { showSnippets: true },
                  }}
                />
              ) : (
                <div className="empty-editor">
                  <div className="empty-logo">L</div>
                  <h2>No editor is open</h2>
                  <button onClick={showWelcomePage}>Show Welcome</button>
                </div>
              )}
            </section>

            {previewShown ? (
              <>
                <div
                  className="split-handle"
                  onPointerDown={startResize}
                  role="separator"
                  aria-orientation="vertical"
                />
                <section className="preview-pane">
                  <div className="preview-header">
                    <div>
                      <BookOpenText size={15} />
                      <span>{fileName(rootFile).replace(/\.tex$/, ".pdf")}</span>
                      {compileResult?.ok ? (
                        <span className="built-badge">
                          <Check size={11} /> Built
                        </span>
                      ) : null}
                    </div>
                    <div className="preview-actions">
                      <button
                        onClick={() => setPdfScale((scale) => Math.max(60, scale - 10))}
                        title="Zoom out"
                      >
                        <ZoomOut size={15} />
                      </button>
                      <span>{pdfScale}%</span>
                      <button
                        onClick={() => setPdfScale((scale) => Math.min(180, scale + 10))}
                        title="Zoom in"
                      >
                        <ZoomIn size={15} />
                      </button>
                      <button onClick={() => void compile()} title="Refresh PDF">
                        <RefreshCw size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="pdf-surface">
                    {pdfUrl ? (
                      <iframe
                        title="Compiled PDF"
                        src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH&zoom=${pdfScale}`}
                      />
                    ) : (
                      <div className="preview-empty">
                        <div className="paper-skeleton">
                          <div className="paper-title" />
                          <div className="paper-subtitle" />
                          <div className="paper-line wide" />
                          <div className="paper-line" />
                          <div className="paper-line medium" />
                          <div className="paper-heading" />
                          <div className="paper-line wide" />
                          <div className="paper-line medium" />
                        </div>
                        <p>Compile to generate the PDF preview</p>
                        <span>
                          <Command size={12} /> Ctrl/⌘ + Enter
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              </>
            ) : null}
          </div>

          {panelVisible ? (
            <section className="bottom-panel">
              <div className="panel-tabs">
                <button
                  className={activePanel === "problems" ? "active" : ""}
                  onClick={() => setActivePanel("problems")}
                >
                  PROBLEMS
                  {diagnostics.length ? (
                    <span className="count-badge">{diagnostics.length}</span>
                  ) : null}
                </button>
                <button
                  className={activePanel === "output" ? "active" : ""}
                  onClick={() => setActivePanel("output")}
                >
                  OUTPUT
                </button>
                <div />
                <button
                  className="panel-close"
                  onClick={() => setPanelVisible(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="panel-content">
                {activePanel === "problems" ? (
                  diagnostics.length ? (
                    diagnostics.map((diagnostic, index) => (
                      <button
                        className="diagnostic-row"
                        key={`${diagnostic.file}-${diagnostic.line}-${index}`}
                        onClick={() => void openDiagnostic(diagnostic)}
                      >
                        {diagnostic.severity === "error" ? (
                          <CircleAlert size={15} className="error-icon" />
                        ) : (
                          <AlertCircle size={15} className="warning-icon" />
                        )}
                        <span className="diagnostic-message">
                          {diagnostic.message}
                        </span>
                        <span className="diagnostic-location">
                          {diagnostic.file || rootFile}:{diagnostic.line}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="panel-empty">
                      <CircleCheck size={16} />
                      No problems detected
                    </div>
                  )
                ) : (
                  <pre className="build-output">
                    {compileResult?.output || "Compile the project to see build output."}
                  </pre>
                )}
              </div>
            </section>
          ) : null}
        </main>
      </div>

      <footer className="statusbar">
        <div>
          <span className="status-brand">
            <Box size={13} />
            LatexDo
          </span>
          <button onClick={() => setPanelVisible(true)}>
            <CircleAlert size={13} /> {errors}
          </button>
          <button onClick={() => setPanelVisible(true)}>
            <AlertCircle size={13} /> {warnings}
          </button>
          <span className="status-message">{statusMessage}</span>
        </div>
        <div>
          <span>{activeDocument ? "LaTeX" : "Plain Text"}</span>
          <span>UTF-8</span>
          <span>Spaces: 2</span>
          <button onClick={() => setPanelVisible((visible) => !visible)}>
            <TerminalSquare size={13} />
          </button>
        </div>
      </footer>

      {createDialog ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCreateDialog(null);
            }
          }}
        >
          <form className="create-dialog" onSubmit={submitCreate}>
            <div className="dialog-icon">
              {createDialog === "file" ? (
                <FilePlus2 size={20} />
              ) : (
                <FolderPlus size={20} />
              )}
            </div>
            <div className="dialog-copy">
              <h2>Create new {createDialog}</h2>
              <p>
                Add it inside <strong>{projectName}</strong>. Nested paths such as
                {" "}
                <code>chapters/introduction.tex</code> are supported.
              </p>
            </div>
            <label htmlFor="create-path">
              {createDialog === "file" ? "File path" : "Folder path"}
            </label>
            <input
              id="create-path"
              autoFocus
              value={createPath}
              onChange={(event) => setCreatePath(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              spellCheck={false}
            />
            {createError ? (
              <div className="dialog-error">
                <CircleAlert size={14} />
                {createError}
              </div>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => setCreateDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="dialog-submit"
                disabled={creating}
              >
                {creating ? "Creating…" : `Create ${createDialog}`}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSettingsOpen(false);
            }
          }}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="settings-header">
              <div className="dialog-icon">
                <Settings size={20} />
              </div>
              <div className="dialog-copy">
                <h2 id="settings-title">Settings</h2>
                <p>Configure the editor and default LaTeX compiler.</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                <X size={17} />
              </button>
            </div>

            <div className="settings-list">
              <label className="settings-row">
                <span>
                  <strong>Default compiler</strong>
                  <small>Used for the current and future projects.</small>
                </span>
                <select
                  value={settings.defaultEngine}
                  onChange={(event) => {
                    const defaultEngine = event.target.value as Engine;
                    setSettings((current) => ({
                      ...current,
                      defaultEngine,
                    }));
                    setEngine(defaultEngine);
                  }}
                >
                  <option value="pdflatex">pdfLaTeX</option>
                  <option value="xelatex">XeLaTeX</option>
                  <option value="lualatex">LuaLaTeX</option>
                </select>
              </label>

              <label className="settings-row">
                <span>
                  <strong>Editor font size</strong>
                  <small>{settings.editorFontSize}px</small>
                </span>
                <input
                  type="range"
                  min="11"
                  max="22"
                  step="0.5"
                  value={settings.editorFontSize}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      editorFontSize: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="settings-row settings-toggle">
                <span>
                  <strong>Word wrap</strong>
                  <small>Wrap long source lines inside the editor.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.wordWrap}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      wordWrap: event.target.checked,
                    }))
                  }
                />
              </label>

              <label className="settings-row settings-toggle">
                <span>
                  <strong>Minimap</strong>
                  <small>Show the source overview beside the editor.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.minimap}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      minimap: event.target.checked,
                    }))
                  }
                />
              </label>
            </div>

            <div className="settings-footer">
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => {
                  setSettings(defaultSettings);
                  setEngine(defaultSettings.defaultEngine);
                }}
              >
                Reset defaults
              </button>
              <button
                type="button"
                className="dialog-submit"
                onClick={() => setSettingsOpen(false)}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
