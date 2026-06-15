import Editor, {
  DiffEditor,
  type BeforeMount,
  type OnMount,
} from "@monaco-editor/react";
import {
  AlertCircle,
  BookOpenText,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Code2,
  Command,
  Download,
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
  Pencil,
  Play,
  Plus,
  RefreshCw,
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
import PdfPreview, { type PdfClickLocation } from "./PdfPreview";
import TikzCanvas from "./TikzCanvas";
import { TerminalPanel } from "./components/TerminalPanel";
import { monaco } from "./monaco";
import type {
  CompileResult,
  Diagnostic,
  DiagnosticFix,
  Engine,
  GitCommitDetails,
  GitDiffEditorInput,
  GitDiffPreview,
  GitHistorySummary,
  GitStatusSummary,
  OpenDocument,
  ProofreadingResult,
  ProofreadingSettings,
  ProjectEntry,
  SpellCheckerSettings,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
  UpdateCheckResult,
} from "./types";

type PanelKind = "problems" | "output" | "terminal";
type SidebarView = "explorer" | "sourceControl";

interface GitDiffSession extends GitDiffEditorInput {
  label: string;
}

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

function buildAutoCompileSignature(
  documents: OpenDocument[],
  projectPath: string,
  rootFile: string,
  engine: Engine,
): string {
  return JSON.stringify({
    projectPath,
    rootFile,
    engine,
    dirtyDocuments: documents
      .filter((document) => document.content !== document.savedContent)
      .map((document) => ({
        relativePath: document.relativePath,
        content: document.content,
      })),
  });
}

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

function normalizeRelativePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/(^|\/)\.\//g, "$1");
}

function joinRelativePath(directory: string, name: string): string {
  return normalizeRelativePath(`${directory}/${name}`).replace(/^\/+/, "");
}

function createPathInDirectory(directory: string, name: string): string {
  const normalizedDirectory = normalizeRelativePath(directory).replace(/\/+$/, "");
  return normalizedDirectory ? joinRelativePath(normalizedDirectory, name) : name;
}

function uniqueWords(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function supportsProofreading(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "tex" || extension === "md" || extension === "txt";
}

function wordColumn(
  lineContent: string,
  word: string | undefined,
  preferredColumn: number,
): { column: number; length: number } {
  if (!word) {
    return { column: Math.max(1, preferredColumn), length: 0 };
  }

  const matches: number[] = [];
  let index = lineContent.indexOf(word);
  while (index >= 0) {
    matches.push(index);
    index = lineContent.indexOf(word, index + word.length);
  }
  if (!matches.length) {
    return { column: Math.max(1, preferredColumn), length: 0 };
  }

  const preferredIndex = Math.max(0, preferredColumn - 1);
  const nearest = matches.reduce((best, candidate) =>
    Math.abs(candidate - preferredIndex) < Math.abs(best - preferredIndex)
      ? candidate
      : best,
  );
  return { column: nearest + 1, length: word.length };
}

function diagnosticHeadline(diagnostic: Diagnostic): string {
  if (diagnostic.title) {
    return diagnostic.title;
  }

  const normalized = diagnostic.message.toLowerCase();

  if (normalized.includes("undefined control sequence")) {
    return "Unknown LaTeX command";
  }
  if (normalized.includes("missing $ inserted")) {
    return "Math content is outside math mode";
  }
  if (normalized.includes("extra }, or forgotten $")) {
    return "Unbalanced braces or math delimiters";
  }
  if (normalized.includes("runaway argument")) {
    return "A command argument was never closed";
  }
  if (normalized.includes("file `") && normalized.includes("' not found")) {
    return "A required file is missing";
  }
  if (normalized.includes("citation") && normalized.includes("undefined")) {
    return "Citation key not found";
  }
  if (
    normalized.includes("reference") && normalized.includes("undefined")
  ) {
    return "Reference could not be resolved";
  }
  if (normalized.includes("there were undefined references")) {
    return "Some references are unresolved";
  }
  if (normalized.includes("there were undefined citations")) {
    return "Some citations are unresolved";
  }

  return diagnostic.severity === "warning" ? "LaTeX warning" : "LaTeX error";
}

function diagnosticLocationLabel(diagnostic: Diagnostic, rootFile: string): string {
  const file = diagnostic.file || rootFile;
  return `${file}:${diagnostic.line}:${Math.max(1, diagnostic.column)}`;
}

function diagnosticMarkerMessage(diagnostic: Diagnostic): string {
  return [
    diagnosticHeadline(diagnostic),
    diagnostic.detail,
    diagnostic.originReason
      ? `Why this location: ${diagnostic.originReason}`
      : undefined,
    diagnostic.reportedLine && diagnostic.reportedLine !== diagnostic.line
      ? `LaTeX stopped later at line ${diagnostic.reportedLine}, column ${
          diagnostic.reportedColumn ?? 1
        }.`
      : undefined,
    diagnostic.suggestion ? `Suggested fix: ${diagnostic.suggestion}` : undefined,
    `Compiler message: ${diagnostic.message}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function diagnosticAccuracyLabel(diagnostic: Diagnostic): string {
  const confidence = diagnostic.locationConfidence
    ? ` · ${diagnostic.locationConfidence}%`
    : "";
  if (diagnostic.locationAccuracy === "exact") {
    return `Exact origin${confidence}`;
  }
  if (diagnostic.locationAccuracy === "inferred") {
    return `Likely origin${confidence}`;
  }
  return `Compiler line${confidence}`;
}

function diagnosticContextContent(
  diagnostic: Diagnostic,
  text: string,
  focus: boolean,
): React.ReactNode {
  if (!focus) {
    return text || " ";
  }

  const start = Math.min(text.length, Math.max(0, diagnostic.column - 1));
  const end = Math.min(
    text.length,
    Math.max(start + 1, (diagnostic.endColumn ?? diagnostic.column + 1) - 1),
  );

  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end) || " "}</mark>
      {text.slice(end)}
    </>
  );
}

function positionOffset(content: string, line: number, column: number): number {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }

  const lineIndex = Math.min(starts.length - 1, Math.max(0, line - 1));
  const lineStart = starts[lineIndex];
  const nextLineStart = starts[lineIndex + 1] ?? content.length + 1;
  const lineEnd = Math.max(
    lineStart,
    nextLineStart - (content[nextLineStart - 2] === "\r" ? 2 : 1),
  );
  return Math.min(lineEnd, lineStart + Math.max(0, column - 1));
}

function applyTextFix(content: string, fix: DiagnosticFix): string | null {
  const start = positionOffset(content, fix.line, fix.column);
  const end = positionOffset(content, fix.endLine, fix.endColumn);
  if (content.slice(start, Math.max(start, end)) !== fix.expectedText) {
    return null;
  }
  return content.slice(0, start) + fix.replacement + content.slice(Math.max(start, end));
}

export default function App() {
  const [projectPath, setProjectPath] = useState("");
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>([]);
  const [hideProjectEntries, setHideProjectEntries] = useState(false);
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
  const [activeSidebar, setActiveSidebar] = useState<SidebarView>("explorer");
  const [engine, setEngine] = useState<Engine>(settings.defaultEngine);
  const [rootFile, setRootFile] = useState("main.tex");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [tikzCanvasOpen, setTikzCanvasOpen] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelKind>("problems");
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitActionBusy, setGitActionBusy] = useState<string | null>(null);
  const [gitDiffPreview, setGitDiffPreview] = useState<GitDiffPreview | null>(null);
  const [gitDiffSession, setGitDiffSession] = useState<GitDiffSession | null>(null);
  const [gitRepoHistory, setGitRepoHistory] = useState<GitHistorySummary | null>(null);
  const [gitFileHistory, setGitFileHistory] = useState<GitHistorySummary | null>(null);
  const [gitCommitDetails, setGitCommitDetails] = useState<GitCommitDetails | null>(null);
  const [gitCommitDetailsTargetPath, setGitCommitDetailsTargetPath] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [spellCheckerSettings, setSpellCheckerSettings] =
    useState<SpellCheckerSettings | null>(null);
  const [spellCheckerLoading, setSpellCheckerLoading] = useState(false);
  const [spellCheckerError, setSpellCheckerError] = useState("");
  const [spellCheckerWordDraft, setSpellCheckerWordDraft] = useState("");
  const [spellCheckerLanguageQuery, setSpellCheckerLanguageQuery] = useState("");
  const [proofreadingSettings, setProofreadingSettings] =
    useState<ProofreadingSettings | null>(null);
  const [proofreadingResult, setProofreadingResult] =
    useState<ProofreadingResult | null>(null);
  const [proofreadingLoading, setProofreadingLoading] = useState(false);
  const [proofreadingError, setProofreadingError] = useState("");
  const [statusMessage, setStatusMessage] = useState("Opening workspace…");
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfTarget, setPdfTarget] = useState<SyncTexPdfLocation | null>(null);
  const [pdfScale, setPdfScale] = useState(100);
  const [splitPercent, setSplitPercent] = useState(52);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorMouseDisposableRef = useRef<monaco.IDisposable | null>(null);
  const documentsRef = useRef<OpenDocument[]>([]);
  const projectEntriesRef = useRef<ProjectEntry[]>([]);
  const projectPathRef = useRef("");
  const activePathRef = useRef("");
  const rootFileRef = useRef(rootFile);
  const engineRef = useRef(engine);
  const pdfPathRef = useRef("");
  const forwardSyncRef = useRef<
    ((position: monaco.Position) => Promise<void>) | null
  >(null);
  const pendingSourceRef = useRef<{
    path: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    word?: string;
  } | null>(null);
  const lastAutoCompileSignatureRef = useRef("");

  const activeDocument = documents.find(
    (document) => document.path === activePath,
  );
  const showWelcome = welcomeOpen && !activePath;
  const showBlankWorkspace = hideProjectEntries && !welcomeOpen && !activePath;
  const previewShown = previewVisible && !showWelcome && !showBlankWorkspace;
  const projectName = fileName(projectPath) || "LatexDo";
  const diagnostics = useMemo(
    () => [...(compileResult?.diagnostics ?? []), ...(proofreadingResult?.diagnostics ?? [])],
    [compileResult?.diagnostics, proofreadingResult?.diagnostics],
  );
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const primaryDiagnostic = useMemo(
    () =>
      compileResult?.diagnostics.find((diagnostic) => diagnostic.isPrimary) ??
      compileResult?.diagnostics.find(
        (diagnostic) => diagnostic.severity === "error",
      ) ??
      null,
    [compileResult?.diagnostics],
  );
  const cascadingErrors = useMemo(
    () =>
      compileResult?.diagnostics.filter((diagnostic) => diagnostic.isCascade)
        .length ?? 0,
    [compileResult?.diagnostics],
  );
  const texFiles = useMemo(
    () =>
      flattenEntries(projectEntries).filter(
        (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
      ),
    [projectEntries],
  );
  const allProjectEntries = useMemo(
    () => flattenEntries(projectEntries),
    [projectEntries],
  );
  const modifiedFiles = gitStatus?.entries.length ?? 0;
  const stagedGitEntries = useMemo(
    () => (gitStatus?.entries ?? []).filter((entry) => Boolean(entry.indexStatus)),
    [gitStatus],
  );
  const unstagedGitEntries = useMemo(
    () => (gitStatus?.entries ?? []).filter((entry) => Boolean(entry.workingTreeStatus)),
    [gitStatus],
  );
  const filteredSpellCheckerLanguages = useMemo(() => {
    const query = spellCheckerLanguageQuery.trim().toLowerCase();
    const languages = spellCheckerSettings?.availableLanguages ?? [];
    if (!query) {
      return languages;
    }

    return languages.filter((language) => language.toLowerCase().includes(query));
  }, [spellCheckerLanguageQuery, spellCheckerSettings?.availableLanguages]);
  const rootFileExists = useMemo(
    () =>
      allProjectEntries.some(
        (entry) =>
          entry.type === "file" &&
          normalizeRelativePath(entry.relativePath) ===
            normalizeRelativePath(rootFile),
      ),
    [allProjectEntries, rootFile],
  );
  const autoCompileSignature = useMemo(
    () =>
      buildAutoCompileSignature(documents, projectPath, rootFile, engine),
    [documents, engine, projectPath, rootFile],
  );

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    projectEntriesRef.current = projectEntries;
  }, [projectEntries]);

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

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
        activePathRef.current = entry.path;
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
      activePathRef.current = entry.path;
      setStatusMessage(`Opened ${entry.relativePath}`);
    },
    [],
  );

  const loadProject = useCallback(
    async (
      path: string,
      openFirstDocument = false,
      hideEntries = false,
    ) => {
      setStatusMessage("Loading project…");
      setProjectPath(path);
      projectPathRef.current = path;
      setHideProjectEntries(hideEntries);
      setDocuments([]);
      documentsRef.current = [];
      setActivePath("");
      activePathRef.current = "";
      setWelcomeOpen(true);
      setCompileResult(null);
      setPdfData(null);
      setPdfTarget(null);
      pdfPathRef.current = "";
      lastAutoCompileSignatureRef.current = "";

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
      .then((path) => loadProject(path, false, true))
      .catch((error: unknown) => {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not open workspace",
        );
      });

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
      setDocuments((current) => {
        const nextDocuments = current.map((item) =>
          item.path === document.path
            ? { ...item, savedContent: item.content }
            : item,
        );
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
      setStatusMessage(`Saved ${document.relativePath}`);
    },
    [],
  );

  const compile = useCallback(async (): Promise<CompileResult | null> => {
    const currentProject = projectPathRef.current;
    if (!currentProject || compiling) {
      return null;
    }

    lastAutoCompileSignatureRef.current = buildAutoCompileSignature(
      documentsRef.current,
      currentProject,
      rootFileRef.current,
      engineRef.current,
    );
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
        pdfPathRef.current = result.pdfPath;
        setPdfData(new Uint8Array(bytes));
        setPdfTarget(null);
        setPreviewVisible(true);
        setStatusMessage(`Built successfully in ${formatDuration(result.durationMs)}`);
      } else {
        pdfPathRef.current = "";
        setPdfTarget(null);
        setPanelVisible(true);
        setActivePanel(result.diagnostics.length ? "problems" : "output");
        setStatusMessage(result.error ?? "Compilation failed");
      }
      return result;
    } catch (error) {
      pdfPathRef.current = "";
      setPdfTarget(null);
      setPanelVisible(true);
      setActivePanel("output");
      setStatusMessage(
        error instanceof Error ? error.message : "Compilation failed",
      );
      return null;
    } finally {
      setCompiling(false);
    }
  }, [compiling]);

  const saveActiveAndCompile = useCallback(async () => {
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (document) {
      await saveDocument(document);
    }
    await compile();
  }, [compile, saveDocument]);

  const downloadPdf = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject || !rootFileExists) {
      return;
    }

    try {
      const sourceIsDirty = documentsRef.current.some(
        (document) => document.content !== document.savedContent,
      );
      let pdfPath = pdfPathRef.current;

      if (!pdfPath || sourceIsDirty) {
        const result = await compile();
        pdfPath = result?.ok ? result.pdfPath ?? "" : "";
      }
      if (!pdfPath) {
        setStatusMessage("Compile successfully before downloading the PDF");
        return;
      }

      const bytes = await window.latexdo.readPdf(currentProject, pdfPath);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      const downloadName = fileName(rootFileRef.current).replace(/\.tex$/i, ".pdf");

      link.href = url;
      link.download = downloadName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusMessage(`Downloaded ${downloadName}`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not download the PDF",
      );
    }
  }, [compile, rootFileExists]);

  const compileEntry = useCallback(
    async (entry: ProjectEntry) => {
      if (entry.type !== "file" || !entry.name.endsWith(".tex")) {
        return;
      }

      setRootFile(entry.relativePath);
      rootFileRef.current = entry.relativePath;
      setWelcomeOpen(false);
      setStatusMessage(`Using ${entry.relativePath} as the main file`);
      await compile();
    },
    [compile],
  );

  useEffect(() => {
    if (!projectPath || !rootFileExists || compiling) {
      return;
    }
    if (autoCompileSignature === lastAutoCompileSignatureRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      lastAutoCompileSignatureRef.current = autoCompileSignature;
      void compile();
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [autoCompileSignature, compile, compiling, projectPath, rootFileExists]);

  const moveEntry = useCallback(
    async (sourcePath: string, destination: ProjectEntry) => {
      const currentProject = projectPathRef.current;
      if (!currentProject || destination.type !== "directory") {
        return;
      }

      const sourceEntry = flattenEntries(projectEntriesRef.current).find(
        (entry) => entry.path === sourcePath,
      );
      if (!sourceEntry) {
        setStatusMessage("The dragged file could not be found.");
        return;
      }

      const destinationRelativePath = joinRelativePath(
        destination.relativePath,
        sourceEntry.name,
      );

      try {
        const dirtySourceDocument = documentsRef.current.find(
          (document) =>
            document.path === sourceEntry.path &&
            document.content !== document.savedContent,
        );
        if (dirtySourceDocument) {
          await saveDocument(dirtySourceDocument);
        }

        const nextPath = await window.latexdo.moveEntry(
          currentProject,
          sourceEntry.relativePath,
          destinationRelativePath,
        );
        const nextRelativePath = normalizeRelativePath(destinationRelativePath);

        setDocuments((current) =>
          current.map((document) =>
            document.path === sourceEntry.path
              ? {
                  ...document,
                  path: nextPath,
                  relativePath: nextRelativePath,
                  name: sourceEntry.name,
                }
              : document,
          ),
        );
        documentsRef.current = documentsRef.current.map((document) =>
          document.path === sourceEntry.path
            ? {
                ...document,
                path: nextPath,
                relativePath: nextRelativePath,
                name: sourceEntry.name,
              }
            : document,
        );

        if (activePathRef.current === sourceEntry.path) {
          setActivePath(nextPath);
          activePathRef.current = nextPath;
        }
        if (normalizeRelativePath(rootFileRef.current) === sourceEntry.relativePath) {
          setRootFile(nextRelativePath);
          rootFileRef.current = nextRelativePath;
        }

        setCompileResult(null);
        setPdfData(null);
        setPdfTarget(null);
        pdfPathRef.current = "";
        await refreshProject(currentProject);
        setStatusMessage(`Moved ${sourceEntry.name} to ${destination.relativePath}`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not move the file",
        );
      }
    },
    [refreshProject, saveDocument],
  );

  const revealPendingSource = useCallback(() => {
    const pending = pendingSourceRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!pending || !editor || !model) {
      return false;
    }

    if (
      normalizeRelativePath(model.uri.fsPath) !==
      normalizeRelativePath(pending.path)
    ) {
      return false;
    }

    const line = Math.min(Math.max(1, pending.line), model.getLineCount());
    const lineLength = model.getLineLength(line);
    const match = pending.word
      ? wordColumn(
          model.getLineContent(line),
          pending.word,
          pending.column,
        )
      : {
          column: Math.min(Math.max(1, pending.column), lineLength + 1),
          length: Math.max(
            1,
            (pending.endColumn ?? pending.column + 1) - pending.column,
          ),
        };
    const endLine = Math.min(
      Math.max(line, pending.endLine ?? line),
      model.getLineCount(),
    );
    const endColumn =
      endLine === line
        ? Math.min(lineLength + 1, match.column + match.length)
        : Math.min(
            model.getLineLength(endLine) + 1,
            Math.max(1, pending.endColumn ?? 1),
          );
    const range = new monaco.Range(
      line,
      match.column,
      endLine,
      endColumn,
    );
    editor.setSelection(range);
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    editor.focus();
    pendingSourceRef.current = null;
    return true;
  }, []);

  const handleForwardSync = useCallback(
    async (position: monaco.Position) => {
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (!document || !document.name.endsWith(".tex")) {
        return;
      }

      const model = editorRef.current?.getModel();
      const word = model?.getWordAtPosition(position)?.word;
      let pdfPath = pdfPathRef.current;
      const sourceIsDirty = documentsRef.current.some(
        (item) => item.content !== item.savedContent,
      );

      if (!pdfPath || sourceIsDirty) {
        const result = await compile();
        pdfPath = result?.ok ? result.pdfPath ?? "" : "";
      }
      if (!pdfPath) {
        setStatusMessage("Compile successfully before synchronizing the PDF");
        return;
      }

      try {
        const location = await window.latexdo.forwardSyncTex(
          projectPathRef.current,
          pdfPath,
          document.path,
          position.lineNumber,
          position.column,
        );
        if (!location) {
          setStatusMessage("No PDF location was found for this source position");
          return;
        }

        setPreviewVisible(true);
        setPdfTarget({ ...location, word });
        setStatusMessage(`Showing ${document.name}:${position.lineNumber} in PDF`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not synchronize PDF",
        );
      }
    },
    [compile],
  );
  forwardSyncRef.current = handleForwardSync;

  const handleBackwardSync = useCallback(
    async (pdfLocation: PdfClickLocation) => {
      const pdfPath = pdfPathRef.current;
      if (!pdfPath) {
        return;
      }

      try {
        const location: SyncTexSourceLocation | null =
          await window.latexdo.backwardSyncTex(
            projectPathRef.current,
            pdfPath,
            pdfLocation.page,
            pdfLocation.x,
            pdfLocation.y,
          );
        if (!location) {
          setStatusMessage("No source location was found for this PDF position");
          return;
        }

        const normalizedFile = normalizeRelativePath(location.file);
        const entry = flattenEntries(projectEntries).find(
          (item) =>
            item.type === "file" &&
            normalizeRelativePath(item.relativePath) === normalizedFile,
        );
        if (!entry) {
          setStatusMessage(`Could not open ${location.file}`);
          return;
        }

        pendingSourceRef.current = {
          path: entry.path,
          line: location.line,
          column: location.column,
          word: pdfLocation.word,
        };
        await openDocument(entry);
        setWelcomeOpen(false);
        requestAnimationFrame(() => {
          revealPendingSource();
        });
        setStatusMessage(`Opened ${entry.relativePath}:${location.line}`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Could not synchronize source",
        );
      }
    },
    [openDocument, projectEntries, revealPendingSource],
  );

  const applyDiagnosticReplacement = useCallback(
    (diagnostic: Diagnostic) => {
      if (
        !diagnostic.replacements?.length ||
        !diagnostic.file ||
        diagnostic.source !== "proofread"
      ) {
        return;
      }

      const targetPath = normalizeRelativePath(diagnostic.file);
      const replacement = diagnostic.replacements[0] ?? "";

      setDocuments((current) =>
        current.map((document) => {
          if (normalizeRelativePath(document.relativePath) !== targetPath) {
            return document;
          }

          const lines = document.content.split("\n");
          const lineIndex = Math.max(0, diagnostic.line - 1);
          const line = lines[lineIndex];
          if (line === undefined) {
            return document;
          }

          const startColumn = Math.max(0, diagnostic.column - 1);
          const endColumn = Math.max(
            startColumn,
            (diagnostic.endLine === diagnostic.line
              ? (diagnostic.endColumn ?? diagnostic.column)
              : diagnostic.column) - 1,
          );

          lines[lineIndex] =
            line.slice(0, startColumn) + replacement + line.slice(endColumn);

          return {
            ...document,
            content: lines.join("\n"),
          };
        }),
      );
      setStatusMessage(`Applied suggestion: ${replacement}`);
    },
    [],
  );

  const applyLatexDiagnosticFix = useCallback(
    async (diagnostic: Diagnostic, fix: DiagnosticFix) => {
      const currentProject = projectPathRef.current;
      if (!currentProject || !diagnostic.file) {
        return;
      }

      const targetPath = normalizeRelativePath(diagnostic.file);
      const entry = flattenEntries(projectEntriesRef.current).find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) === targetPath,
      );
      if (!entry) {
        setStatusMessage(`Could not find ${diagnostic.file} in this project`);
        return;
      }

      const openDocumentState = documentsRef.current.find(
        (document) =>
          normalizeRelativePath(document.relativePath) === targetPath,
      );
      const content =
        openDocumentState?.content ??
        (await window.latexdo.readFile(currentProject, entry.path));
      const updatedContent = applyTextFix(content, fix);
      if (updatedContent === null) {
        setStatusMessage(
          "The source changed after this analysis. Compile again before applying the fix.",
        );
        return;
      }

      await window.latexdo.writeFile(
        currentProject,
        entry.path,
        updatedContent,
      );

      if (openDocumentState) {
        const nextDocuments = documentsRef.current.map((document) =>
          document.path === openDocumentState.path
            ? {
                ...document,
                content: updatedContent,
                savedContent: updatedContent,
              }
            : document,
        );
        documentsRef.current = nextDocuments;
        setDocuments(nextDocuments);
        setActivePath(openDocumentState.path);
        activePathRef.current = openDocumentState.path;
      } else {
        await openDocument(entry);
      }

      pendingSourceRef.current = {
        path: entry.path,
        line: fix.line,
        column: fix.column,
        endLine: fix.endLine,
        endColumn: Math.max(fix.column, fix.column + fix.replacement.length),
      };
      setWelcomeOpen(false);
      requestAnimationFrame(() => revealPendingSource());
      setStatusMessage(`Applied fix: ${fix.title}. Recompiling...`);
      await compile();
    },
    [compile, openDocument, revealPendingSource],
  );

  const runProofreading = useCallback(async () => {
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (!document || !supportsProofreading(document.name)) {
      setProofreadingResult(null);
      return;
    }

    setProofreadingLoading(true);
    setProofreadingError("");
    try {
      const result = await window.latexdo.proofreadDocument(
        document.relativePath,
        document.content,
      );
      setProofreadingResult(result);
      if (result.error) {
        setProofreadingError(result.error);
      } else {
        setStatusMessage(result.output);
      }
    } catch (error) {
      setProofreadingResult(null);
      setProofreadingError(
        error instanceof Error ? error.message : "Proofreading request failed",
      );
    } finally {
      setProofreadingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      !activeDocument ||
      !supportsProofreading(activeDocument.name) ||
      !proofreadingSettings?.enabled
    ) {
      setProofreadingLoading(false);
      setProofreadingResult(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      void runProofreading().catch(() => {});
    }, 650);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activeDocument?.content,
    activeDocument?.name,
    activeDocument?.relativePath,
    proofreadingSettings?.enabled,
    proofreadingSettings?.language,
    proofreadingSettings?.motherTongue,
    proofreadingSettings?.picky,
    proofreadingSettings?.serverUrl,
    runProofreading,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveAndCompile();
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
        setTikzCanvasOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [compile, saveActiveAndCompile]);

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
    const model = editorRef.current.getModel()!;
    monaco.editor.setModelMarkers(
      model,
      "latexdo",
      relevantDiagnostics.map((diagnostic) => ({
        startLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endLineNumber: diagnostic.endLine ?? diagnostic.line,
        endColumn: diagnostic.endColumn ?? diagnostic.column + 1,
        message: diagnosticMarkerMessage(diagnostic),
        source:
          diagnostic.locationAccuracy === "exact"
            ? "LatexDo analysis"
            : "LaTeX compiler",
        code: diagnostic.code,
        relatedInformation:
          diagnostic.reportedLine && diagnostic.reportedLine !== diagnostic.line
            ? [
                {
                  resource: model.uri,
                  startLineNumber: diagnostic.reportedLine,
                  startColumn: diagnostic.reportedColumn ?? 1,
                  endLineNumber: diagnostic.reportedLine,
                  endColumn: (diagnostic.reportedColumn ?? 1) + 1,
                  message:
                    "LaTeX stopped here after the earlier root-cause token left the document structure invalid.",
                },
              ]
            : undefined,
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
      triggerCharacters: ["\\", "{"],
      provideCompletionItems: async (model, position) => {
        const word = model.getWordUntilPosition(position);
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforePointer = lineContent.substring(0, position.column - 1);
        
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Check if we are inside \cite{...}
        const citeMatch = textBeforePointer.match(/\\(?:cite|citep|citet|parencite|textcite)[a-zA-Z]*\*?(?:\[[^\]]*\])*{([^}]*)$/);
        if (citeMatch) {
          const suggestions: monaco.languages.CompletionItem[] = [];
          const allEntries = flattenEntries(projectEntriesRef.current);
          const bibFiles = allEntries.filter(e => e.name.endsWith('.bib'));
          for (const bib of bibFiles) {
             try {
               const content = await window.latexdo.readFile(projectPathRef.current, bib.path);
               const regex = /@\w+\s*{\s*([^,]+),/g;
               let match;
               while ((match = regex.exec(content)) !== null) {
                 const key = match[1].trim();
                 const start = match.index;
                 const end = content.indexOf('@', start + 1);
                 const block = end === -1 ? content.slice(start) : content.slice(start, end);
                 
                 const titleMatch = block.match(/title\s*=\s*[{"]([^}"]+)[}"]/i);
                 const authorMatch = block.match(/author\s*=\s*[{"]([^}"]+)[}"]/i);
                 const yearMatch = block.match(/year\s*=\s*[{"]([^}"]+)[}"]/i);
                 
                 const detail = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'BibTeX Entry';
                 let doc = '';
                 if (authorMatch) doc += `Author: ${authorMatch[1].replace(/\s+/g, ' ').trim()}\n`;
                 if (yearMatch) doc += `Year: ${yearMatch[1].trim()}`;
                 
                 suggestions.push({
                    label: key,
                    kind: instance.languages.CompletionItemKind.Reference,
                    insertText: key,
                    detail,
                    documentation: doc,
                    range,
                 });
               }
             } catch (e) {
               // Ignore missing/unreadable bib files
             }
          }
          return { suggestions };
        }

        // Check if we are inside \ref{...}
        const refMatch = textBeforePointer.match(/\\(?:ref|cref|Cref|autoref|pageref|eqref)[a-zA-Z]*\*?{([^}]*)$/);
        if (refMatch) {
          const suggestions: monaco.languages.CompletionItem[] = [];
          const allEntries = flattenEntries(projectEntriesRef.current);
          const texFiles = allEntries.filter(e => e.name.endsWith('.tex'));
          
          const openDocs = new Map(documentsRef.current.map(d => [d.path, d.content]));
          
          for (const tex of texFiles) {
             try {
               let content = openDocs.get(tex.path);
               if (content === undefined) {
                 content = await window.latexdo.readFile(projectPathRef.current, tex.path);
               }
               const regex = /\\label\s*{([^}]+)}/g;
               let match;
               while ((match = regex.exec(content)) !== null) {
                 const label = match[1].trim();
                 suggestions.push({
                    label,
                    kind: instance.languages.CompletionItemKind.Reference,
                    insertText: label,
                    detail: `Label from ${tex.name}`,
                    range,
                 });
               }
             } catch (e) {
               // Ignore missing/unreadable tex files
             }
          }
          // Remove duplicates
          const unique = new Map();
          for (const s of suggestions) unique.set(s.label, s);
          return { suggestions: Array.from(unique.values()) };
        }

        // Default snippet completion (triggered by \)
        if (textBeforePointer.endsWith('\\' + word.word) || textBeforePointer.endsWith('\\')) {
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
        }

        return { suggestions: [] };
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
    editorMouseDisposableRef.current?.dispose();
    editorMouseDisposableRef.current = editor.onMouseDown((event) => {
      if (event.event.detail === 2 && event.target.position) {
        void forwardSyncRef.current?.(event.target.position);
      }
    });
    requestAnimationFrame(() => {
      revealPendingSource();
    });
    editor.focus();
  };

  useEffect(
    () => () => {
      editorMouseDisposableRef.current?.dispose();
    },
    [],
  );

  const openProject = async () => {
    const path = await window.latexdo.openProject();
    if (path) {
      await loadProject(path, true, false);
    }
  };

  const createProject = async () => {
    try {
      const path = await window.latexdo.createProject();
      if (path) {
        await loadProject(path, true, false);
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

  const openCreateDialogInDirectory = useCallback(
    (type: "file" | "folder", entry: ProjectEntry) => {
      if (entry.type !== "directory") {
        return;
      }
      setCreatePath(
        createPathInDirectory(
          entry.relativePath,
          type === "file" ? "chapter.tex" : "chapters",
        ),
      );
      setCreateError("");
      setCreateDialog(type);
    },
    [],
  );

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
      activePathRef.current = nextPath;
    }
  };

  const showWelcomePage = () => {
    setWelcomeOpen(true);
    setActivePath("");
    activePathRef.current = "";
    setStatusMessage("Welcome to LatexDo");
  };

  const loadSpellCheckerSettings = useCallback(
    async () => {
      setSpellCheckerLoading(true);
      setSpellCheckerError("");

      try {
        const nextSettings = await window.latexdo.getSpellCheckerSettings();
        setSpellCheckerSettings(nextSettings);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not load spell checker settings";
        setSpellCheckerError(
          message.replace(/^Error invoking remote method '[^']+': /, ""),
        );
      } finally {
        setSpellCheckerLoading(false);
      }
    },
    [],
  );

  const saveSpellCheckerSettings = useCallback(
    async (
      nextSettings: SpellCheckerSettings,
      successMessage?: string,
      options?: { clearWordDraft?: boolean },
    ) => {
      setSpellCheckerLoading(true);
      setSpellCheckerError("");
      try {
        const saved =
          await window.latexdo.updateSpellCheckerSettings(nextSettings);
        setSpellCheckerSettings(saved);
        if (options?.clearWordDraft) {
          setSpellCheckerWordDraft("");
        }
        if (successMessage) {
          setStatusMessage(successMessage);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not save spell checker settings";
        setSpellCheckerError(
          message.replace(/^Error invoking remote method '[^']+': /, ""),
        );
      } finally {
        setSpellCheckerLoading(false);
      }
    },
    [],
  );

  const loadProofreadingSettings = useCallback(async () => {
    setProofreadingError("");
    try {
      const nextSettings = await window.latexdo.getProofreadingSettings();
      setProofreadingSettings(nextSettings);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load proofreading settings";
      setProofreadingError(
        message.replace(/^Error invoking remote method '[^']+': /, ""),
      );
    }
  }, []);

  const saveProofreadingSettings = useCallback(
    async (
      nextSettings: ProofreadingSettings,
      successMessage?: string,
    ) => {
      setProofreadingError("");
      try {
        const saved =
          await window.latexdo.updateProofreadingSettings(nextSettings);
        setProofreadingSettings(saved);
        if (successMessage) {
          setStatusMessage(successMessage);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not save proofreading settings";
        setProofreadingError(
          message.replace(/^Error invoking remote method '[^']+': /, ""),
        );
      }
    },
    [],
  );

  const openSidebar = useCallback((view: SidebarView) => {
    setSidebarVisible(true);
    setActiveSidebar(view);
  }, []);

  const toggleSpellCheckerEnabled = useCallback(
    (enabled: boolean) => {
      if (!spellCheckerSettings) {
        return;
      }

      void saveSpellCheckerSettings(
        {
          ...spellCheckerSettings,
          enabled,
        },
        enabled ? "Spell checker enabled" : "Spell checker disabled",
      );
    },
    [saveSpellCheckerSettings, spellCheckerSettings],
  );

  const toggleSpellCheckerLanguage = useCallback(
    (language: string) => {
      if (!spellCheckerSettings || spellCheckerSettings.usesSystemLanguage) {
        return;
      }

      const selected = spellCheckerSettings.languages.includes(language);
      const nextLanguages = selected
        ? spellCheckerSettings.languages.filter((entry) => entry !== language)
        : [...spellCheckerSettings.languages, language];

      if (!nextLanguages.length) {
        setSpellCheckerError("Select at least one spell-check language.");
        return;
      }

      void saveSpellCheckerSettings(
        {
          ...spellCheckerSettings,
          languages: nextLanguages,
        },
        `Spell checker languages updated`,
      );
    },
    [saveSpellCheckerSettings, spellCheckerSettings],
  );

  const addSpellCheckerWord = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!spellCheckerSettings) {
        return;
      }

      const word = spellCheckerWordDraft.trim();
      if (!word) {
        setSpellCheckerError("Enter a word to add.");
        return;
      }

      const customWords = uniqueWords([
        ...spellCheckerSettings.customWords,
        word,
      ]);
      if (customWords.length === spellCheckerSettings.customWords.length) {
        setSpellCheckerWordDraft("");
        setSpellCheckerError("");
        setStatusMessage(`"${word}" is already in the dictionary`);
        return;
      }

      void saveSpellCheckerSettings(
        {
          ...spellCheckerSettings,
          customWords,
        },
        `Added "${word}" to the dictionary`,
        { clearWordDraft: true },
      );
    },
    [saveSpellCheckerSettings, spellCheckerSettings, spellCheckerWordDraft],
  );

  useEffect(() => {
    void loadSpellCheckerSettings();
    void loadProofreadingSettings();
  }, [loadProofreadingSettings, loadSpellCheckerSettings]);

  useEffect(() => {
    return window.latexdo.onOpenSpellCheckerSettings(() => {
      setSpellCheckerLanguageQuery("");
      setSpellCheckerWordDraft("");
      setSpellCheckerError("");
      setProofreadingError("");
      setSettingsOpen(true);
      void loadSpellCheckerSettings();
      void loadProofreadingSettings();
    });
  }, [loadProofreadingSettings, loadSpellCheckerSettings]);

  useEffect(() => {
    return window.latexdo.onOpenProjectMenu(() => {
      void openProject();
    });
  }, []);

  useEffect(() => {
    return window.latexdo.onCreateFileMenu(() => {
      setCreatePath("chapter.tex");
      setCreateError("");
      setCreateDialog("file");
    });
  }, []);

  useEffect(() => {
    return window.latexdo.onCreateFolderMenu(() => {
      setCreatePath("chapters");
      setCreateError("");
      setCreateDialog("folder");
    });
  }, []);

  const toggleSidebar = () => {
    setSidebarVisible((visible) => !visible);
  };

  const togglePanel = () => {
    setPanelVisible((visible) => !visible);
  };

  const openPanel = useCallback((panel: PanelKind) => {
    setPanelVisible(true);
    setActivePanel(panel);
  }, []);

  const refreshGitStatus = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject) {
      setGitStatus(null);
      return;
    }

    setGitLoading(true);
    try {
      const status = await window.latexdo.getGitStatus(currentProject);
      setGitStatus(status);
    } finally {
      setGitLoading(false);
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    try {
      const result = await window.latexdo.checkForUpdates();
      setUpdateInfo(result);
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  const stageGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectPathRef.current;
      if (!currentProject) return;

      setGitActionBusy(`stage:${relativePath}`);
      try {
        await window.latexdo.stageGitFile(currentProject, relativePath);
        await refreshGitStatus();
        setStatusMessage(`Staged ${relativePath}`);
      } finally {
        setGitActionBusy(null);
      }
    },
    [refreshGitStatus],
  );

  const unstageGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectPathRef.current;
      if (!currentProject) return;

      setGitActionBusy(`unstage:${relativePath}`);
      try {
        await window.latexdo.unstageGitFile(currentProject, relativePath);
        await refreshGitStatus();
        setStatusMessage(`Unstaged ${relativePath}`);
      } finally {
        setGitActionBusy(null);
      }
    },
    [refreshGitStatus],
  );

  const commitGitChanges = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    setGitActionBusy("commit");
    try {
      await window.latexdo.commitGit(currentProject, gitCommitMessage);
      setGitCommitMessage("");
      await refreshGitStatus();
      setStatusMessage("Created commit");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Git commit failed",
      );
    } finally {
      setGitActionBusy(null);
    }
  }, [gitCommitMessage, refreshGitStatus]);

  const previewGitDiff = useCallback(async (relativePath: string) => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    setGitActionBusy(`diff:${relativePath}`);
    try {
      const preview = await window.latexdo.getGitDiff(currentProject, relativePath);
      setGitDiffPreview(preview);
    } finally {
      setGitActionBusy(null);
    }
  }, []);

  const discardGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectPathRef.current;
      if (!currentProject) return;

      setGitActionBusy(`discard:${relativePath}`);
      try {
        await window.latexdo.discardGitFile(currentProject, relativePath);
        if (activePathRef.current.endsWith(relativePath)) {
          await refreshProject(currentProject);
        }
        await refreshGitStatus();
        if (gitDiffPreview?.path === relativePath) {
          setGitDiffPreview(null);
        }
        setStatusMessage(`Discarded changes in ${relativePath}`);
      } finally {
        setGitActionBusy(null);
      }
    },
    [gitDiffPreview?.path, refreshGitStatus, refreshProject],
  );

  const stageAllGitEntries = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    setGitActionBusy("stage-all");
    try {
      await window.latexdo.stageAllGit(currentProject);
      await refreshGitStatus();
      setStatusMessage("Staged all changes");
    } finally {
      setGitActionBusy(null);
    }
  }, [refreshGitStatus]);

  const unstageAllGitEntries = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    setGitActionBusy("unstage-all");
    try {
      await window.latexdo.unstageAllGit(currentProject);
      await refreshGitStatus();
      setStatusMessage("Unstaged all changes");
    } finally {
      setGitActionBusy(null);
    }
  }, [refreshGitStatus]);

  const discardAllGitEntries = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    setGitActionBusy("discard-all");
    try {
      await window.latexdo.discardAllGit(currentProject);
      setGitDiffPreview(null);
      await refreshGitStatus();
      setStatusMessage("Discarded all unstaged changes");
    } finally {
      setGitActionBusy(null);
    }
  }, [refreshGitStatus]);

  const openGitCommitDetails = useCallback(async (hash: string, targetPath?: string) => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    setGitActionBusy(`commit:${hash}`);
    try {
      const details = await window.latexdo.getGitCommitDetails(currentProject, hash);
      setGitCommitDetails(details);
      setGitCommitDetailsTargetPath(targetPath ?? null);
    } finally {
      setGitActionBusy(null);
    }
  }, []);

  const openGitCommitRevisionDiff = useCallback(
    async (hash: string, relativePath: string) => {
      const currentProject = projectPathRef.current;
      if (!currentProject) return;

      setGitActionBusy(`commit-diff:${hash}:${relativePath}`);
      try {
        const snapshot = await window.latexdo.getGitCommitFileDiff(
          currentProject,
          relativePath,
          hash,
        );
        setWelcomeOpen(false);
        setActivePath("");
        activePathRef.current = "";
        setGitDiffSession({
          ...snapshot,
          label: `${fileName(relativePath)} (${hash.slice(0, 7)})`,
        });
        setStatusMessage(`Opened ${relativePath} at ${hash.slice(0, 7)}`);
      } finally {
        setGitActionBusy(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeSidebar !== "sourceControl") {
      return;
    }
    void refreshGitStatus();
  }, [activeSidebar, projectPath, refreshGitStatus]);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  useEffect(() => {
    if (activeSidebar !== "sourceControl" || !projectPath) {
      return;
    }

    let cancelled = false;
    const loadHistory = async () => {
      try {
        const [repoHistory, fileHistory] = await Promise.all([
          window.latexdo.getGitHistory(projectPath),
          activeDocument
            ? window.latexdo.getGitHistory(projectPath, activeDocument.relativePath)
            : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setGitRepoHistory(repoHistory);
          setGitFileHistory(fileHistory);
        }
      } catch {
        if (!cancelled) {
          setGitRepoHistory(null);
          setGitFileHistory(null);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [activeSidebar, projectPath, activeDocument]);

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
    if (hideProjectEntries) {
      setActivePath("");
      activePathRef.current = "";
      setPreviewVisible(false);
      return;
    }
    if (!activePath) {
      const nextPath = documents[0]?.path ?? "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
    }
  };

  const openDiagnostic = async (diagnostic: Diagnostic) => {
    const targetDiagnosticPath = normalizeRelativePath(
      diagnostic.file || rootFileRef.current,
    );
    if (!targetDiagnosticPath) {
      return;
    }

    const entry = flattenEntries(projectEntriesRef.current).find(
      (item) =>
        item.type === "file" &&
        (normalizeRelativePath(item.relativePath) === targetDiagnosticPath ||
          item.name === fileName(targetDiagnosticPath)),
    );
    if (!entry) {
      setStatusMessage(
        `Could not locate ${targetDiagnosticPath} in the open project`,
      );
      return;
    }

    pendingSourceRef.current = {
      path: entry.path,
      line: Math.max(1, diagnostic.line),
      column: Math.max(1, diagnostic.column),
      endLine: diagnostic.endLine,
      endColumn: diagnostic.endColumn,
      word: undefined,
    };

    await openDocument(entry);
    requestAnimationFrame(() => {
      revealPendingSource();
    });
    setStatusMessage(`Opened ${diagnosticLocationLabel(diagnostic, rootFileRef.current)}`);
  };

  const openGitFile = useCallback(
    async (relativePath: string) => {
      setGitDiffSession(null);
      const entry = allProjectEntries.find(
        (item) => item.type === "file" && item.relativePath === relativePath,
      );
      if (!entry) {
        return;
      }
      await openDocument(entry);
    },
    [allProjectEntries, openDocument],
  );

  const openGitDiffEditor = useCallback(
    async (relativePath: string) => {
      const currentProject = projectPathRef.current;
      if (!currentProject) return;

      setGitActionBusy(`editor-diff:${relativePath}`);
      try {
        const snapshot = await window.latexdo.getGitEditorDiff(
          currentProject,
          relativePath,
        );
        setWelcomeOpen(false);
        setActivePath("");
        activePathRef.current = "";
        setGitDiffSession({
          ...snapshot,
          label: `${fileName(relativePath)} (Diff)`,
        });
        setStatusMessage(`Opened diff for ${relativePath}`);
      } finally {
        setGitActionBusy(null);
      }
    },
    [],
  );

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
            className={`icon-button workbench-toggle ${
              panelVisible && activePanel === "problems" ? "active" : ""
            }`}
            onClick={() => openPanel("problems")}
            title="Open problems"
            aria-label="Open problems panel"
            aria-pressed={panelVisible && activePanel === "problems"}
          >
            <CircleAlert size={16} />
            {diagnostics.length ? (
              <span className="icon-button-badge">{diagnostics.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={`icon-button ${panelVisible ? "active" : ""}`}
            onClick={togglePanel}
            title="Toggle bottom panel"
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
              className={`activity-button ${
                sidebarVisible && activeSidebar === "explorer" ? "active" : ""
              }`}
              onClick={() => openSidebar("explorer")}
              title="Explorer"
            >
              <Files size={22} />
            </button>
            <button
              className={`activity-button ${
                sidebarVisible && activeSidebar === "sourceControl" ? "active" : ""
              }`}
              onClick={() => openSidebar("sourceControl")}
              title="Source control"
            >
              <GitBranch size={21} />
            </button>
            <button
              className={`activity-button ${tikzCanvasOpen ? "active" : ""}`}
              onClick={() => setTikzCanvasOpen((open) => !open)}
              title="Draw"
            >
              <Pencil size={21} />
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
              <span>
                {activeSidebar === "explorer"
                  ? "EXPLORER"
                  : "SOURCE CONTROL"}
              </span>
              <div>
                {activeSidebar === "explorer" ? (
                  <>
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
                  </>
                ) : activeSidebar === "sourceControl" ? (
                  <button
                    className="small-icon"
                    onClick={() => void refreshGitStatus()}
                    title="Refresh Git status"
                  >
                    <RefreshCw size={14} />
                  </button>
                ) : null}
              </div>
            </div>
            {activeSidebar === "explorer" ? (
              <>
                <button className="project-heading" onClick={openProject}>
                  <ChevronDown size={13} />
                  <span>{projectName.toUpperCase()}</span>
                  <FolderOpen size={14} />
                </button>
                <div className="file-tree">
                  {hideProjectEntries ? null : (
                    <FileTree
                      entries={projectEntries}
                      activePath={activePath}
                      onOpen={openDocument}
                      onCompileFile={(entry) => void compileEntry(entry)}
                      onSetRootFile={(entry) => {
                        setRootFile(entry.relativePath);
                        rootFileRef.current = entry.relativePath;
                        setStatusMessage(`Main file set to ${entry.relativePath}`);
                      }}
                      onMoveEntry={(sourcePath, destination) =>
                        void moveEntry(sourcePath, destination)
                      }
                      onCreateFileInDirectory={(entry) =>
                        openCreateDialogInDirectory("file", entry)
                      }
                      onCreateFolderInDirectory={(entry) =>
                        openCreateDialogInDirectory("folder", entry)
                      }
                    />
                  )}
                </div>
              </>
            ) : activeSidebar === "sourceControl" ? (
              <div className="sidebar-panel">
                <div className="sidebar-card">
                  <strong>{gitStatus?.branch || "No repository"}</strong>
                  <span>
                    {gitLoading
                      ? "Refreshing repository state…"
                      : gitStatus?.isRepo
                        ? `${modifiedFiles} changed file${modifiedFiles === 1 ? "" : "s"}`
                        : "Open a Git repository to see source control here."}
                  </span>
                </div>
                {gitStatus?.isRepo ? (
                  <div className="sidebar-commit-box">
                    <div className="sidebar-bulk-actions">
                      <button
                        className="sidebar-mini-action subtle"
                        onClick={() => void stageAllGitEntries()}
                        disabled={!unstagedGitEntries.length || gitActionBusy === "stage-all"}
                      >
                        {gitActionBusy === "stage-all" ? "Working…" : "Stage All"}
                      </button>
                      <button
                        className="sidebar-mini-action subtle"
                        onClick={() => void unstageAllGitEntries()}
                        disabled={!stagedGitEntries.length || gitActionBusy === "unstage-all"}
                      >
                        {gitActionBusy === "unstage-all" ? "Working…" : "Unstage All"}
                      </button>
                      <button
                        className="sidebar-mini-action subtle"
                        onClick={() => void discardAllGitEntries()}
                        disabled={!unstagedGitEntries.length || gitActionBusy === "discard-all"}
                      >
                        {gitActionBusy === "discard-all" ? "Working…" : "Discard All"}
                      </button>
                    </div>
                    <textarea
                      value={gitCommitMessage}
                      onChange={(event) => setGitCommitMessage(event.target.value)}
                      placeholder="Commit message"
                    />
                    <button
                      className="sidebar-primary-action"
                      onClick={() => void commitGitChanges()}
                      disabled={gitActionBusy === "commit" || !gitCommitMessage.trim()}
                    >
                      {gitActionBusy === "commit" ? "Committing…" : "Commit"}
                    </button>
                  </div>
                ) : null}
                <div className="sidebar-list">
                  {gitStatus?.isRepo ? (
                    <>
                      {gitStatus.entries.length ? (
                        <>
                          <div className="sidebar-section-label">
                            Staged Changes ({stagedGitEntries.length})
                          </div>
                          {stagedGitEntries.length ? (
                            stagedGitEntries.map((entry) => {
                              const hasWorktreeChange = Boolean(entry.workingTreeStatus);
                              return (
                                <div
                                  key={`${entry.path}:${entry.indexStatus}:${entry.workingTreeStatus}:staged`}
                                  className="sidebar-item static"
                                >
                                  <strong>{entry.path}</strong>
                                  <span>
                                    {entry.indexStatus || "·"}
                                    {entry.workingTreeStatus || "·"}
                                  </span>
                                  <div className="sidebar-item-actions spread">
                                    <button
                                      className="sidebar-mini-action subtle"
                                      onClick={() => void previewGitDiff(entry.path)}
                                      disabled={gitActionBusy === `diff:${entry.path}`}
                                    >
                                      {gitActionBusy === `diff:${entry.path}`
                                        ? "Loading…"
                                        : "Diff"}
                                    </button>
                                    <div className="sidebar-item-actions">
                                      <button
                                        className="sidebar-mini-action subtle"
                                        onClick={() => void openGitDiffEditor(entry.path)}
                                        disabled={
                                          gitActionBusy === `editor-diff:${entry.path}`
                                        }
                                      >
                                        {gitActionBusy === `editor-diff:${entry.path}`
                                          ? "Opening…"
                                          : "Open"}
                                      </button>
                                      <button
                                        className="sidebar-mini-action subtle"
                                        onClick={() => void discardGitEntry(entry.path)}
                                        disabled={
                                          !hasWorktreeChange ||
                                          gitActionBusy === `discard:${entry.path}`
                                        }
                                      >
                                        {gitActionBusy === `discard:${entry.path}`
                                          ? "Discarding…"
                                          : "Discard"}
                                      </button>
                                      <button
                                        className="sidebar-mini-action"
                                        onClick={() => void unstageGitEntry(entry.path)}
                                        disabled={
                                          gitActionBusy === `unstage:${entry.path}`
                                        }
                                      >
                                        {gitActionBusy === `unstage:${entry.path}`
                                          ? "Working…"
                                          : "Unstage"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="sidebar-empty-state compact">
                              No staged changes.
                            </div>
                          )}
                          <div className="sidebar-section-label">
                            Changes ({unstagedGitEntries.length})
                          </div>
                          {unstagedGitEntries.length ? (
                            unstagedGitEntries.map((entry) => (
                              <div
                                key={`${entry.path}:${entry.indexStatus}:${entry.workingTreeStatus}:unstaged`}
                                className="sidebar-item static"
                              >
                                <strong>{entry.path}</strong>
                                <span>
                                  {entry.indexStatus || "·"}
                                  {entry.workingTreeStatus || "·"}
                                </span>
                                <div className="sidebar-item-actions spread">
                                  <button
                                    className="sidebar-mini-action subtle"
                                    onClick={() => void previewGitDiff(entry.path)}
                                    disabled={gitActionBusy === `diff:${entry.path}`}
                                  >
                                    {gitActionBusy === `diff:${entry.path}`
                                      ? "Loading…"
                                      : "Diff"}
                                  </button>
                                  <div className="sidebar-item-actions">
                                    <button
                                      className="sidebar-mini-action subtle"
                                      onClick={() => void openGitDiffEditor(entry.path)}
                                      disabled={
                                        gitActionBusy === `editor-diff:${entry.path}`
                                      }
                                    >
                                      {gitActionBusy === `editor-diff:${entry.path}`
                                        ? "Opening…"
                                        : "Open"}
                                    </button>
                                    <button
                                      className="sidebar-mini-action subtle"
                                      onClick={() => void discardGitEntry(entry.path)}
                                      disabled={
                                        gitActionBusy === `discard:${entry.path}`
                                      }
                                    >
                                      {gitActionBusy === `discard:${entry.path}`
                                        ? "Discarding…"
                                        : "Discard"}
                                    </button>
                                    <button
                                      className="sidebar-mini-action"
                                      onClick={() => void stageGitEntry(entry.path)}
                                      disabled={gitActionBusy === `stage:${entry.path}`}
                                    >
                                      {gitActionBusy === `stage:${entry.path}`
                                        ? "Working…"
                                        : "Stage"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="sidebar-empty-state compact">
                              No unstaged changes.
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="sidebar-empty-state">
                          Working tree is clean.
                        </div>
                      )}
                      <div className="sidebar-section-label">Diff Preview</div>
                      <div className="sidebar-diff-preview">
                        {gitDiffPreview ? (
                          <>
                            <button
                              className="sidebar-diff-open"
                              onClick={() => void openGitFile(gitDiffPreview.path)}
                            >
                              {gitDiffPreview.path}
                            </button>
                            <pre>{gitDiffPreview.diff}</pre>
                          </>
                        ) : (
                          <div className="sidebar-empty-state">
                            Select Diff on a changed file to inspect it here.
                            </div>
                          )}
                      </div>
                      <div className="sidebar-section-label">Repository History</div>
                      <div className="sidebar-list">
                        {gitRepoHistory?.commits.length ? (
                          gitRepoHistory.commits.slice(0, 8).map((commit) => (
                            <button
                              key={commit.hash}
                              className="sidebar-item"
                              onClick={() => void openGitCommitDetails(commit.hash)}
                            >
                              <strong>{commit.subject}</strong>
                              <span>
                                {commit.shortHash} · {commit.author} · {commit.date}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="sidebar-empty-state compact">
                            No repository history available.
                          </div>
                        )}
                      </div>
                      {activeDocument ? (
                        <>
                          <div className="sidebar-section-label">
                            File History ({activeDocument.relativePath})
                          </div>
                          <div className="sidebar-list">
                            {gitFileHistory?.commits.length ? (
                              gitFileHistory.commits.slice(0, 6).map((commit) => (
                                <div
                                  key={`${commit.hash}:${activeDocument.relativePath}`}
                                  className="sidebar-item static"
                                >
                                  <strong>{commit.subject}</strong>
                                  <span>
                                    {commit.shortHash} · {commit.author} · {commit.date}
                                  </span>
                                  <div className="sidebar-item-actions">
                                    <button
                                      className="sidebar-mini-action subtle"
                                      onClick={() =>
                                        void openGitCommitDetails(
                                          commit.hash,
                                          activeDocument.relativePath,
                                        )
                                      }
                                    >
                                      Details
                                    </button>
                                    <button
                                      className="sidebar-mini-action subtle"
                                      onClick={() =>
                                        void openGitCommitRevisionDiff(
                                          commit.hash,
                                          activeDocument.relativePath,
                                        )
                                      }
                                      disabled={
                                        gitActionBusy ===
                                        `commit-diff:${commit.hash}:${activeDocument.relativePath}`
                                      }
                                    >
                                      {gitActionBusy ===
                                      `commit-diff:${commit.hash}:${activeDocument.relativePath}`
                                        ? "Opening…"
                                        : "Open Diff"}
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="sidebar-empty-state compact">
                                No file history for the active document.
                              </div>
                            )}
                          </div>
                        </>
                      ) : null}
                      <div className="sidebar-section-label">Commit Details</div>
                      <div className="sidebar-diff-preview">
                        {gitCommitDetails ? (
                          <>
                            <strong>{gitCommitDetails.summary || gitCommitDetails.hash}</strong>
                            {gitCommitDetailsTargetPath ? (
                              <div className="sidebar-item-actions">
                                <button
                                  className="sidebar-mini-action subtle"
                                  onClick={() =>
                                    void openGitCommitRevisionDiff(
                                      gitCommitDetails.hash,
                                      gitCommitDetailsTargetPath,
                                    )
                                  }
                                  disabled={
                                    gitActionBusy ===
                                    `commit-diff:${gitCommitDetails.hash}:${gitCommitDetailsTargetPath}`
                                  }
                                >
                                  {gitActionBusy ===
                                  `commit-diff:${gitCommitDetails.hash}:${gitCommitDetailsTargetPath}`
                                    ? "Opening…"
                                    : "Open This Revision As Diff"}
                                </button>
                              </div>
                            ) : null}
                            <pre>{gitCommitDetails.body || gitCommitDetails.hash}</pre>
                          </>
                        ) : (
                          <div className="sidebar-empty-state compact">
                            Select a commit to inspect it here.
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="sidebar-empty-state">
                      {gitStatus?.error || "Git status is unavailable."}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </aside>
        ) : null}

        <main className="main-area">
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
            {gitDiffSession ? (
              <button
                className={`document-tab ${!showWelcome && !activeDocument ? "active" : ""}`}
                onClick={() => {
                  setWelcomeOpen(false);
                  setActivePath("");
                  activePathRef.current = "";
                }}
              >
                <GitBranch size={14} className="tab-file-icon" />
                <span>{gitDiffSession.label}</span>
                <span
                  className="tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    setGitDiffSession(null);
                  }}
                >
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
                    activePathRef.current = document.path;
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
            <section className={`source-pane ${showWelcome ? "welcome-only" : ""}`}>
              {!showWelcome && !showBlankWorkspace ? (
                <div className="source-toolbar">
                  <div className="pane-label">TEX</div>
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
              ) : null}
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
              ) : gitDiffSession ? (
                <DiffEditor
                  key={gitDiffSession.path}
                  original={gitDiffSession.original}
                  modified={gitDiffSession.modified}
                  language={languageFor(gitDiffSession.path)}
                  theme="latexdo-dark"
                  beforeMount={configureMonaco}
                  options={{
                    readOnly: true,
                    originalEditable: false,
                    automaticLayout: true,
                    renderSideBySide: true,
                    fontFamily:
                      "'SFMono-Regular', 'Cascadia Code', 'Fira Code', Menlo, monospace",
                    fontSize: settings.editorFontSize,
                    scrollBeyondLastLine: false,
                    minimap: { enabled: false },
                    renderOverviewRuler: false,
                  }}
                />
              ) : (
                <div className="empty-editor">
                  <div className="empty-logo">L</div>
                  <h2>{showBlankWorkspace ? "No project is open" : "No editor is open"}</h2>
                  <button onClick={showBlankWorkspace ? openProject : showWelcomePage}>
                    {showBlankWorkspace ? "Open Folder" : "Show Welcome"}
                  </button>
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
                      <span className="pane-label">PDF</span>
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
                      <button onClick={() => void downloadPdf()} title="Download PDF">
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="pdf-surface">
                    {pdfData ? (
                      <PdfPreview
                        data={pdfData}
                        scale={pdfScale}
                        target={pdfTarget}
                        onNavigate={(location) => {
                          void handleBackwardSync(location);
                        }}
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

          {tikzCanvasOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">TikZ Drawing Canvas</span>
                <button className="tikz-modal-close" onClick={() => setTikzCanvasOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="tikz-modal-content">
                <TikzCanvas
                  onInsertCode={(code) => {
                    if (!activeDocument) {
                      alert("Please open a .tex document first to insert the code.");
                      return;
                    }
                    const editor = editorRef.current;
                    if (editor) {
                      const model = editor.getModel();
                      if (model) {
                        const position = editor.getPosition();
                        const lineNumber = position?.lineNumber ?? model.getLineCount();
                        const column = position?.column ?? 1;
                        editor.executeEdits("", [
                          {
                            range: new monaco.Range(lineNumber, column, lineNumber, column),
                            text: "\n" + code + "\n",
                          },
                        ]);
                      }
                    }
                    setTikzCanvasOpen(false);
                  }}
                />
              </div>
            </div>
          )}

          {panelVisible ? (
            <section className="bottom-panel">
              <div className="panel-tabs">
                <button
                  className={activePanel === "problems" ? "active" : ""}
                  onClick={() => openPanel("problems")}
                >
                  <CircleAlert size={13} />
                  PROBLEMS
                  {diagnostics.length ? (
                    <span className="count-badge">{diagnostics.length}</span>
                  ) : null}
                </button>
                <button
                  className={activePanel === "output" ? "active" : ""}
                  onClick={() => openPanel("output")}
                >
                  <Command size={13} />
                  OUTPUT
                </button>
                <button
                  className={activePanel === "terminal" ? "active" : ""}
                  onClick={() => openPanel("terminal")}
                >
                  <TerminalSquare size={13} />
                  TERMINAL
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
                <section
                  className={`panel-pane ${
                    activePanel === "problems" ? "" : "hidden"
                  }`}
                >
                  {diagnostics.length ? (
                    <>
                      <div className="panel-summary">
                        <span>
                          <CircleAlert size={13} />
                          {errors} errors
                        </span>
                        <span>
                          <AlertCircle size={13} />
                          {warnings} warnings
                        </span>
                        {cascadingErrors ? (
                          <span>{cascadingErrors} secondary effects</span>
                        ) : null}
                      </div>
                      {primaryDiagnostic ? (
                        <div className="diagnostic-analysis-hero">
                          <div className="diagnostic-analysis-kicker">
                            <Code2 size={13} />
                            FIX THIS FIRST
                            <span>
                              {diagnosticAccuracyLabel(primaryDiagnostic)}
                            </span>
                          </div>
                          <div className="diagnostic-analysis-body">
                            <div>
                              <strong>
                                {diagnosticHeadline(primaryDiagnostic)}
                              </strong>
                              <p>
                                {primaryDiagnostic.detail ??
                                  primaryDiagnostic.message}
                              </p>
                              {primaryDiagnostic.reportedLine &&
                              primaryDiagnostic.reportedLine !==
                                primaryDiagnostic.line ? (
                                <small>
                                  LaTeX stopped at line{" "}
                                  {primaryDiagnostic.reportedLine}, but source
                                  analysis traced the cause back to{" "}
                                  {diagnosticLocationLabel(
                                    primaryDiagnostic,
                                    rootFile,
                                  )}
                                  .
                                </small>
                              ) : (
                                <small>
                                  The first actionable failure is at{" "}
                                  {diagnosticLocationLabel(
                                    primaryDiagnostic,
                                    rootFile,
                                  )}
                                  .
                                </small>
                              )}
                            </div>
                            <div className="diagnostic-analysis-buttons">
                              <button
                                className="sidebar-mini-action"
                                onClick={() =>
                                  void openDiagnostic(primaryDiagnostic)
                                }
                              >
                                Go to root cause
                              </button>
                              {primaryDiagnostic.fixes?.[0] ? (
                                <button
                                  className="sidebar-mini-action primary"
                                  onClick={() =>
                                    void applyLatexDiagnosticFix(
                                      primaryDiagnostic,
                                      primaryDiagnostic.fixes![0],
                                    )
                                  }
                                >
                                  Apply suggested fix
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {diagnostics.map((diagnostic, index) => {
                        const location = diagnosticLocationLabel(
                          diagnostic,
                          rootFile,
                        );
                        return (
                          <article
                            className={`diagnostic-row-card ${diagnostic.severity} ${
                              diagnostic.isPrimary ? "primary-cause" : ""
                            } ${diagnostic.isCascade ? "cascade" : ""}`}
                            key={`${diagnostic.file}-${diagnostic.line}-${index}`}
                          >
                            <button
                              className="diagnostic-row"
                              onClick={() => void openDiagnostic(diagnostic)}
                            >
                              {diagnostic.severity === "error" ? (
                                <CircleAlert size={16} className="error-icon" />
                              ) : (
                                <AlertCircle size={16} className="warning-icon" />
                              )}
                              <span className="diagnostic-copy">
                                <span className="diagnostic-heading">
                                  <span className="diagnostic-message">
                                    {diagnosticHeadline(diagnostic)}
                                  </span>
                                  {diagnostic.isPrimary ? (
                                    <span className="diagnostic-role root">
                                      Root cause
                                    </span>
                                  ) : null}
                                  {diagnostic.isCascade ? (
                                    <span className="diagnostic-role cascade">
                                      Secondary effect
                                    </span>
                                  ) : null}
                                  <span
                                    className={`diagnostic-accuracy ${
                                      diagnostic.locationAccuracy ?? "line"
                                    }`}
                                  >
                                    {diagnosticAccuracyLabel(diagnostic)}
                                  </span>
                                </span>
                                {diagnostic.detail ? (
                                  <span className="diagnostic-detail">
                                    {diagnostic.detail}
                                  </span>
                                ) : null}
                                {diagnostic.originReason ? (
                                  <span className="diagnostic-origin-reason">
                                    <strong>Why this location:</strong>{" "}
                                    {diagnostic.originReason}
                                  </span>
                                ) : null}
                                {diagnostic.cascadeReason ? (
                                  <span className="diagnostic-cascade-reason">
                                    <strong>Why this is secondary:</strong>{" "}
                                    {diagnostic.cascadeReason}
                                  </span>
                                ) : null}
                                {diagnostic.reportedLine &&
                                diagnostic.reportedLine !== diagnostic.line ? (
                                  <span className="diagnostic-detection-location">
                                    <strong>Root cause:</strong> {location}
                                    <span>
                                      LaTeX stopped later at{" "}
                                      {diagnostic.file || rootFile}:
                                      {diagnostic.reportedLine}:
                                      {diagnostic.reportedColumn ?? 1}
                                    </span>
                                  </span>
                                ) : null}
                                {diagnostic.sourceContext?.length ? (
                                  <span className="diagnostic-context">
                                    {diagnostic.sourceContext.map((contextLine) => (
                                      <span
                                        className={`diagnostic-context-line ${
                                          contextLine.focus ? "focus" : ""
                                        }`}
                                        key={contextLine.line}
                                      >
                                        <span className="diagnostic-context-number">
                                          {contextLine.line}
                                        </span>
                                        <code>
                                          {diagnosticContextContent(
                                            diagnostic,
                                            contextLine.text,
                                            contextLine.focus,
                                          )}
                                        </code>
                                      </span>
                                    ))}
                                  </span>
                                ) : diagnostic.sourceLine ? (
                                  <span className="diagnostic-source-line">
                                    {diagnostic.sourceLine}
                                  </span>
                                ) : null}
                                {diagnostic.suggestion ? (
                                  <span className="diagnostic-suggestion">
                                    <strong>How to fix:</strong>{" "}
                                    {diagnostic.suggestion}
                                  </span>
                                ) : null}
                                <span className="diagnostic-compiler-message">
                                  Compiler: {diagnostic.message}
                                </span>
                              </span>
                              <span className="diagnostic-location">
                                {location}
                              </span>
                            </button>
                            <div className="diagnostic-actions">
                              <span>
                                {diagnostic.source === "proofread"
                                  ? "Writing analysis"
                                  : diagnostic.isPrimary
                                    ? "Primary LaTeX cause"
                                    : diagnostic.isCascade
                                      ? "Compiler consequence"
                                      : "LaTeX analysis"}
                              </span>
                              <div>
                                <button
                                  className="sidebar-mini-action"
                                  onClick={() => void openDiagnostic(diagnostic)}
                                >
                                  Go to {location}
                                </button>
                                {diagnostic.replacements?.length ? (
                                  <button
                                    className="sidebar-mini-action subtle"
                                    onClick={() =>
                                      applyDiagnosticReplacement(diagnostic)
                                    }
                                  >
                                    Apply "{diagnostic.replacements[0]}"
                                  </button>
                                ) : null}
                                {diagnostic.fixes?.map((fix) => (
                                  <button
                                    className="sidebar-mini-action primary"
                                    key={`${fix.line}-${fix.column}-${fix.title}`}
                                    title={`${fix.confidence}% confidence`}
                                    onClick={() =>
                                      void applyLatexDiagnosticFix(
                                        diagnostic,
                                        fix,
                                      )
                                    }
                                  >
                                    {fix.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </>
                  ) : (
                    <div className="panel-empty">
                      <CircleCheck size={16} />
                      No problems detected
                    </div>
                  )}
                </section>
                <section
                  className={`panel-pane ${activePanel === "output" ? "" : "hidden"}`}
                >
                  <pre className="build-output">
                    {compileResult?.output || "Compile the project to see build output."}
                  </pre>
                </section>
                {activePanel === "terminal" ? (
                  <section className="panel-pane panel-pane-terminal">
                    <TerminalPanel cwd={projectPath} active />
                  </section>
                ) : null}
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
          {updateInfo?.updateAvailable ? (
            <button onClick={() => setSettingsOpen(true)}>
              <ExternalLink size={13} />
              Update {updateInfo.latestVersion}
            </button>
          ) : null}
          <button onClick={() => openPanel("problems")}>
            <CircleAlert size={13} /> {errors}
          </button>
          <button onClick={() => openPanel("problems")}>
            <AlertCircle size={13} /> {warnings}
          </button>
          <span className="status-message">{statusMessage}</span>
        </div>
        <div>
          <span>{activeDocument ? "LaTeX" : "Plain Text"}</span>
          <span>UTF-8</span>
          <span>Spaces: 2</span>
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
                <p>One place for editor, compiler, spell checker, grammar, and updates.</p>
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

              <label className="settings-row settings-toggle">
                <span>
                  <strong>Check spelling while typing</strong>
                  <small>
                    Show misspellings directly in editable inputs across the app.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={spellCheckerSettings?.enabled ?? true}
                  onChange={(event) =>
                    toggleSpellCheckerEnabled(event.target.checked)
                  }
                  disabled={spellCheckerLoading || !spellCheckerSettings}
                />
              </label>

              <div className="settings-row settings-row-stack">
                <span>
                  <strong>Spell checker languages</strong>
                  <small>
                    {spellCheckerSettings?.usesSystemLanguage
                      ? "macOS uses the native spell checker and automatically detects language."
                      : "Choose one or more dictionaries for Windows and Linux spell checking."}
                  </small>
                </span>
                {spellCheckerSettings?.usesSystemLanguage ? (
                  <div className="spellchecker-note">
                    Language selection is controlled by the system spell checker on macOS.
                  </div>
                ) : (
                  <div className="spellchecker-language-panel">
                    <input
                      type="text"
                      value={spellCheckerLanguageQuery}
                      onChange={(event) =>
                        setSpellCheckerLanguageQuery(event.target.value)
                      }
                      placeholder="Filter languages"
                      spellCheck={false}
                      disabled={spellCheckerLoading || !spellCheckerSettings}
                    />
                    <div className="spellchecker-language-list">
                      {filteredSpellCheckerLanguages.length ? (
                        filteredSpellCheckerLanguages.map((language) => (
                          <label key={language} className="spellchecker-language-option">
                            <input
                              type="checkbox"
                              checked={
                                spellCheckerSettings?.languages.includes(language) ??
                                false
                              }
                              onChange={() => toggleSpellCheckerLanguage(language)}
                              disabled={
                                spellCheckerLoading || !spellCheckerSettings
                              }
                            />
                            <span>{language}</span>
                          </label>
                        ))
                      ) : (
                        <div className="spellchecker-note compact">
                          No language matches that filter.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="settings-row settings-row-stack">
                <span>
                  <strong>Custom words</strong>
                  <small>
                    Add project-specific terms, package names, and citation keys so they stop showing as misspellings.
                  </small>
                </span>
                <form className="spellchecker-word-form" onSubmit={addSpellCheckerWord}>
                  <input
                    type="text"
                    value={spellCheckerWordDraft}
                    onChange={(event) => setSpellCheckerWordDraft(event.target.value)}
                    placeholder="Add a custom word"
                    spellCheck={false}
                    disabled={spellCheckerLoading || !spellCheckerSettings}
                  />
                  <button
                    type="submit"
                    className="dialog-submit"
                    disabled={spellCheckerLoading || !spellCheckerSettings}
                  >
                    Add word
                  </button>
                </form>
                <div className="spellchecker-chip-list">
                  {(spellCheckerSettings?.customWords ?? []).length ? (
                    (spellCheckerSettings?.customWords ?? []).map((word) => (
                      <span key={word} className="spellchecker-chip">
                        {word}
                      </span>
                    ))
                  ) : (
                    <div className="spellchecker-note compact">
                      No custom words added yet.
                    </div>
                  )}
                </div>
              </div>

              <label className="settings-row settings-toggle">
                <span>
                  <strong>Grammar and style checking</strong>
                  <small>
                    Run LanguageTool-compatible proofreading on natural-language text while ignoring LaTeX commands, math, and citations.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={proofreadingSettings?.enabled ?? true}
                  onChange={(event) => {
                    if (!proofreadingSettings) {
                      return;
                    }
                    void saveProofreadingSettings(
                      {
                        ...proofreadingSettings,
                        enabled: event.target.checked,
                      },
                      event.target.checked
                        ? "Grammar checker enabled"
                        : "Grammar checker disabled",
                    );
                  }}
                  disabled={!proofreadingSettings}
                />
              </label>

              <div className="settings-row settings-row-stack">
                <span>
                  <strong>Proofreading service</strong>
                  <small>
                    Use the public LanguageTool API by default, or point LatexDo to your own compatible server.
                  </small>
                </span>
                <div className="spellchecker-language-panel">
                  <input
                    type="text"
                    value={proofreadingSettings?.serverUrl ?? ""}
                    onChange={(event) => {
                      setProofreadingSettings((current) =>
                        current
                          ? { ...current, serverUrl: event.target.value }
                          : current,
                      );
                    }}
                    placeholder="https://api.languagetool.org/v2/check"
                    spellCheck={false}
                    disabled={!proofreadingSettings}
                  />
                  <div className="spellchecker-grid">
                    <label className="spellchecker-field">
                      <span>Language</span>
                      <select
                        value={proofreadingSettings?.language ?? "auto"}
                        onChange={(event) => {
                          setProofreadingSettings((current) =>
                            current
                              ? { ...current, language: event.target.value }
                              : current,
                          );
                        }}
                        disabled={!proofreadingSettings}
                      >
                        <option value="auto">Automatic</option>
                        <option value="en-US">English (US)</option>
                        <option value="en-GB">English (UK)</option>
                        <option value="fr">French</option>
                        <option value="de">German</option>
                        <option value="es">Spanish</option>
                        <option value="it">Italian</option>
                        <option value="pt">Portuguese</option>
                      </select>
                    </label>
                    <label className="spellchecker-field">
                      <span>Mother tongue</span>
                      <input
                        type="text"
                        value={proofreadingSettings?.motherTongue ?? ""}
                        onChange={(event) => {
                          setProofreadingSettings((current) =>
                            current
                              ? { ...current, motherTongue: event.target.value }
                              : current,
                          );
                        }}
                        placeholder="Optional, e.g. en"
                        spellCheck={false}
                        disabled={!proofreadingSettings}
                      />
                    </label>
                  </div>
                  <label className="spellchecker-inline-toggle">
                    <input
                      type="checkbox"
                      checked={proofreadingSettings?.picky ?? false}
                      onChange={(event) => {
                        setProofreadingSettings((current) =>
                          current
                            ? { ...current, picky: event.target.checked }
                            : current,
                        );
                      }}
                      disabled={!proofreadingSettings}
                    />
                    <span>Enable picky mode for stricter style suggestions</span>
                  </label>
                  <div className="settings-update-actions">
                    <button
                      type="button"
                      className="dialog-cancel"
                      onClick={() => {
                        if (!proofreadingSettings) {
                          return;
                        }
                        void saveProofreadingSettings(
                          proofreadingSettings,
                          "Proofreading settings saved",
                        );
                      }}
                      disabled={!proofreadingSettings}
                    >
                      Save grammar settings
                    </button>
                    <button
                      type="button"
                      className="dialog-submit"
                      onClick={() => void runProofreading()}
                      disabled={
                        !proofreadingSettings ||
                        !proofreadingSettings.enabled ||
                        proofreadingLoading ||
                        !activeDocument ||
                        !supportsProofreading(activeDocument.name)
                      }
                    >
                      {proofreadingLoading ? "Checking..." : "Proofread now"}
                    </button>
                  </div>
                  <div className="spellchecker-note compact">
                    {proofreadingResult?.error
                      ? proofreadingResult.error
                      : proofreadingResult?.output
                        ? proofreadingResult.output
                        : "Suggestions appear inline in the editor and in the Problems panel."}
                  </div>
                </div>
              </div>

              {spellCheckerError ? (
                <div className="settings-row settings-row-stack settings-inline-error">
                  <div className="dialog-error">
                    <CircleAlert size={14} />
                    {spellCheckerError}
                  </div>
                </div>
              ) : null}
              {proofreadingError ? (
                <div className="settings-row settings-row-stack settings-inline-error">
                  <div className="dialog-error">
                    <CircleAlert size={14} />
                    {proofreadingError}
                  </div>
                </div>
              ) : null}

              <div className="settings-row update-row">
                <span>
                  <strong>App updates</strong>
                  <small>
                    {checkingUpdates
                      ? "Checking for the latest release…"
                      : updateInfo?.updateAvailable
                        ? `Version ${updateInfo.latestVersion} is available. You are on ${updateInfo.currentVersion}.`
                        : updateInfo?.latestVersion
                          ? `You are up to date on version ${updateInfo.currentVersion}.`
                          : updateInfo?.error
                            ? updateInfo.error
                            : "Check GitHub releases for updates."}
                  </small>
                </span>
                <div className="settings-update-actions">
                  <button
                    type="button"
                    className="dialog-cancel"
                    onClick={() => void checkForUpdates()}
                    disabled={checkingUpdates}
                  >
                    {checkingUpdates ? "Checking…" : "Check now"}
                  </button>
                  <button
                    type="button"
                    className="dialog-submit"
                    onClick={() => void window.latexdo.openReleasesPage()}
                    disabled={!updateInfo?.releaseUrl}
                  >
                    View release
                  </button>
                </div>
              </div>
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
