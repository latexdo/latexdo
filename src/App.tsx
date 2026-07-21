import type { BeforeMount, OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import {
  AlertCircle,
  ArrowLeftToLine,
  ArrowRightToLine,
  Bookmark,
  BookOpenText,
  Box,
  Bold,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Code2,
  Command,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  FileUp,
  FileImage,
  Files,
  FolderPlus,
  FolderOpen,
  GitBranch,
  Heading1,
  Heading2,
  History,
  House,
  ImageUp,
  Italic,
  Link,
  List,
  ListOrdered,
  LoaderCircle,
  Lock,
  MessageCircle,
  MessageSquare,
  Minus,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Sigma,
  Sparkles,
  Waypoints,
  Table2,
  TerminalSquare,
  Underline,
  User,
  Variable,
  Wand,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import appIconUrl from "../build/icon.svg";
import FileTree from "./FileTree";
import type { PdfClickLocation } from "./PdfPreview";
import TikzCanvas from "./TikzCanvas";
import TableCanvas from "./TableCanvas";
import { FigureToTikzConverter } from "./components/FigureToTikzConverter";
import { ReviewSidebar } from "./components/ReviewSidebar";
import { RebuttalSidebar } from "./components/RebuttalSidebar";
import { HistorySidebar } from "./components/HistorySidebar";
import { ShareProjectDialog } from "./components/ShareProjectDialog";
import { GitGraph } from "./components/GitGraph";
import { GitDiffWorkbench } from "./components/GitDiffWorkbench";
import {
  CitationManager,
  type CitationInsertCommand,
} from "./components/CitationManager";
import { ProjectSearchPanel } from "./components/ProjectSearchPanel";
import { AiSidebar } from "./components/AiSidebar";
import { SetupWizard } from "./components/SetupWizard";
import { CloudProviderForm } from "./components/CloudProviderForm";
import { ProfileDialog } from "./components/ProfileDialog";
import {
  loadAiConfig,
  saveAiConfig,
  layoutPresetFlags,
  type AiConfig,
} from "./features/ai/aiConfig";
import type { AgentContext, EditProposal } from "./features/ai/aiTools";
import { generateRebuttalLetter } from "./rebuttalGenerator";
import {
  escapeLatexText,
  normalizeLatexDoReviewMarkup,
  usesLatexDoReviewMacros,
} from "./reviewMarkup";
import type { RebuttalGeneratorSettings } from "./types";

const PdfPreview = lazy(() => import("./PdfPreview"));
const TerminalPanel = lazy(() =>
  import("./components/TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);
const MonacoEditor = lazy(() =>
  import("./components/MonacoEditor").then((module) => ({
    default: module.MonacoEditor,
  })),
);
import type {
  CompileResult,
  CollaborationState,
  CollaboratorPermission,
  ConferenceCheckerSettings,
  CitationAssistantSettings,
  StructureAssistantSettings,
  ReproducibilitySettings,
  AcronymManagerSettings,
  ErrorDoctorSettings,
  NotationManagerSettings,
  PdfComplianceSettings,
  Diagnostic,
  DiagnosticFix,
  DocumentHistorySnapshot,
  EditorMode,
  Engine,
  GitBlameLine,
  GitChangeEntry,
  GitChangedEvent,
  GitDiffSession,
  GitGraphCommit,
  ImportedProjectEntry,
  OpenProject,
  OpenDocument,
  ProofreadingSettings,
  ProjectEntry,
  RebuttalItem,
  ReviewChat,
  SpellCheckerSettings,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
  UpdateCheckResult,
  UpdateDownloadProgress,
} from "./types";
import { runConferenceChecks } from "./checks/conferenceChecker";
import { runCitationChecks } from "./checks/citationAssistant";
import { runStructureChecks } from "./checks/structureAssistant";
import { runReproducibilityChecks } from "./checks/reproducibility";
import { runAcronymChecks } from "./checks/acronymManager";
import { analyzeCompileOutput } from "./checks/errorDoctor";
import type { ErrorDoctorResult } from "./checks/errorDoctor";
import { runNotationChecks } from "./checks/notationManager";
import { runPdfComplianceChecks } from "./checks/pdfCompliance";
import { NotationManager } from "./components/NotationManager";
import { useCollaborationContext } from "./collaboration/CollaborationContext";
import type { MonacoCollaborationBinding } from "./collaboration/MonacoCollaborationBinding";
import {
  analyzeCitationLibrary,
  type CitationProjectFile,
} from "./latex/citationAnalysis";
import {
  recommendCitations,
  formatRecommendations,
} from "./features/graph/citationRecommender";
import {
  buildKnowledgeGraph,
  type KnowledgeGraphParams,
} from "./features/graph/knowledgeGraph";
import { KnowledgeGraphView } from "./components/KnowledgeGraphView";
import {
  isProjectSearchablePath,
  type ProjectSearchFile,
  type ProjectSearchMatch,
} from "./search/projectSearch";
import { pathForDisplay } from "./pathDisplay";
import {
  figureBytesToDataUrl,
  figureCanRenderInline,
  figurePreviewCandidatePaths,
  figurePreviewMimeType,
  parseIncludeGraphicsAtPosition,
} from "./figurePreview";
import {
  categoryLabel,
  contributionSummary,
  extensionCategories,
  extensionStoreSiteUrl,
  type ExtensionCategory,
  type ExtensionFeatureFlag,
  type LatexDoExtensionSnippet,
} from "./extensions";
import {
  getLatexCommandCompletionRange,
  getLatexCompletionContext,
} from "./latex/completionContext";
import { getLatexListEnterEdit } from "./latex/listContinuation";
import { SYMBOL_PALETTE } from "./components/mathSymbolPalette";
import {
  buildLatexFoldingRanges,
  extractLatexOutline,
  findLatexDocumentLinkAtOffset,
  findLatexDocumentLinks,
  formatLatexTableAtOffset,
  latexCommandSnippets,
} from "./latex/editorFeatureSupport";

import {
  applyTextFix,
  diagnosticAccuracyLabel,
  diagnosticContextContent,
  diagnosticExplicitProblem,
  diagnosticHeadline,
  diagnosticLocationLabel,
  diagnosticMarkerMessage,
} from "./features/editor/diagnostics";
import { escapeHtml } from "./features/editor/html";
import { useDocuments } from "./features/editor/useDocuments";
import {
  bookmarkKey,
  bookmarksStorageKey,
  boundedInteger,
  buildAutoCompileSignature,
  colorThemeOptions,
  defaultSettings,
  getSetting,
  hasProjectTreeLimitEntry,
  loadBookmarkStore,
  loadCollaborationDisplayName,
  loadKnowledgeGraphParams,
  storeKnowledgeGraphParams,
  maxProjectTreeDepth,
  maxProjectTreeEntries,
  minProjectTreeDepth,
  minProjectTreeEntries,
  monacoThemeFor,
  normalizeBookmarkLines,
  parseProjectTreeIgnoredNamesText,
  projectListOptionsFromSettings,
  storeCollaborationDisplayName,
  type BookmarkStore,
  type WelcomeTemplate,
} from "./features/settings/settings";
import { useSettings } from "./features/settings/useSettings";
import {
  buildHistorySnapshot,
  compactHistorySnapshots,
  historyAutoCaptureDelayMs,
  historyContentPreview,
  historyIndexRelativePath,
  historySnapshotContentPath,
  legacyHistoryStorageRelativePath,
  maxHistorySnapshotsInHotIndex,
  maxHistorySnapshotsPerFile,
  normalizeHistorySnapshot,
  pruneHistorySnapshots,
  snapshotContentKey,
  textHash,
} from "./features/history/historySnapshots";
import {
  fileDirectory,
  formatGitDate,
  gitDiffStatusCode,
  gitDiffTabLabel,
  gitDiscardStatusMessage,
  gitStatusClass,
  gitStatusCode,
  gitStatusLabel,
  type GitChangeArea,
  type GitChangeGroup,
} from "./features/git/gitUi";
import {
  blameByLine,
  blameHoverMarkdown,
  buildBlameAnnotations,
  inlineBlameText,
  unsavedChangesBlameText,
} from "./features/git/inlineBlame";
import { useGit } from "./features/git/useGit";
import {
  createPathInDirectory,
  fileName,
  flattenEntries,
  formatDuration,
  isImagePath,
  joinRelativePath,
  languageFor,
  latexFigureCode,
  normalizeRelativePath,
} from "./features/project/projectUtils";
import { useProject } from "./features/project/useProject";
import { useCompile } from "./features/compile/useCompile";
import { useHistory } from "./features/history/useHistory";
import {
  buildProofreadingRequest,
  supportsProofreading,
  uniqueWords,
} from "./features/proofreading/proofreading";
import { useProofreading } from "./features/proofreading/useProofreading";
import { wordColumn } from "./features/pdf/sync";
import {
  formatUpdateDate,
  formatUpdateLocation,
  formatUpdateProgress,
  updateCheckIntervalMs,
} from "./features/pdf/updateFormatting";
import {
  normalizeRebuttalItem,
  removeLegacyReviewPlaceholders,
} from "./features/review/reviewState";

type MonacoNamespace = typeof Monaco;
let monaco = null as unknown as MonacoNamespace;
const monacoProviderGeneration = Math.random().toString(36);
type MonacoProviderDisposableStore = typeof globalThis & {
  __latexdoMonacoProviderDisposables?: Monaco.IDisposable[];
  __latexdoMonacoProviderGeneration?: string;
};

function prepareMonacoProviderDisposables(): Monaco.IDisposable[] | null {
  const store = globalThis as MonacoProviderDisposableStore;
  if (store.__latexdoMonacoProviderGeneration === monacoProviderGeneration) {
    return null;
  }

  for (const disposable of store.__latexdoMonacoProviderDisposables ?? []) {
    disposable.dispose();
  }
  store.__latexdoMonacoProviderDisposables = [];
  store.__latexdoMonacoProviderGeneration = monacoProviderGeneration;
  return store.__latexdoMonacoProviderDisposables;
}

type PanelKind =
  | "problems"
  | "output"
  | "terminal"
  | "checkAnalysis"
  | "structureReport"
  | "pdfReport";
type SidebarView = "explorer" | "sourceControl" | "history" | "search" | "ai";
const collaborationProjectReconciliationMs = 5 * 60_000;
const startupUpdateCheckDelayMs = import.meta.env.MODE === "test" ? 0 : 2_000;
type LatexToolbarCommand =
  | "bold"
  | "italic"
  | "underline"
  | "math"
  | "section"
  | "subsection"
  | "equation"
  | "itemize"
  | "enumerate"
  | "cite"
  | "ref"
  | "href"
  | "formatTable";

type PendingSourceLocation = {
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  word?: string;
};

type TextOpenDocument = OpenDocument & { kind?: "text" };

function isTextDocument(
  document: OpenDocument | null | undefined,
): document is TextOpenDocument {
  return Boolean(document && (document.kind ?? "text") === "text");
}

function isPreviewAssetMimeType(mimeType: string | null): mimeType is string {
  return Boolean(
    mimeType && (mimeType.startsWith("image/") || mimeType === "application/pdf"),
  );
}

function assetPreviewTypeLabel(mimeType?: string): string {
  return mimeType === "application/pdf" ? "PDF" : "Image";
}

function formatAssetSize(bytes?: number): string {
  if (!bytes || bytes < 1) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clampModelLine(model: Monaco.editor.ITextModel, lineNumber: number): number {
  const safeLine = Number.isFinite(lineNumber) ? Math.floor(lineNumber) : 1;
  return Math.min(Math.max(1, safeLine), model.getLineCount());
}

function clampModelColumn(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
  column: number,
): number {
  const safeColumn = Number.isFinite(column) ? Math.floor(column) : 1;
  return Math.min(Math.max(1, safeColumn), model.getLineMaxColumn(lineNumber));
}

function modelRange(
  model: Monaco.editor.ITextModel,
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
): Monaco.IRange {
  const startLine = clampModelLine(model, startLineNumber);
  const endLine = clampModelLine(model, endLineNumber);
  const orderedEndLine = Math.max(startLine, endLine);
  const start = clampModelColumn(model, startLine, startColumn);
  let end =
    orderedEndLine === startLine
      ? clampModelColumn(model, startLine, Math.max(start, endColumn))
      : clampModelColumn(model, orderedEndLine, endColumn);

  if (orderedEndLine === startLine && end <= start) {
    end = Math.min(model.getLineMaxColumn(startLine), start + 1);
  }

  return {
    startLineNumber: startLine,
    startColumn: start,
    endLineNumber: orderedEndLine,
    endColumn: end,
  };
}

function sourceSelectionRange(
  model: Monaco.editor.ITextModel,
  pending: PendingSourceLocation,
): Monaco.IRange {
  const line = clampModelLine(model, pending.line);
  const column = clampModelColumn(model, line, pending.column);

  if (pending.word) {
    const match = wordColumn(model.getLineContent(line), pending.word, column);
    if (match.length > 0) {
      return modelRange(model, line, match.column, line, match.column + match.length);
    }
  }

  if (pending.endLine !== undefined || pending.endColumn !== undefined) {
    return modelRange(
      model,
      line,
      column,
      pending.endLine ?? line,
      pending.endColumn ?? column + 1,
    );
  }

  const wordAtColumn = model.getWordAtPosition({ lineNumber: line, column });
  if (wordAtColumn) {
    return modelRange(
      model,
      line,
      wordAtColumn.startColumn,
      line,
      wordAtColumn.endColumn,
    );
  }

  const lineContent = model.getLineContent(line);
  const firstTextIndex = lineContent.search(/\S/);
  if (firstTextIndex >= 0) {
    return modelRange(
      model,
      line,
      firstTextIndex + 1,
      line,
      model.getLineMaxColumn(line),
    );
  }

  return modelRange(model, line, column, line, column + 1);
}

function completionRangeAtPosition(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  completion: { rangeStartColumn: number; rangeEndColumn: number },
): Monaco.IRange {
  return modelRange(
    model,
    position.lineNumber,
    completion.rangeStartColumn,
    position.lineNumber,
    completion.rangeEndColumn,
  );
}

function isSafeIpcProjectId(value: string): boolean {
  return Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeIpcRelativePath(
  filePath: string,
  allowedExtensions?: readonly string[],
): boolean {
  const normalized = normalizeRelativePath(filePath).replace(/\/+/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return false;
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment === ".git" ||
        segment === "node_modules",
    )
  ) {
    return false;
  }

  if (!allowedExtensions) {
    return true;
  }
  const lowerPath = normalized.toLowerCase();
  return allowedExtensions.some((extension) => lowerPath.endsWith(extension));
}

function clampSelectionToModel(
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection,
): Monaco.ISelection {
  const startLine = clampModelLine(model, selection.selectionStartLineNumber);
  const positionLine = clampModelLine(model, selection.positionLineNumber);

  return {
    selectionStartLineNumber: startLine,
    selectionStartColumn: clampModelColumn(
      model,
      startLine,
      selection.selectionStartColumn,
    ),
    positionLineNumber: positionLine,
    positionColumn: clampModelColumn(model, positionLine, selection.positionColumn),
  };
}

function editorModelMatchesPath(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  filePath: string,
): boolean {
  const modelPath = editor?.getModel()?.uri.fsPath;
  return Boolean(
    modelPath && normalizeRelativePath(modelPath) === normalizeRelativePath(filePath),
  );
}

function AppIcon({ className }: { className?: string }) {
  return (
    <img
      src={appIconUrl}
      className={["app-icon", className].filter(Boolean).join(" ")}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export default function App() {
  const collaboration = useCollaborationContext();
  const {
    projectId,
    setProjectId,
    projectPath,
    setProjectPath,
    projectEntries,
    setProjectEntries,
    hideProjectEntries,
    setHideProjectEntries,
    welcomeOpen,
    setWelcomeOpen,
    createDialog,
    setCreateDialog,
    createPath,
    setCreatePath,
    createError,
    setCreateError,
    creating,
    setCreating,
    docxImporting,
    setDocxImporting,
    markdownImporting,
    setMarkdownImporting,
    templateCreating,
    setTemplateCreating,
  } = useProject();
  const { documents, setDocuments, activePath, setActivePath, activeDocument } =
    useDocuments();
  const [statusMessage, setStatusMessage] = useState("Welcome to LatexDo");
  const {
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    extensionCatalog,
    extensionCatalogSource,
    extensionCatalogLoading,
    extensionCatalogError,
    extensionQuery,
    setExtensionQuery,
    extensionCategoryFilter,
    setExtensionCategoryFilter,
    installedExtensionIdSet,
    installedExtensions,
    installedExtensionSnippets,
    availableWelcomeTemplates,
    filteredExtensions,
    refreshExtensionCatalog,
    installExtension,
    uninstallExtension,
  } = useSettings(setStatusMessage);
  const installedExtensionFeatureFlags = useMemo(() => {
    const featureFlags = new Set<ExtensionFeatureFlag>();

    for (const extension of installedExtensions) {
      for (const flag of Object.keys(extension.contributes.featureFlags ?? {})) {
        featureFlags.add(flag as ExtensionFeatureFlag);
      }
    }

    return featureFlags;
  }, [installedExtensions]);
  const extensionToolInstallation = useMemo(() => {
    const projectBibliographyInstalled =
      installedExtensionFeatureFlags.has("projectBibliographyEnabled") ||
      installedExtensionFeatureFlags.has("citationAssistantEnabled");

    return {
      projectBibliography: projectBibliographyInstalled,
      tableGenerator: installedExtensionFeatureFlags.has("tableGeneratorEnabled"),
      tikzConverter: installedExtensionFeatureFlags.has("tikzConverterEnabled"),
      notationManager: installedExtensionFeatureFlags.has("notationManagerEnabled"),
    };
  }, [installedExtensionFeatureFlags]);
  const extensionToolAvailability = useMemo(() => {
    const settingsByFlag = settings as unknown as Record<string, boolean>;
    const enabled = (flag: ExtensionFeatureFlag) =>
      settingsByFlag[flag] === true && installedExtensionFeatureFlags.has(flag);
    return {
      projectBibliography: extensionToolInstallation.projectBibliography,
      tableGenerator: enabled("tableGeneratorEnabled"),
      tikzConverter: enabled("tikzConverterEnabled"),
      notationManager: enabled("notationManagerEnabled"),
    };
  }, [
    installedExtensionFeatureFlags,
    extensionToolInstallation.projectBibliography,
    settings.tableGeneratorEnabled,
    settings.tikzConverterEnabled,
    settings.notationManagerEnabled,
  ]);
  const [activeSidebar, setActiveSidebar] = useState<SidebarView>("explorer");
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadAiConfig);
  const [aiWizardOpen, setAiWizardOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => {
    saveAiConfig(aiConfig);
  }, [aiConfig]);
  const editorPreviewRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine>(settings.defaultEngine);
  const [rootFile, setRootFile] = useState("main.tex");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [tikzCanvasOpen, setTikzCanvasOpen] = useState(false);
  const [tableCanvasOpen, setTableCanvasOpen] = useState(false);
  const [tikzConverterOpen, setTikzConverterOpen] = useState(false);
  const [notationManagerOpen, setNotationManagerOpen] = useState(false);
  const [citationManagerOpen, setCitationManagerOpen] = useState(false);
  const [citationProjectFiles, setCitationProjectFiles] = useState<
    CitationProjectFile[]
  >([]);
  const [citationLibraryLoading, setCitationLibraryLoading] = useState(false);
  const [citationLibraryError, setCitationLibraryError] = useState("");
  const [projectSearchFiles, setProjectSearchFiles] = useState<ProjectSearchFile[]>([]);
  const [projectSearchLoading, setProjectSearchLoading] = useState(false);

  useEffect(() => {
    if (tableCanvasOpen && !extensionToolAvailability.tableGenerator) {
      setTableCanvasOpen(false);
    }
    if (tikzConverterOpen && !extensionToolAvailability.tikzConverter) {
      setTikzConverterOpen(false);
    }
    if (notationManagerOpen && !extensionToolAvailability.notationManager) {
      setNotationManagerOpen(false);
    }
    if (citationManagerOpen && !extensionToolAvailability.projectBibliography) {
      setCitationManagerOpen(false);
    }
  }, [
    citationManagerOpen,
    extensionToolAvailability.notationManager,
    extensionToolAvailability.projectBibliography,
    extensionToolAvailability.tableGenerator,
    extensionToolAvailability.tikzConverter,
    notationManagerOpen,
    tableCanvasOpen,
    tikzConverterOpen,
  ]);

  useEffect(() => {
    const unavailableExtensionSettingsTab =
      (settingsTab === "citation" && !extensionToolInstallation.projectBibliography) ||
      (settingsTab === "tikz" && !extensionToolInstallation.tikzConverter) ||
      (settingsTab === "notation" && !extensionToolInstallation.notationManager);

    if (unavailableExtensionSettingsTab) {
      setSettingsTab("extensions");
    }
  }, [
    extensionToolInstallation.notationManager,
    extensionToolInstallation.projectBibliography,
    extensionToolInstallation.tikzConverter,
    setSettingsTab,
    settingsTab,
  ]);
  const [projectSearchError, setProjectSearchError] = useState("");
  const [projectSearchRefreshNonce, setProjectSearchRefreshNonce] = useState(0);
  const {
    pdfComplianceDiagnostics,
    setPdfComplianceDiagnostics,
    compileResult,
    setCompileResult,
    compileJobCount,
    setCompileJobCount,
    compiling,
  } = useCompile();
  const [panelVisible, setPanelVisible] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelKind>("problems");
  const [terminalStarted, setTerminalStarted] = useState(false);
  const [panelHeight, setPanelHeight] = useState(200);
  const {
    gitStatus,
    setGitStatus,
    gitLoading,
    setGitLoading,
    gitCommitMessage,
    setGitCommitMessage,
    gitActionBusy,
    setGitActionBusy,
    gitDiffSession,
    setGitDiffSession,
    gitBlameLines,
    setGitBlameLines,
    gitRepoHistory,
    setGitRepoHistory,
    setGitFileHistory,
    gitFileHistoryPath,
    setGitFileHistoryPath,
    selectedGitCommitHash,
    setSelectedGitCommitHash,
    gitCommitDetails,
    setGitCommitDetails,
    gitCommitParentHash,
    setGitCommitParentHash,
    collapsedGitGroups,
    setCollapsedGitGroups,
    gitContextMenu,
    setGitContextMenu,
    modifiedFiles,
    stagedGitEntries,
    unstagedGitEntries,
    stagedGitGroups,
    unstagedGitGroups,
    gitRepositoryCommits,
    gitFileCommits,
  } = useGit();
  const [editorBlameLines, setEditorBlameLines] = useState<GitBlameLine[]>([]);
  const [fileBlameEnabled, setFileBlameEnabled] = useState(false);
  const { documentHistory, setDocumentHistory } = useHistory();
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateDownloadProgress | null>(
    null,
  );
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingNow, setUpdatingNow] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(
    null,
  );
  const {
    spellCheckerSettings,
    setSpellCheckerSettings,
    spellCheckerLoading,
    setSpellCheckerLoading,
    spellCheckerError,
    setSpellCheckerError,
    spellCheckerWordDraft,
    setSpellCheckerWordDraft,
    spellCheckerLanguageQuery,
    setSpellCheckerLanguageQuery,
    proofreadingSettings,
    setProofreadingSettings,
    proofreadingResult,
    setProofreadingResult,
    proofreadingLoading,
    setProofreadingLoading,
    proofreadingError,
    setProofreadingError,
    filteredSpellCheckerLanguages,
  } = useProofreading();
  const [assistantDiagnostics, setAssistantDiagnostics] = useState<Diagnostic[]>([]);
  const [errorDoctorResult, setErrorDoctorResult] = useState<ErrorDoctorResult | null>(
    null,
  );
  const [collaborationState, setCollaborationState] = useState<CollaborationState>({
    enabled: false,
    users: [],
  });
  const [collaborationPermissions, setCollaborationPermissions] = useState<
    CollaboratorPermission[]
  >([]);
  const [isProjectAdmin, setIsProjectAdmin] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<"admin" | "editor" | "viewer">(
    "viewer",
  );
  const [collaborationDisplayName, setCollaborationDisplayName] = useState(
    loadCollaborationDisplayName,
  );
  const [collaborationBusy, setCollaborationBusy] = useState(false);
  const [collaborationCopied, setCollaborationCopied] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [joinTokenDraft, setJoinTokenDraft] = useState("");
  const [joinCollaborationBusy, setJoinCollaborationBusy] = useState(false);
  const [joinCollaborationError, setJoinCollaborationError] = useState("");
  const [realtimeBlockedDocuments, setRealtimeBlockedDocuments] = useState<
    Record<string, string>
  >({});
  const [realtimeReadyDocuments, setRealtimeReadyDocuments] = useState<Set<string>>(
    () => new Set(),
  );
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfTarget, setPdfTarget] = useState<SyncTexPdfLocation | null>(null);
  const [lastPdfLocation, setLastPdfLocation] = useState<PdfClickLocation | null>(null);
  const [pdfScale, setPdfScale] = useState(100);
  const [pdfRotation, setPdfRotation] = useState(0);
  const [bookmarkStore, setBookmarkStore] = useState<BookmarkStore>(loadBookmarkStore);
  const [splitPercent, setSplitPercent] = useState(52);
  const [mode, setMode] = useState<EditorMode>("author");
  const [reviewChats, setReviewChats] = useState<ReviewChat[]>([]);
  const [rebuttalItems, setRebuttalItems] = useState<RebuttalItem[]>([]);
  const reviewDataReadyRef = useRef(false);
  const reviewSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorMouseDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const editorActionDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const documentsRef = useRef<OpenDocument[]>([]);
  const documentHistoryRef = useRef<DocumentHistorySnapshot[]>([]);
  const projectEntriesRef = useRef<ProjectEntry[]>([]);
  const projectIdRef = useRef("");
  const projectPathRef = useRef("");
  const hideProjectEntriesRef = useRef(true);
  const activePathRef = useRef("");
  const editorPathBeforeWelcomeRef = useRef("");
  const settingsRef = useRef(settings);
  const rootFileRef = useRef(rootFile);
  const engineRef = useRef(engine);
  const pdfPathRef = useRef("");
  const forwardSyncRef = useRef<((position: Monaco.Position) => Promise<void>) | null>(
    null,
  );
  const pendingSourceRef = useRef<PendingSourceLocation | null>(null);
  const sourceSyncDecorationsRef = useRef<string[]>([]);
  const sourceSyncClearTimerRef = useRef<number | null>(null);
  const bookmarkDecorationsRef = useRef<string[]>([]);
  const backwardSyncRunIdRef = useRef(0);
  const lastAutoCompileSignatureRef = useRef("");
  const compileRunIdRef = useRef(0);
  const figurePreviewCacheRef = useRef<Map<string, string>>(new Map());
  const historySaveTimerRef = useRef<number | null>(null);
  const historyAutoCaptureTimerRef = useRef<number | null>(null);
  const historyContentLoadingRef = useRef<Set<string>>(new Set());
  const browserAutoOpenRef = useRef(false);
  const gitDiffSessionRef = useRef<GitDiffSession | null>(null);
  const gitDiffSessionIdRef = useRef("");
  const gitDiffReturnPathRef = useRef("");
  const gitFileHistoryPathRef = useRef("");
  const gitRefreshTimerRef = useRef<number | null>(null);
  const gitRowClickTimerRef = useRef<number | null>(null);
  const editorBlameStateRef = useRef<{
    byLine: Map<number, GitBlameLine>;
    dirty: boolean;
    inlineEnabled: boolean;
    fileBlameEnabled: boolean;
  }>({ byLine: new Map(), dirty: false, inlineEnabled: true, fileBlameEnabled: false });
  const inlineBlameDecorationsRef = useRef<string[]>([]);
  const fileBlameDecorationsRef = useRef<string[]>([]);
  const editorBlameFetchSeqRef = useRef(0);
  const editorBlameDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const blameHoverDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const collaborationBindingRef = useRef<MonacoCollaborationBinding | null>(null);
  const collaborationBindingRequestIdRef = useRef(0);
  const realtimeBlockedDocumentsRef = useRef<Record<string, string>>({});
  const realtimeReadyDocumentsRef = useRef<Set<string>>(new Set());
  const scheduleGitRefreshRef = useRef<() => void>(() => {});
  const installedExtensionSnippetsRef = useRef<LatexDoExtensionSnippet[]>([]);
  const runtime = (window.latexdo as typeof window.latexdo & { runtime?: string })
    .runtime;
  const collaborationAvailable = runtime === "cloud" || runtime === "desktop";

  const activeTextDocument = isTextDocument(activeDocument) ? activeDocument : null;
  const activeDocumentIsAssetPreview = activeDocument?.kind === "asset";
  const activeDocumentIsLatex = activeTextDocument
    ? languageFor(activeTextDocument.name) === "latex"
    : false;
  const activeDocumentIsAsymptote = activeTextDocument
    ? languageFor(activeTextDocument.name) === "asymptote"
    : false;
  const activeBookmarkKey = activeTextDocument
    ? bookmarkKey(projectPath || projectId, activeTextDocument.relativePath)
    : "";
  const activeBookmarkLines = useMemo(
    () =>
      normalizeBookmarkLines(activeBookmarkKey ? bookmarkStore[activeBookmarkKey] : []),
    [activeBookmarkKey, bookmarkStore],
  );
  const activeCollaborationReadOnlyMessage =
    activeTextDocument && collaborationState.enabled && collaborationState.token
      ? currentUserRole === "viewer"
        ? "Viewer access: this shared document is read-only."
        : realtimeBlockedDocuments[activeTextDocument.relativePath]
          ? realtimeBlockedDocuments[activeTextDocument.relativePath]
          : !realtimeReadyDocuments.has(activeTextDocument.relativePath)
            ? "Connecting securely before editing is enabled."
            : ""
      : "";
  const documentOutline = useMemo(
    () =>
      activeTextDocument && activeDocumentIsLatex
        ? extractLatexOutline(activeTextDocument.content)
        : [],
    [activeDocumentIsLatex, activeTextDocument],
  );
  const hasVisibleProject = Boolean(projectId) && !hideProjectEntries;
  const showWelcome = welcomeOpen && !activePath;
  const showBlankWorkspace = hideProjectEntries && !welcomeOpen && !activePath;
  const showEmptyEditor = !showWelcome && !activeDocument && !gitDiffSession;
  const previewShown =
    previewVisible && !showWelcome && !showBlankWorkspace && !gitDiffSession;
  const projectName = hasVisibleProject
    ? fileName(projectPath) || "Project"
    : "No Folder";
  const activeDocumentHistoryCount = activeTextDocument
    ? documentHistory.filter(
        (snapshot) => snapshot.filePath === activeTextDocument.relativePath,
      ).length
    : 0;
  const activeCollaborators = collaborationState.users;
  const collaboratorCount = activeCollaborators.length;
  const shareButtonLabel = collaborationBusy
    ? "Sharing..."
    : collaborationCopied
      ? "Copied"
      : collaborationState.enabled
        ? `${Math.max(collaboratorCount, 1)} live`
        : "Share";
  const shareButtonTitle = collaborationState.enabled
    ? "Open sharing"
    : projectId
      ? "Share project"
      : "Join shared project";
  const shareButtonDisabled = collaborationBusy || joinCollaborationBusy;
  const diagnostics = useMemo(
    () => [
      ...(compileResult?.diagnostics ?? []),
      ...(proofreadingResult?.diagnostics ?? []),
      ...assistantDiagnostics,
      ...(errorDoctorResult?.diagnostics ?? []),
    ],
    [
      compileResult?.diagnostics,
      proofreadingResult?.diagnostics,
      assistantDiagnostics,
      errorDoctorResult?.diagnostics,
    ],
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
      compileResult?.diagnostics.filter((diagnostic) => diagnostic.isCascade).length ??
      0,
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
  const citationAnalysis = useMemo(
    () => analyzeCitationLibrary(citationProjectFiles),
    [citationProjectFiles],
  );
  const [knowledgeGraphParams, setKnowledgeGraphParams] =
    useState<KnowledgeGraphParams>(loadKnowledgeGraphParams);
  const knowledgeGraph = useMemo(
    () =>
      buildKnowledgeGraph(
        citationAnalysis.entries,
        citationAnalysis.citedKeys,
        knowledgeGraphParams,
      ),
    [citationAnalysis, knowledgeGraphParams],
  );
  const citationEntriesByKey = useMemo(
    () => new Map(citationAnalysis.entries.map((entry) => [entry.key, entry])),
    [citationAnalysis],
  );
  const [knowledgeGraphOpen, setKnowledgeGraphOpen] = useState(false);
  useEffect(() => {
    storeKnowledgeGraphParams(knowledgeGraphParams);
  }, [knowledgeGraphParams]);
  const rootFileExists = useMemo(
    () =>
      hasVisibleProject &&
      allProjectEntries.some(
        (entry) =>
          entry.type === "file" &&
          normalizeRelativePath(entry.relativePath) === normalizeRelativePath(rootFile),
      ),
    [allProjectEntries, hasVisibleProject, rootFile],
  );
  const autoCompileSignature = useMemo(
    () => buildAutoCompileSignature(documents, projectId, rootFile, engine),
    [documents, engine, projectId, rootFile],
  );

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    installedExtensionSnippetsRef.current = installedExtensionSnippets;
  }, [installedExtensionSnippets]);

  useEffect(() => {
    documentHistoryRef.current = documentHistory;
  }, [documentHistory]);

  useEffect(() => {
    projectEntriesRef.current = projectEntries;
  }, [projectEntries]);

  useEffect(() => {
    projectIdRef.current = projectId;
    figurePreviewCacheRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

  useEffect(() => {
    hideProjectEntriesRef.current = hideProjectEntries;
  }, [hideProjectEntries]);

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
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(bookmarksStorageKey, JSON.stringify(bookmarkStore));
  }, [bookmarkStore]);

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      setCitationProjectFiles([]);
      setCitationLibraryError("");
      setCitationLibraryLoading(false);
      return;
    }

    const sourceEntries = allProjectEntries.filter(
      (entry) =>
        entry.type === "file" &&
        (entry.name.endsWith(".tex") || entry.name.endsWith(".bib")),
    );

    if (!sourceEntries.length) {
      setCitationProjectFiles([]);
      setCitationLibraryError("");
      setCitationLibraryLoading(false);
      return;
    }

    let cancelled = false;
    setCitationLibraryLoading(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const openDocuments = new Map(
            documentsRef.current.map((document) => [
              normalizeRelativePath(document.relativePath),
              document.content,
            ]),
          );
          const files = await Promise.all(
            sourceEntries.map(async (entry) => {
              const normalizedPath = normalizeRelativePath(entry.relativePath);
              const content =
                openDocuments.get(normalizedPath) ??
                (await window.latexdo.readFile(projectId, entry.relativePath));
              return { path: normalizedPath, content };
            }),
          );

          if (!cancelled) {
            setCitationProjectFiles(files);
            setCitationLibraryError("");
          }
        } catch (error) {
          if (!cancelled) {
            setCitationLibraryError(
              error instanceof Error
                ? error.message
                : "Could not scan project citations",
            );
          }
        } finally {
          if (!cancelled) {
            setCitationLibraryLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allProjectEntries, documents, hideProjectEntries, projectId]);

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      setProjectSearchFiles([]);
      setProjectSearchError("");
      setProjectSearchLoading(false);
      return;
    }

    const sourceEntries = allProjectEntries.filter(
      (entry) => entry.type === "file" && isProjectSearchablePath(entry.relativePath),
    );

    if (!sourceEntries.length) {
      setProjectSearchFiles([]);
      setProjectSearchError("");
      setProjectSearchLoading(false);
      return;
    }

    let cancelled = false;
    setProjectSearchLoading(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        const openDocuments = new Map(
          documentsRef.current.map((document) => [
            normalizeRelativePath(document.relativePath),
            document.content,
          ]),
        );
        const reads = await Promise.all(
          sourceEntries.map(async (entry) => {
            const normalizedPath = normalizeRelativePath(entry.relativePath);
            try {
              const content =
                openDocuments.get(normalizedPath) ??
                (await window.latexdo.readFile(projectId, entry.relativePath));
              return {
                file: { path: normalizedPath, content } satisfies ProjectSearchFile,
                error: "",
              };
            } catch (error) {
              return {
                file: null,
                error:
                  error instanceof Error
                    ? `${pathForDisplay(entry.relativePath)}: ${error.message}`
                    : pathForDisplay(entry.relativePath),
              };
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const files = reads
          .map((read) => read.file)
          .filter((file): file is ProjectSearchFile => Boolean(file));
        const failedReads = reads.filter((read) => read.error);
        setProjectSearchFiles(files);
        setProjectSearchError(
          failedReads.length
            ? `Skipped ${failedReads.length} unreadable file${
                failedReads.length === 1 ? "" : "s"
              }.`
            : "",
        );
        setProjectSearchLoading(false);
      })().catch((error) => {
        if (!cancelled) {
          setProjectSearchError(
            error instanceof Error ? error.message : "Could not scan project files.",
          );
          setProjectSearchLoading(false);
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    allProjectEntries,
    documents,
    hideProjectEntries,
    projectId,
    projectSearchRefreshNonce,
  ]);

  const refreshProject = useCallback(async (id = projectIdRef.current) => {
    if (!id) {
      return [];
    }
    const entries = await window.latexdo.listProject(
      id,
      projectListOptionsFromSettings(settingsRef.current),
    );
    setProjectEntries(entries);
    if (hasProjectTreeLimitEntry(entries)) {
      setStatusMessage("Project tree was limited. Adjust tree limits in Settings.");
    }
    return entries;
  }, []);

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      return;
    }
    void refreshProject(projectId);
  }, [
    hideProjectEntries,
    projectId,
    refreshProject,
    settings.projectTreeIgnoredNames,
    settings.projectTreeMaxDepth,
    settings.projectTreeMaxEntries,
  ]);

  const openDocument = useCallback(
    async (entry: ProjectEntry, targetProject = projectIdRef.current) => {
      if (entry.type !== "file") {
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

      const assetMimeType = figurePreviewMimeType(entry.relativePath);
      if (isPreviewAssetMimeType(assetMimeType)) {
        try {
          const bytes = await window.latexdo.readAsset(
            targetProject,
            entry.relativePath,
          );
          const assetDataUrl = figureBytesToDataUrl(bytes, assetMimeType);
          const document: OpenDocument = {
            path: entry.path,
            relativePath: entry.relativePath,
            name: entry.name,
            kind: "asset",
            content: "",
            savedContent: "",
            assetMimeType,
            assetDataUrl,
            assetBytes: bytes,
            assetSizeBytes: bytes.byteLength,
          };
          setDocuments((current) => {
            if (current.some((item) => item.path === document.path)) {
              documentsRef.current = current;
              return current;
            }
            const nextDocuments = [...current, document];
            documentsRef.current = nextDocuments;
            return nextDocuments;
          });
          setActivePath(entry.path);
          activePathRef.current = entry.path;
          setStatusMessage(`Opened ${pathForDisplay(entry.relativePath)}`);
        } catch (error) {
          setStatusMessage(
            error instanceof Error
              ? error.message
              : `Could not open ${pathForDisplay(entry.relativePath)}`,
          );
        }
        return;
      }

      let content: string;
      try {
        content = await window.latexdo.readFile(targetProject, entry.relativePath);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : `Could not open ${pathForDisplay(entry.relativePath)}`,
        );
        return;
      }
      const document: OpenDocument = {
        path: entry.path,
        relativePath: entry.relativePath,
        name: entry.name,
        kind: "text",
        content,
        savedContent: content,
      };
      setDocuments((current) => {
        if (current.some((item) => item.path === document.path)) {
          documentsRef.current = current;
          return current;
        }
        const nextDocuments = [...current, document];
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
      setActivePath(entry.path);
      activePathRef.current = entry.path;
      setStatusMessage(`Opened ${pathForDisplay(entry.relativePath)}`);
    },
    [],
  );

  const resolveProjectDataPath = useCallback((relativePath: string) => {
    return normalizeRelativePath(relativePath).replace(/^\/+/, "");
  }, []);

  const ensurePreambleMacros = (content: string): string => {
    const macroStart = "% --- LatexDo Review & Rebuttal Macros ---";
    const macroEnd = "% ----------------------------------------";
    const macros = String.raw`${macroStart}
\usepackage{xcolor}
\definecolor{LatexDoDiffAdd}{HTML}{1A7F37}
\definecolor{LatexDoDiffRemove}{HTML}{B42318}
\definecolor{LatexDoRule}{HTML}{8C959F}
\makeatletter
\@ifundefined{latexdoBlockTitle}{%
  \long\def\latexdoBlockTitle#1{%
    \par\noindent\textbf{\MakeUppercase{#1}}\par\nobreak\vspace{0.25em}%
  }%
}{}
\@ifundefined{latexdoDiffRemoved}{%
  \long\def\latexdoDiffRemoved#1{%
    \par\noindent{\ttfamily\color{LatexDoDiffRemove}- }{\color{LatexDoDiffRemove}#1}\par%
  }%
}{}
\@ifundefined{latexdoDiffAdded}{%
  \long\def\latexdoDiffAdded#1{%
    \par\noindent{\ttfamily\color{LatexDoDiffAdd}+ }{\color{LatexDoDiffAdd}#1}\par%
  }%
}{}
\@ifundefined{latexdoreviewercomment}{%
  \long\def\latexdoreviewercomment#1{%
    \par\smallskip
    \noindent{\color{LatexDoRule}\rule{2pt}{1.35em}}\hspace{0.65em}%
    \begin{minipage}[t]{0.92\linewidth}%
      \footnotesize\textbf{Reviewer comment.} #1%
    \end{minipage}\par
    \smallskip
  }%
}{}
\@ifundefined{reviewercomment}{%
  \long\def\reviewercomment#1#2{%
    #1\latexdoreviewercomment{#2}%
  }%
}{}
\@ifundefined{rebuttal}{%
  \long\def\rebuttal#1#2#3#4{%
    \par\medskip
    \noindent{\color{LatexDoRule}\rule{\linewidth}{0.4pt}}\par
    \latexdoBlockTitle{Text}#1\par
    \latexdoBlockTitle{Reviewer comment}#2\par
    \latexdoBlockTitle{Author answer}#3\par
    \latexdoBlockTitle{Changes (diff)}
    \latexdoDiffRemoved{#1}
    \latexdoDiffAdded{#4}
    \noindent{\color{LatexDoRule}\rule{\linewidth}{0.4pt}}\par
    \medskip
  }%
}{}
\makeatother
${macroEnd}
`;
    const macroStartIndex = content.indexOf(macroStart);
    if (macroStartIndex !== -1) {
      const macroEndIndex = content.indexOf(macroEnd, macroStartIndex);
      if (macroEndIndex !== -1) {
        return (
          content.slice(0, macroStartIndex) +
          macros +
          content.slice(macroEndIndex + macroEnd.length).replace(/^\n/, "")
        );
      }
    }
    const docStart = content.indexOf("\\begin{document}");
    if (docStart === -1) return macros + content;
    return content.slice(0, docStart) + macros + content.slice(docStart);
  };

  const findProjectEntry = (relativePath: string): ProjectEntry | undefined => {
    const normalizedPath = normalizeRelativePath(relativePath);
    return flattenEntries(projectEntriesRef.current).find(
      (entry) =>
        entry.type === "file" &&
        normalizeRelativePath(entry.relativePath) === normalizedPath,
    );
  };

  const findOpenDocument = (relativePath: string): OpenDocument | undefined => {
    const normalizedPath = normalizeRelativePath(relativePath);
    return documentsRef.current.find(
      (document) => normalizeRelativePath(document.relativePath) === normalizedPath,
    );
  };

  const projectUsesLatexDoReviewMacros = async (
    currentProject: string,
  ): Promise<boolean> => {
    if (
      documentsRef.current.some((document) => usesLatexDoReviewMacros(document.content))
    ) {
      return true;
    }

    const openDocumentPaths = new Set(
      documentsRef.current.map((document) =>
        normalizeRelativePath(document.relativePath),
      ),
    );
    const texEntries = flattenEntries(projectEntriesRef.current).filter(
      (entry) =>
        entry.type === "file" &&
        entry.name.endsWith(".tex") &&
        !openDocumentPaths.has(normalizeRelativePath(entry.relativePath)),
    );

    for (const entry of texEntries) {
      const content = await window.latexdo.readFile(currentProject, entry.relativePath);
      if (usesLatexDoReviewMacros(content)) {
        return true;
      }
    }

    return false;
  };

  const normalizeReviewMarkupForCompile = async (
    currentProject: string,
  ): Promise<Map<string, string>> => {
    const normalizedContents = new Map<string, string>();
    const texEntries = flattenEntries(projectEntriesRef.current).filter(
      (entry) => entry.type === "file" && entry.name.endsWith(".tex"),
    );

    for (const entry of texEntries) {
      const openDocument = findOpenDocument(entry.relativePath);
      const content =
        openDocument?.content ??
        (await window.latexdo.readFile(currentProject, entry.relativePath));
      const normalizedContent = normalizeLatexDoReviewMarkup(content);

      if (normalizedContent !== content) {
        await window.latexdo.writeFile(
          currentProject,
          entry.relativePath,
          normalizedContent,
        );
        normalizedContents.set(
          normalizeRelativePath(entry.relativePath),
          normalizedContent,
        );
      }
    }

    return normalizedContents;
  };

  const saveDocumentsForCompile = async (
    currentProject: string,
    dirtyDocuments: OpenDocument[],
  ): Promise<void> => {
    const rootRelativePath = rootFileRef.current;
    const rootEntry = findProjectEntry(rootRelativePath);
    const rootDocument = findOpenDocument(rootRelativePath);
    const savedContents = await normalizeReviewMarkupForCompile(currentProject);

    const reviewMacrosNeeded = await projectUsesLatexDoReviewMacros(currentProject);
    if (reviewMacrosNeeded && rootEntry) {
      const rootContent =
        savedContents.get(normalizeRelativePath(rootEntry.relativePath)) ??
        rootDocument?.content ??
        (await window.latexdo.readFile(currentProject, rootEntry.relativePath));
      const rootContentWithMacros = ensurePreambleMacros(rootContent);
      if (
        rootContentWithMacros !== rootContent ||
        rootDocument?.content !== rootDocument?.savedContent
      ) {
        await window.latexdo.writeFile(
          currentProject,
          rootEntry.relativePath,
          rootContentWithMacros,
        );
        savedContents.set(
          normalizeRelativePath(rootEntry.relativePath),
          rootContentWithMacros,
        );
      }
    }

    await Promise.all(
      dirtyDocuments
        .filter(
          (document) =>
            isTextDocument(document) &&
            normalizeRelativePath(document.relativePath) !==
              normalizeRelativePath(rootRelativePath),
        )
        .map(async (document) => {
          const normalizedPath = normalizeRelativePath(document.relativePath);
          const content = savedContents.get(normalizedPath) ?? document.content;
          await window.latexdo.writeFile(
            currentProject,
            document.relativePath,
            content,
          );
          savedContents.set(normalizedPath, content);
        }),
    );

    if (
      !reviewMacrosNeeded &&
      rootDocument &&
      rootDocument.content !== rootDocument.savedContent
    ) {
      const normalizedPath = normalizeRelativePath(rootDocument.relativePath);
      const content = savedContents.get(normalizedPath) ?? rootDocument.content;
      await window.latexdo.writeFile(
        currentProject,
        rootDocument.relativePath,
        content,
      );
      savedContents.set(normalizedPath, content);
    }

    if (savedContents.size > 0) {
      setDocuments((current) => {
        const nextDocuments = current.map((document) => {
          const savedContent = savedContents.get(
            normalizeRelativePath(document.relativePath),
          );
          return savedContent === undefined
            ? document
            : { ...document, content: savedContent, savedContent };
        });
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
    }
  };

  const saveReviewData = useCallback(
    async (chats: ReviewChat[], items: RebuttalItem[]) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;
      if (!reviewDataReadyRef.current) {
        // The stored review data never loaded for this project; writing now
        // would overwrite it with a partial view.
        setStatusMessage(
          "Review data could not be loaded — changes are not being saved. Reload the project to retry.",
        );
        return;
      }

      // Serialize writes so a slow earlier save cannot land after (and
      // overwrite) a newer one.
      const write = reviewSaveQueueRef.current.then(async () => {
        const data = JSON.stringify({ chats, items }, null, 2);
        const filePath = resolveProjectDataPath(".latexdo/review_data.json");
        await window.latexdo.writeFile(currentProject, filePath, data);
      });
      reviewSaveQueueRef.current = write.catch(() => undefined);
      try {
        await write;
      } catch (e) {
        console.error("Failed to save review data", e);
        setStatusMessage(
          "Could not save review data — your latest review change may be lost. Check your connection and try again.",
        );
      }
    },
    [resolveProjectDataPath],
  );

  const loadReviewData = useCallback(
    async (id: string) => {
      reviewDataReadyRef.current = false;
      try {
        const filePath = resolveProjectDataPath(".latexdo/review_data.json");
        const exists = await window.latexdo.fileExists(id, filePath);
        if (!exists) {
          setReviewChats([]);
          setRebuttalItems([]);
          reviewDataReadyRef.current = true;
          return;
        }
        const content = await window.latexdo.readFile(id, filePath);
        const { chats, items } = JSON.parse(content) as {
          chats: ReviewChat[];
          items: RebuttalItem[];
        };
        const nextItems = (Array.isArray(items) ? items : []).map(
          normalizeRebuttalItem,
        );
        const normalizedChats = removeLegacyReviewPlaceholders(
          Array.isArray(chats) ? chats : [],
        );
        setReviewChats(normalizedChats.chats);
        setRebuttalItems(nextItems);
        reviewDataReadyRef.current = true;
        if (normalizedChats.changed) {
          void saveReviewData(normalizedChats.chats, nextItems);
        }
      } catch (e) {
        // Keep reviewDataReadyRef false: saves are blocked so a transient
        // load failure cannot lead to overwriting the stored review data.
        console.error("Failed to load review data", e);
        setReviewChats([]);
        setRebuttalItems([]);
        setStatusMessage(
          "Could not load saved review data — review changes will not be saved until the project reloads successfully.",
        );
      }
    },
    [resolveProjectDataPath, saveReviewData],
  );

  const saveHistoryData = useCallback(
    async (snapshots: DocumentHistorySnapshot[]) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      try {
        await Promise.all(
          snapshots.map(async (snapshot) => {
            if (typeof snapshot.content !== "string") {
              return;
            }
            const contentPath =
              snapshot.contentPath ?? historySnapshotContentPath(snapshot.id);
            await window.latexdo.writeFile(
              currentProject,
              resolveProjectDataPath(contentPath),
              snapshot.content,
            );
          }),
        );

        const indexedSnapshots = snapshots.map((snapshot) => ({
          id: snapshot.id,
          filePath: snapshot.filePath,
          fileName: snapshot.fileName,
          label: snapshot.label,
          contentPath: snapshot.contentPath ?? historySnapshotContentPath(snapshot.id),
          contentHash:
            snapshot.contentHash ??
            (typeof snapshot.content === "string"
              ? textHash(snapshot.content)
              : undefined),
          contentSize:
            snapshot.contentSize ??
            (typeof snapshot.content === "string"
              ? snapshot.content.length
              : undefined),
          preview:
            snapshot.preview ??
            (typeof snapshot.content === "string"
              ? historyContentPreview(snapshot.content)
              : undefined),
          timestamp: snapshot.timestamp,
          source: snapshot.source,
        }));
        const data = JSON.stringify(
          {
            schemaVersion: 2,
            snapshots: indexedSnapshots,
            limits: {
              hotIndex: maxHistorySnapshotsInHotIndex,
              perFile: maxHistorySnapshotsPerFile,
            },
          },
          null,
          2,
        );
        await window.latexdo.writeFile(
          currentProject,
          resolveProjectDataPath(historyIndexRelativePath),
          data,
        );
        // Snapshot text is now on disk, so older in-memory copies can be
        // dropped; the history sidebar lazy-loads them back on demand.
        setDocumentHistory((current) => {
          const compacted = compactHistorySnapshots(current);
          if (compacted !== current) {
            documentHistoryRef.current = compacted;
          }
          return compacted;
        });
      } catch (e) {
        console.error("Failed to save document history", e);
      }
    },
    [resolveProjectDataPath, setDocumentHistory],
  );

  const scheduleHistorySave = useCallback(
    (snapshots: DocumentHistorySnapshot[]) => {
      if (historySaveTimerRef.current !== null) {
        window.clearTimeout(historySaveTimerRef.current);
      }
      historySaveTimerRef.current = window.setTimeout(() => {
        historySaveTimerRef.current = null;
        void saveHistoryData(snapshots);
      }, 350);
    },
    [saveHistoryData],
  );

  const updateDocumentHistory = useCallback(
    (updater: (snapshots: DocumentHistorySnapshot[]) => DocumentHistorySnapshot[]) => {
      setDocumentHistory((current) => {
        const updated = updater(current);
        if (updated === current) {
          return current;
        }
        const next = pruneHistorySnapshots(updated);
        documentHistoryRef.current = next;
        scheduleHistorySave(next);
        return next;
      });
    },
    [scheduleHistorySave],
  );

  const addHistorySnapshot = useCallback(
    (snapshot: DocumentHistorySnapshot) => {
      updateDocumentHistory((current) => {
        if (snapshot.source !== "auto") {
          return [snapshot, ...current];
        }
        const nextContentKey = snapshotContentKey(snapshot);
        const snapshotsForFile = current.filter(
          (item) => item.filePath === snapshot.filePath,
        );
        const latestForFile = [...snapshotsForFile].sort(
          (a, b) => b.timestamp - a.timestamp,
        )[0];
        if (
          nextContentKey &&
          snapshotContentKey(latestForFile ?? {}) === nextContentKey
        ) {
          return current;
        }
        if (
          nextContentKey &&
          snapshotsForFile.some((item) => snapshotContentKey(item) === nextContentKey)
        ) {
          return current;
        }
        return [snapshot, ...current];
      });
    },
    [updateDocumentHistory],
  );

  const captureActiveHistorySnapshot = useCallback(
    (source: DocumentHistorySnapshot["source"] = "manual") => {
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (!document) {
        setStatusMessage("Open a document before capturing history.");
        return;
      }
      if (!isTextDocument(document)) {
        setStatusMessage(
          `${pathForDisplay(document.relativePath)} is a preview and has no text history.`,
        );
        return;
      }
      addHistorySnapshot(buildHistorySnapshot(document, source));
      if (source === "manual") {
        setStatusMessage(
          `Captured history state for ${pathForDisplay(document.relativePath)}`,
        );
      }
    },
    [addHistorySnapshot],
  );

  const loadHistoryData = useCallback(
    async (id: string) => {
      try {
        const indexPath = resolveProjectDataPath(historyIndexRelativePath);
        const indexExists = await window.latexdo.fileExists(id, indexPath);
        if (indexExists) {
          const content = await window.latexdo.readFile(id, indexPath);
          const parsed = JSON.parse(content) as
            | {
                snapshots?: unknown[];
              }
            | unknown[];
          const rawSnapshots = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed.snapshots)
              ? parsed.snapshots
              : [];
          const snapshots = pruneHistorySnapshots(
            rawSnapshots
              .map(normalizeHistorySnapshot)
              .filter((snapshot): snapshot is DocumentHistorySnapshot =>
                Boolean(snapshot),
              ),
          );
          setDocumentHistory(snapshots);
          documentHistoryRef.current = snapshots;
          return;
        }

        const legacyPath = resolveProjectDataPath(legacyHistoryStorageRelativePath);
        const legacyExists = await window.latexdo.fileExists(id, legacyPath);
        if (!legacyExists) {
          setDocumentHistory([]);
          documentHistoryRef.current = [];
          return;
        }
        const content = await window.latexdo.readFile(id, legacyPath);
        const parsed = JSON.parse(content) as
          | {
              snapshots?: unknown[];
            }
          | unknown[];
        const rawSnapshots = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.snapshots)
            ? parsed.snapshots
            : [];
        const snapshots = pruneHistorySnapshots(
          rawSnapshots
            .map(normalizeHistorySnapshot)
            .filter((snapshot): snapshot is DocumentHistorySnapshot =>
              Boolean(snapshot),
            ),
        );
        setDocumentHistory(snapshots);
        documentHistoryRef.current = snapshots;
        scheduleHistorySave(snapshots);
      } catch (_e) {
        setDocumentHistory([]);
        documentHistoryRef.current = [];
      }
    },
    [resolveProjectDataPath, scheduleHistorySave],
  );

  const resolveHistorySnapshotContent = useCallback(
    async (snapshot: DocumentHistorySnapshot): Promise<string | null> => {
      if (typeof snapshot.content === "string") {
        return snapshot.content;
      }
      const currentProject = projectIdRef.current;
      const contentPath = snapshot.contentPath;
      if (!currentProject || !contentPath) {
        return null;
      }

      try {
        return await window.latexdo.readFile(
          currentProject,
          resolveProjectDataPath(contentPath),
        );
      } catch {
        return null;
      }
    },
    [resolveProjectDataPath],
  );

  const hydrateHistorySnapshotContent = useCallback(
    async (snapshot: DocumentHistorySnapshot) => {
      if (typeof snapshot.content === "string") {
        return;
      }
      if (historyContentLoadingRef.current.has(snapshot.id)) {
        return;
      }

      historyContentLoadingRef.current.add(snapshot.id);
      try {
        const content = await resolveHistorySnapshotContent(snapshot);
        if (content === null) {
          return;
        }
        setDocumentHistory((current) => {
          const next = current.map((item) =>
            item.id === snapshot.id
              ? {
                  ...item,
                  content,
                  contentHash: item.contentHash ?? textHash(content),
                  contentSize: item.contentSize ?? content.length,
                  preview: item.preview ?? historyContentPreview(content),
                }
              : item,
          );
          documentHistoryRef.current = next;
          return next;
        });
      } finally {
        historyContentLoadingRef.current.delete(snapshot.id);
      }
    },
    [resolveHistorySnapshotContent],
  );

  const generateRebuttalFile = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject || !rootFile) return;

    try {
      const rebuttalRoot = rootFile.replace(/\.tex$/, "-rebuttal.tex");
      const entry = allProjectEntries.find((e) => e.relativePath === rootFile);
      if (!entry) return;

      let content = documentsRef.current.find((d) => d.path === entry.path)?.content;
      if (content === undefined) {
        content = await window.latexdo.readFile(currentProject, entry.relativePath);
      }

      content = ensurePreambleMacros(content);
      await window.latexdo.writeFile(currentProject, rebuttalRoot, content);
      setStatusMessage(`Generated rebuttal version: ${rebuttalRoot}`);
      await refreshProject(currentProject);
    } catch (e) {
      setStatusMessage("Failed to generate rebuttal file.");
    }
  }, [allProjectEntries, refreshProject, rootFile]);

  const loadProject = useCallback(
    async (project: OpenProject, openFirstDocument = false, hideEntries = false) => {
      setStatusMessage("Loading project…");
      setProjectId(project.id);
      projectIdRef.current = project.id;
      setProjectPath(project.rootPath);
      projectPathRef.current = project.rootPath;
      setHideProjectEntries(hideEntries);
      setDocuments([]);
      documentsRef.current = [];
      setDocumentHistory([]);
      documentHistoryRef.current = [];
      setActivePath("");
      activePathRef.current = "";
      setGitStatus(null);
      setGitDiffSession(null);
      gitDiffSessionRef.current = null;
      gitDiffSessionIdRef.current = "";
      setGitBlameLines([]);
      setGitRepoHistory(null);
      setGitFileHistory(null);
      setGitFileHistoryPath(null);
      gitFileHistoryPathRef.current = "";
      setSelectedGitCommitHash(null);
      setGitCommitDetails(null);
      setGitCommitParentHash("");
      setWelcomeOpen(true);
      setCompileResult(null);
      setPdfData(null);
      setPdfTarget(null);
      setLastPdfLocation(null);
      pdfPathRef.current = "";
      lastAutoCompileSignatureRef.current = "";

      const entries = await window.latexdo.listProject(
        project.id,
        projectListOptionsFromSettings(settingsRef.current),
      );
      setProjectEntries(entries);
      const treeLimited = hasProjectTreeLimitEntry(entries);
      if (treeLimited) {
        setStatusMessage("Project tree was limited. Adjust tree limits in Settings.");
      }
      await loadReviewData(project.id);
      await loadHistoryData(project.id);
      const allFiles = flattenEntries(entries);
      const main =
        allFiles.find(
          (entry) => entry.type === "file" && entry.relativePath === "main.tex",
        ) ??
        allFiles.find((entry) => entry.type === "file" && entry.name.endsWith(".tex"));

      if (main) {
        setRootFile(main.relativePath);
        rootFileRef.current = main.relativePath;
        if (openFirstDocument) {
          await openDocument(main, project.id);
        }
      }
      setStatusMessage(
        treeLimited
          ? "Project tree was limited. Adjust tree limits in Settings."
          : "Ready",
      );
    },
    [loadHistoryData, loadReviewData, openDocument],
  );

  useEffect(() => {
    const runtime = (window.latexdo as typeof window.latexdo & { runtime?: string })
      .runtime;
    if (
      !["browser", "cloud", "desktop"].includes(runtime ?? "") ||
      browserAutoOpenRef.current
    ) {
      return;
    }

    browserAutoOpenRef.current = true;
    void (async () => {
      try {
        const project =
          runtime === "desktop"
            ? await window.latexdo.restoreCloudProject()
            : await window.latexdo.openProject();
        if (project) {
          await loadProject(project, true, false);
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Could not open the browser workspace.",
        );
      }
    })();
  }, [loadProject]);

  const saveDocument = useCallback(
    async (document: OpenDocument) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        return;
      }
      if (!isTextDocument(document)) {
        setStatusMessage(
          `${pathForDisplay(document.relativePath)} is a preview and does not need saving.`,
        );
        return;
      }
      if (
        collaborationState.enabled &&
        collaborationState.token &&
        (currentUserRole === "viewer" ||
          Boolean(realtimeBlockedDocumentsRef.current[document.relativePath]) ||
          !realtimeReadyDocumentsRef.current.has(document.relativePath))
      ) {
        throw new Error(
          realtimeBlockedDocumentsRef.current[document.relativePath] ||
            (currentUserRole === "viewer"
              ? "Viewer access cannot save changes."
              : "Wait for secure collaboration sync before saving."),
        );
      }
      if (document.content !== document.savedContent && document.content.trim()) {
        addHistorySnapshot(buildHistorySnapshot(document, "auto"));
      }
      await window.latexdo.writeFile(
        currentProject,
        document.relativePath,
        document.content,
      );
      setDocuments((current) => {
        const nextDocuments = current.map((item) =>
          item.path === document.path ? { ...item, savedContent: item.content } : item,
        );
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
      scheduleGitRefreshRef.current();
      setStatusMessage(`Saved ${pathForDisplay(document.relativePath)}`);
    },
    [
      addHistorySnapshot,
      collaborationState.enabled,
      collaborationState.token,
      currentUserRole,
    ],
  );

  const compile = useCallback(async (): Promise<CompileResult | null> => {
    const currentProject = projectIdRef.current;
    if (!currentProject || hideProjectEntriesRef.current) {
      setStatusMessage("Create or open a project before compiling.");
      return null;
    }

    const compileRunId = compileRunIdRef.current + 1;
    compileRunIdRef.current = compileRunId;
    const activeCompileDocument = documentsRef.current.find(
      (document) => document.path === activePathRef.current,
    );
    const asymptoteDocument =
      activeCompileDocument && activeCompileDocument.name.endsWith(".asy")
        ? activeCompileDocument
        : null;
    lastAutoCompileSignatureRef.current = buildAutoCompileSignature(
      documentsRef.current,
      currentProject,
      rootFileRef.current,
      engineRef.current,
    );
    setCompileJobCount((count) => count + 1);
    setStatusMessage(
      asymptoteDocument
        ? `Compiling ${pathForDisplay(asymptoteDocument.relativePath)} with Asymptote...`
        : `Compiling ${pathForDisplay(rootFileRef.current)} in the background...`,
    );
    try {
      const result = asymptoteDocument
        ? await (async () => {
            if (asymptoteDocument.content !== asymptoteDocument.savedContent) {
              await window.latexdo.writeFile(
                currentProject,
                asymptoteDocument.relativePath,
                asymptoteDocument.content,
              );
              setDocuments((current) => {
                const nextDocuments = current.map((document) =>
                  document.path === asymptoteDocument.path
                    ? { ...document, savedContent: document.content }
                    : document,
                );
                documentsRef.current = nextDocuments;
                return nextDocuments;
              });
            }
            return window.latexdo.compileAsymptote({
              projectId: currentProject,
              relativePath: asymptoteDocument.relativePath,
            });
          })()
        : await (async () => {
            const dirtyDocuments = documentsRef.current.filter(
              (document) => document.content !== document.savedContent,
            );
            await saveDocumentsForCompile(currentProject, dirtyDocuments);

            return window.latexdo.compile({
              projectId: currentProject,
              rootFile: rootFileRef.current,
              engine: engineRef.current,
            });
          })();

      const isLatestCompile = compileRunId === compileRunIdRef.current;
      if (isLatestCompile) {
        setCompileResult(result);
      }

      if (result.ok && result.pdfPath) {
        const bytes = await window.latexdo.readPdf(currentProject, result.pdfPath);
        if (isLatestCompile) {
          pdfPathRef.current = result.pdfPath;
          setPdfData(new Uint8Array(bytes));
          setPdfTarget(null);
          setLastPdfLocation(null);
          setPreviewVisible(true);
          setStatusMessage(
            asymptoteDocument
              ? `Built ${pathForDisplay(asymptoteDocument.relativePath)} in ${formatDuration(
                  result.durationMs,
                )}`
              : `Built successfully in ${formatDuration(result.durationMs)}`,
          );
        }
      } else {
        if (isLatestCompile) {
          pdfPathRef.current = "";
          setPdfTarget(null);
          setLastPdfLocation(null);
          setPanelVisible(true);
          setActivePanel(result.diagnostics.length ? "problems" : "output");
          setStatusMessage(result.error ?? "Compilation failed");
        }
      }
      return result;
    } catch (error) {
      if (compileRunId === compileRunIdRef.current) {
        pdfPathRef.current = "";
        setPdfTarget(null);
        setLastPdfLocation(null);
        setPanelVisible(true);
        setActivePanel("output");
        setStatusMessage(error instanceof Error ? error.message : "Compilation failed");
      }
      return null;
    } finally {
      setCompileJobCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const cancelCompile = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject || !compiling) {
      return;
    }

    compileRunIdRef.current += 1;
    try {
      const canceled = await window.latexdo.cancelCompile(currentProject);
      setStatusMessage(
        canceled ? "Canceling compile..." : "No active compile to cancel.",
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not cancel compile.",
      );
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

  const closeActiveTab = useCallback(() => {
    const currentPath = activePathRef.current;

    if (currentPath) {
      const currentDocuments = documentsRef.current;
      const target = currentDocuments.find((document) => document.path === currentPath);
      if (
        target &&
        target.content !== target.savedContent &&
        !window.confirm(`Close ${target.name} without saving?`)
      ) {
        return;
      }

      const index = currentDocuments.findIndex(
        (document) => document.path === currentPath,
      );
      const nextDocuments = currentDocuments.filter(
        (document) => document.path !== currentPath,
      );
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);

      const nextPath =
        nextDocuments[Math.min(index, nextDocuments.length - 1)]?.path ?? "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
      setStatusMessage(
        target ? `Closed ${pathForDisplay(target.relativePath)}` : "Closed active tab",
      );
      return;
    }

    if (gitDiffSessionRef.current && !welcomeOpen) {
      setGitDiffSession(null);
      gitDiffSessionRef.current = null;
      setGitBlameLines([]);
      gitDiffSessionIdRef.current = "";

      const returnPath = gitDiffReturnPathRef.current;
      const nextPath = documentsRef.current.some(
        (document) => document.path === returnPath,
      )
        ? returnPath
        : (documentsRef.current[0]?.path ?? "");
      setActivePath(nextPath);
      activePathRef.current = nextPath;
      setStatusMessage("Closed diff tab");
      return;
    }

    if (welcomeOpen) {
      setWelcomeOpen(false);
      if (hideProjectEntriesRef.current) {
        setActivePath("");
        activePathRef.current = "";
        setPreviewVisible(false);
        setStatusMessage("Closed Welcome");
        return;
      }

      const previousEditorPath = editorPathBeforeWelcomeRef.current;
      const nextPath =
        documentsRef.current.find((document) => document.path === previousEditorPath)
          ?.path ??
        documentsRef.current[0]?.path ??
        "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
      setStatusMessage("Closed Welcome");
    }
  }, [setGitBlameLines, setGitDiffSession, welcomeOpen]);

  const downloadPdf = useCallback(async () => {
    const currentProject = projectIdRef.current;
    const activeDownloadDocument = documentsRef.current.find(
      (document) => document.path === activePathRef.current,
    );
    const downloadingAsymptote = Boolean(activeDownloadDocument?.name.endsWith(".asy"));
    if (!currentProject || (!rootFileExists && !downloadingAsymptote)) {
      return;
    }

    try {
      const sourceIsDirty = documentsRef.current.some(
        (document) => document.content !== document.savedContent,
      );
      let pdfPath = pdfPathRef.current;

      if (!pdfPath || sourceIsDirty) {
        const result = await compile();
        pdfPath = result?.ok ? (result.pdfPath ?? "") : "";
      }
      if (!pdfPath) {
        setStatusMessage("Compile successfully before downloading the PDF");
        return;
      }

      const bytes = await window.latexdo.readPdf(currentProject, pdfPath);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      const downloadName = downloadingAsymptote
        ? fileName(activeDownloadDocument?.relativePath ?? "figure.asy").replace(
            /\.asy$/i,
            ".pdf",
          )
        : fileName(rootFileRef.current).replace(/\.tex$/i, ".pdf");

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
      setStatusMessage(`Using ${pathForDisplay(entry.relativePath)} as the main file`);
      await compile();
    },
    [compile],
  );

  useEffect(() => {
    const hasDirtyDocuments = documents.some(
      (document) => document.content !== document.savedContent,
    );

    if (
      !hasVisibleProject ||
      !activeDocument ||
      !rootFileExists ||
      !hasDirtyDocuments ||
      compiling ||
      showWelcome ||
      showBlankWorkspace
    ) {
      return;
    }
    if (autoCompileSignature === lastAutoCompileSignatureRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      lastAutoCompileSignatureRef.current = autoCompileSignature;
      void compile();
    }, 100);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activeDocument,
    autoCompileSignature,
    compile,
    compiling,
    documents,
    hasVisibleProject,
    rootFileExists,
    showBlankWorkspace,
    showWelcome,
  ]);

  useEffect(() => {
    const doc = activeDocument;
    if (!doc || !doc.content) {
      setAssistantDiagnostics([]);
      return;
    }
    const content = doc.content;
    const timer = setTimeout(() => {
      const all: Diagnostic[] = [];
      if (settings.conferenceCheckerEnabled) {
        all.push(
          ...runConferenceChecks(
            content,
            settings as unknown as ConferenceCheckerSettings,
          ),
        );
      }
      if (settings.citationAssistantEnabled) {
        all.push(
          ...runCitationChecks(
            content,
            settings as unknown as CitationAssistantSettings,
          ),
        );
      }
      if (settings.structureAssistantEnabled) {
        all.push(
          ...runStructureChecks(
            content,
            settings as unknown as StructureAssistantSettings,
          ),
        );
      }
      if (settings.reproducibilityEnabled) {
        all.push(
          ...runReproducibilityChecks(
            content,
            settings as unknown as ReproducibilitySettings,
          ),
        );
      }
      if (settings.acronymManagerEnabled) {
        all.push(
          ...runAcronymChecks(content, settings as unknown as AcronymManagerSettings),
        );
      }
      if (settings.notationManagerEnabled) {
        const result = runNotationChecks(
          content,
          settings as unknown as NotationManagerSettings,
        );
        all.push(...result.diagnostics);
      }
      setAssistantDiagnostics(all);
    }, 500);
    return () => clearTimeout(timer);
  }, [
    activeDocument?.content,
    settings.conferenceCheckerEnabled,
    settings.citationAssistantEnabled,
    settings.structureAssistantEnabled,
    settings.reproducibilityEnabled,
    settings.acronymManagerEnabled,
    settings.checkMargins,
    settings.checkFontSize,
    settings.checkAbstractLength,
    settings.checkKeywords,
    settings.checkFigureReferences,
    settings.checkTableReferences,
    settings.checkBibliographyStyle,
    settings.checkPageLimit,
    settings.checkAuthorInfo,
    settings.checkAnonymousReview,
    settings.checkFigureResolution,
    settings.checkEmbeddedFonts,
    settings.checkCompiler,
    settings.detectMissingCitations,
    settings.detectUnusedEntries,
    settings.detectDuplicateReferences,
    settings.detectBrokenLinks,
    settings.suggestCitationKeys,
    settings.importMetadataSources,
    settings.warnOldCitations,
    settings.checkAbstractStructure,
    settings.checkIntroductionStructure,
    settings.checkRelatedWorkLength,
    settings.checkMethodReproducibility,
    settings.checkResultsDiscussion,
    settings.checkConclusionClaims,
    settings.conferenceTemplate,
    settings.conferenceChecker_customTemplate,
    settings.checkCodeLink,
    settings.checkDatasetLink,
    settings.checkLicenseMentioned,
    settings.checkHyperparameters,
    settings.checkHardwareDetails,
    settings.checkRandomSeeds,
    settings.checkEvaluationMetrics,
    settings.checkUndefinedAcronym,
    settings.checkDuplicateDefinition,
    settings.checkUnusedAcronym,
    settings.checkConflictingDefinitions,
    settings.notationManagerEnabled,
    settings.detectNotation,
    settings.detectNotationConflicts,
    settings.detectUndefinedNotation,
  ]);

  const structureDiagnostics = useMemo(
    () => assistantDiagnostics.filter((d) => d.source === "structure-assistant"),
    [assistantDiagnostics],
  );

  useEffect(() => {
    if (!settings.errorDoctorEnabled || !compileResult?.output) {
      setErrorDoctorResult(null);
      return;
    }
    const content = activeDocument?.content ?? "";
    const result = analyzeCompileOutput(
      compileResult.output,
      content,
      settings as unknown as ErrorDoctorSettings,
    );
    setErrorDoctorResult(result);
  }, [
    compileResult?.output,
    settings.errorDoctorEnabled,
    settings.explainErrors,
    settings.suggestFixes,
    settings.autoFixCommon,
    activeDocument?.content,
  ]);

  useEffect(() => {
    if (!settings.pdfComplianceEnabled || !activeDocument?.content) {
      setPdfComplianceDiagnostics([]);
      return;
    }
    const content = activeDocument.content;
    const compileOutput = compileResult?.output ?? "";
    const result = runPdfComplianceChecks(
      content,
      compileOutput,
      settings as unknown as PdfComplianceSettings,
    );
    setPdfComplianceDiagnostics(result);
  }, [
    activeDocument?.content,
    compileResult?.output,
    settings.pdfComplianceEnabled,
    settings.checkPageCount,
    settings.maxPages,
    settings.checkUnreferencedFigures,
    settings.checkUncitedCitations,
    settings.checkSectionsWithNoCitations,
    settings.checkType3Fonts,
    settings.checkAbstractWordCount,
    settings.maxAbstractWords,
  ]);

  const moveEntry = useCallback(
    async (sourcePath: string, destination: ProjectEntry | null) => {
      const currentProject = projectIdRef.current;
      if (
        !currentProject ||
        (destination !== null && destination.type !== "directory")
      ) {
        return;
      }

      const sourceEntry = flattenEntries(projectEntriesRef.current).find(
        (entry) => entry.path === sourcePath,
      );
      if (!sourceEntry) {
        setStatusMessage("The dragged item could not be found.");
        return;
      }

      const sourceRelativePath = normalizeRelativePath(sourceEntry.relativePath);
      const destinationDirectory = normalizeRelativePath(
        destination?.relativePath ?? "",
      ).replace(/\/+$/, "");
      const sourceParent = sourceRelativePath.includes("/")
        ? sourceRelativePath.slice(0, sourceRelativePath.lastIndexOf("/"))
        : "";

      if (destinationDirectory === sourceParent) {
        setStatusMessage(
          `${sourceEntry.name} is already in ${
            destinationDirectory || "the project root"
          }`,
        );
        return;
      }

      if (
        destination &&
        (destination.path === sourceEntry.path ||
          normalizeRelativePath(destination.path).startsWith(
            `${normalizeRelativePath(sourceEntry.path)}/`,
          ))
      ) {
        setStatusMessage("A folder cannot be moved into itself.");
        return;
      }

      const destinationRelativePath = destinationDirectory
        ? joinRelativePath(destinationDirectory, sourceEntry.name)
        : sourceEntry.name;

      try {
        const sourcePrefix = `${sourceRelativePath}/`;
        const dirtySourceDocuments = documentsRef.current.filter(
          (document) =>
            (normalizeRelativePath(document.relativePath) === sourceRelativePath ||
              normalizeRelativePath(document.relativePath).startsWith(sourcePrefix)) &&
            document.content !== document.savedContent,
        );
        for (const document of dirtySourceDocuments) {
          await saveDocument(document);
        }

        const movedRelativePath = await window.latexdo.moveEntry(
          currentProject,
          sourceEntry.relativePath,
          destinationRelativePath,
        );
        const nextRelativePath = normalizeRelativePath(movedRelativePath);
        const nextPrefix = `${nextRelativePath}/`;
        const sourceAbsolutePath = normalizeRelativePath(sourceEntry.path);
        const projectRoot = projectPathRef.current;
        const absoluteSeparator = projectRoot.includes("\\") ? "\\" : "/";
        const joinAbsolutePath = (base: string, suffix: string): string =>
          `${base.replace(/[\\/]+$/, "")}${absoluteSeparator}${suffix.replaceAll(
            "/",
            absoluteSeparator,
          )}`;
        const nextPath = joinAbsolutePath(projectRoot, nextRelativePath);

        const moveDocument = (document: OpenDocument): OpenDocument => {
          const relativePath = normalizeRelativePath(document.relativePath);
          if (
            relativePath !== sourceRelativePath &&
            !relativePath.startsWith(sourcePrefix)
          ) {
            return document;
          }

          const relativeSuffix =
            relativePath === sourceRelativePath
              ? ""
              : relativePath.slice(sourcePrefix.length);
          const absolutePath = normalizeRelativePath(document.path);
          const absoluteSuffix =
            absolutePath === sourceAbsolutePath
              ? ""
              : absolutePath.slice(sourceAbsolutePath.length + 1);
          return {
            ...document,
            path: absoluteSuffix
              ? joinAbsolutePath(nextPath, absoluteSuffix)
              : nextPath,
            relativePath: relativeSuffix
              ? `${nextPrefix}${relativeSuffix}`
              : nextRelativePath,
          };
        };

        const nextDocuments = documentsRef.current.map(moveDocument);
        documentsRef.current = nextDocuments;
        setDocuments(nextDocuments);

        const normalizedActivePath = normalizeRelativePath(activePathRef.current);
        if (
          normalizedActivePath === sourceAbsolutePath ||
          normalizedActivePath.startsWith(`${sourceAbsolutePath}/`)
        ) {
          const activeSuffix =
            normalizedActivePath === sourceAbsolutePath
              ? ""
              : normalizedActivePath.slice(sourceAbsolutePath.length + 1);
          const movedActivePath = activeSuffix
            ? joinAbsolutePath(nextPath, activeSuffix)
            : nextPath;
          setActivePath(movedActivePath);
          activePathRef.current = movedActivePath;
        }

        const currentRootFile = normalizeRelativePath(rootFileRef.current);
        if (
          currentRootFile === sourceRelativePath ||
          currentRootFile.startsWith(sourcePrefix)
        ) {
          const rootSuffix =
            currentRootFile === sourceRelativePath
              ? ""
              : currentRootFile.slice(sourcePrefix.length);
          const movedRootFile = rootSuffix
            ? `${nextPrefix}${rootSuffix}`
            : nextRelativePath;
          setRootFile(movedRootFile);
          rootFileRef.current = movedRootFile;
        }

        setCompileResult(null);
        setPdfData(null);
        setPdfTarget(null);
        setLastPdfLocation(null);
        pdfPathRef.current = "";
        await refreshProject(currentProject);
        setStatusMessage(
          `Moved ${sourceEntry.name} to ${
            destination?.relativePath || "the project root"
          }`,
        );
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
      normalizeRelativePath(model.uri.fsPath) !== normalizeRelativePath(pending.path)
    ) {
      return false;
    }

    const range = sourceSelectionRange(model, pending);
    editor.setSelection(range);
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    editor.focus();

    if (sourceSyncClearTimerRef.current !== null) {
      window.clearTimeout(sourceSyncClearTimerRef.current);
      sourceSyncClearTimerRef.current = null;
    }
    sourceSyncDecorationsRef.current = editor.deltaDecorations(
      sourceSyncDecorationsRef.current,
      [
        {
          range,
          options: {
            className: "source-sync-highlight",
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            hoverMessage: { value: "PDF inverse search target" },
          },
        },
      ],
    );
    sourceSyncClearTimerRef.current = window.setTimeout(() => {
      const currentEditor = editorRef.current;
      if (currentEditor) {
        sourceSyncDecorationsRef.current = currentEditor.deltaDecorations(
          sourceSyncDecorationsRef.current,
          [],
        );
      } else {
        sourceSyncDecorationsRef.current = [];
      }
      sourceSyncClearTimerRef.current = null;
    }, 1800);

    pendingSourceRef.current = null;
    return true;
  }, []);

  const handleForwardSync = useCallback(
    async (position: Monaco.Position) => {
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (!document || !document.name.endsWith(".tex")) {
        return;
      }

      const model = editorRef.current?.getModel();
      if (!editorModelMatchesPath(editorRef.current, document.path)) {
        return;
      }
      const word = model?.getWordAtPosition(position)?.word;
      let pdfPath = pdfPathRef.current;
      const sourceIsDirty = documentsRef.current.some(
        (item) => item.content !== item.savedContent,
      );

      if (!pdfPath || sourceIsDirty) {
        const result = await compile();
        pdfPath = result?.ok ? (result.pdfPath ?? "") : "";
      }
      if (!pdfPath) {
        setStatusMessage("Compile successfully before synchronizing the PDF");
        return;
      }

      try {
        const location = await window.latexdo.forwardSyncTex(
          projectIdRef.current,
          pdfPath,
          document.relativePath,
          position.lineNumber,
          position.column,
        );
        if (!location) {
          setStatusMessage("No PDF location was found for this source position");
          return;
        }

        setPreviewVisible(true);
        setPdfTarget({ ...location, word });
        setStatusMessage(
          `Showing ${pathForDisplay(document.name)}:${position.lineNumber} in PDF`,
        );
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not synchronize PDF",
        );
      }
    },
    [compile],
  );
  forwardSyncRef.current = handleForwardSync;

  const handleEditorCursorToPdf = useCallback(async () => {
    const editor = editorRef.current;
    const position = editor?.getPosition();
    if (!position) {
      setStatusMessage("Place the cursor in a TeX file before synchronizing the PDF");
      return;
    }
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (
      !document ||
      !document.name.endsWith(".tex") ||
      !editorModelMatchesPath(editor ?? null, document.path)
    ) {
      setStatusMessage("Place the cursor in a TeX file before synchronizing the PDF");
      return;
    }

    await handleForwardSync(position);
  }, [handleForwardSync]);

  const handleBackwardSync = useCallback(
    async (pdfLocation: PdfClickLocation) => {
      const pdfPath = pdfPathRef.current;
      if (!pdfPath) {
        setStatusMessage("Compile successfully before using PDF inverse search");
        return;
      }

      const syncRunId = backwardSyncRunIdRef.current + 1;
      backwardSyncRunIdRef.current = syncRunId;
      const sourceIsDirty = documentsRef.current.some(
        (document) => document.content !== document.savedContent,
      );
      setStatusMessage("Finding source location from PDF...");

      try {
        const location: SyncTexSourceLocation | null =
          await window.latexdo.backwardSyncTex(
            projectIdRef.current,
            pdfPath,
            pdfLocation.page,
            pdfLocation.x,
            pdfLocation.y,
          );
        if (syncRunId !== backwardSyncRunIdRef.current) {
          return;
        }
        if (!location) {
          setStatusMessage(
            "No source location was found. Compile again if the PDF is stale.",
          );
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
        setStatusMessage(
          sourceIsDirty
            ? `Opened ${pathForDisplay(entry.relativePath)}:${location.line} from PDF. Compile if the jump looks stale.`
            : `Opened ${pathForDisplay(entry.relativePath)}:${location.line} from PDF`,
        );
      } catch (error) {
        if (syncRunId !== backwardSyncRunIdRef.current) {
          return;
        }
        setStatusMessage(
          error instanceof Error ? error.message : "Could not synchronize source",
        );
      }
    },
    [openDocument, projectEntries, revealPendingSource],
  );

  const handlePdfPointToSource = useCallback(async () => {
    const location = pdfTarget ?? lastPdfLocation;
    if (!location) {
      setStatusMessage(
        "Show the editor cursor in the PDF or double-click a PDF point first",
      );
      return;
    }

    await handleBackwardSync(location);
  }, [handleBackwardSync, lastPdfLocation, pdfTarget]);

  const handleOpenProjectSearchMatch = useCallback(
    async (match: ProjectSearchMatch) => {
      const entry = allProjectEntries.find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) ===
            normalizeRelativePath(match.path),
      );
      if (!entry) {
        setStatusMessage(`${match.path} is no longer in this project.`);
        return;
      }

      pendingSourceRef.current = {
        path: entry.path,
        line: match.line,
        column: match.column,
        endLine: match.line,
        endColumn: match.endColumn,
      };
      setWelcomeOpen(false);
      await openDocument(entry);
      requestAnimationFrame(() => {
        revealPendingSource();
      });
      setStatusMessage(`Opened ${match.path}:${match.line}:${match.column}`);
    },
    [allProjectEntries, openDocument, revealPendingSource],
  );

  const applyDiagnosticReplacement = useCallback((diagnostic: Diagnostic) => {
    if (
      !diagnostic.replacements?.length ||
      !diagnostic.file ||
      diagnostic.source !== "proofread"
    ) {
      return;
    }

    const targetPath = normalizeRelativePath(diagnostic.file);
    const replacement = diagnostic.replacements[0] ?? "";

    setDocuments((current) => {
      const nextDocuments = current.map((document) => {
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
      });
      documentsRef.current = nextDocuments;
      return nextDocuments;
    });
    setStatusMessage(`Applied suggestion: ${replacement}`);
  }, []);

  const applyLatexDiagnosticFix = useCallback(
    async (diagnostic: Diagnostic, fix: DiagnosticFix) => {
      const currentProject = projectIdRef.current;
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
        (document) => normalizeRelativePath(document.relativePath) === targetPath,
      );
      const content =
        openDocumentState?.content ??
        (await window.latexdo.readFile(currentProject, entry.relativePath));
      const updatedContent = applyTextFix(content, fix);
      if (updatedContent === null) {
        setStatusMessage(
          "The source changed after this analysis. Compile again before applying the fix.",
        );
        return;
      }

      await window.latexdo.writeFile(
        currentProject,
        entry.relativePath,
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
      const editor = editorRef.current;
      const model = editor?.getModel();
      const position = editor?.getPosition();
      const cursorOffset =
        model &&
        position &&
        document.path === activePathRef.current &&
        editorModelMatchesPath(editor ?? null, document.path)
          ? model.getOffsetAt(position)
          : 0;
      const request = buildProofreadingRequest(document.content, cursorOffset);
      const result = await window.latexdo.proofreadDocument(
        document.relativePath,
        request.content,
        request.options,
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
      !activeTextDocument ||
      !supportsProofreading(activeTextDocument.name) ||
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
    activeTextDocument?.content,
    activeTextDocument?.name,
    activeTextDocument?.relativePath,
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
        const hasClosableSurface =
          createDialog !== null ||
          settingsOpen ||
          knowledgeGraphOpen ||
          tikzCanvasOpen ||
          tableCanvasOpen ||
          tikzConverterOpen ||
          notationManagerOpen ||
          citationManagerOpen ||
          gitContextMenu !== null;
        if (!hasClosableSurface) {
          return;
        }
        event.preventDefault();
        setCreateDialog(null);
        setSettingsOpen(false);
        setKnowledgeGraphOpen(false);
        setTikzCanvasOpen(false);
        setTableCanvasOpen(false);
        setTikzConverterOpen(false);
        setNotationManagerOpen(false);
        setCitationManagerOpen(false);
        setGitContextMenu(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    citationManagerOpen,
    compile,
    createDialog,
    gitContextMenu,
    knowledgeGraphOpen,
    notationManagerOpen,
    saveActiveAndCompile,
    settingsOpen,
    tableCanvasOpen,
    tikzCanvasOpen,
    tikzConverterOpen,
  ]);

  useEffect(() => {
    const handleCloseTabKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (
        !modifier ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "w"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeActiveTab();
    };

    window.addEventListener("keydown", handleCloseTabKeyDown, true);
    return () => window.removeEventListener("keydown", handleCloseTabKeyDown, true);
  }, [closeActiveTab]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!activeDocument || !editor) {
      return;
    }
    const model = editor.getModel();
    if (!model || !editorModelMatchesPath(editor, activeDocument.path)) {
      return;
    }
    const relevantDiagnostics = diagnostics.filter(
      (diagnostic) =>
        !diagnostic.file ||
        diagnostic.file === activeDocument.relativePath ||
        fileName(diagnostic.file) === activeDocument.name,
    );
    const lineCount = model.getLineCount();
    monaco.editor.setModelMarkers(
      model,
      "latexdo",
      relevantDiagnostics.map((diagnostic) => {
        const startLineNumber = Math.min(Math.max(1, diagnostic.line), lineCount);
        const endLineNumber = Math.min(
          Math.max(startLineNumber, diagnostic.endLine ?? startLineNumber),
          lineCount,
        );
        const startLineMaxColumn = model.getLineMaxColumn(startLineNumber);
        const endLineMaxColumn = model.getLineMaxColumn(endLineNumber);
        const startColumn = Math.min(
          Math.max(1, diagnostic.column),
          startLineMaxColumn,
        );
        const rawEndColumn = diagnostic.endColumn ?? startColumn + 1;
        const endColumn =
          endLineNumber === startLineNumber
            ? Math.min(
                Math.max(startColumn + 1, rawEndColumn),
                Math.max(startColumn + 1, startLineMaxColumn),
              )
            : Math.min(Math.max(1, rawEndColumn), endLineMaxColumn);
        const reportedLineNumber = diagnostic.reportedLine
          ? Math.min(Math.max(1, diagnostic.reportedLine), lineCount)
          : undefined;
        const reportedColumn = reportedLineNumber
          ? Math.min(
              Math.max(1, diagnostic.reportedColumn ?? 1),
              model.getLineMaxColumn(reportedLineNumber),
            )
          : undefined;

        return {
          startLineNumber,
          startColumn,
          endLineNumber,
          endColumn,
          message: diagnosticMarkerMessage(diagnostic),
          source:
            diagnostic.locationAccuracy === "exact"
              ? "LatexDo analysis"
              : "LaTeX compiler",
          code: diagnostic.code,
          relatedInformation:
            reportedLineNumber && diagnostic.reportedLine !== diagnostic.line
              ? [
                  {
                    resource: model.uri,
                    startLineNumber: reportedLineNumber,
                    startColumn: reportedColumn ?? 1,
                    endLineNumber: reportedLineNumber,
                    endColumn: (reportedColumn ?? 1) + 1,
                    message:
                      "LaTeX stopped here after the earlier root-cause token left the document structure invalid.",
                  },
                ]
              : undefined,
          severity:
            diagnostic.severity === "error"
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
        };
      }),
    );
  }, [activeDocument, diagnostics]);

  const applyBookmarkDecorations = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, lines: number[]) => {
      const model = editor.getModel();
      if (!model) {
        bookmarkDecorationsRef.current = [];
        return;
      }
      const lineCount = model.getLineCount();
      const decorations = normalizeBookmarkLines(lines)
        .filter((line) => line <= lineCount)
        .map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "latexdo-bookmark-line",
            glyphMarginClassName: "latexdo-bookmark-glyph",
            glyphMarginHoverMessage: { value: "Bookmark" },
            overviewRuler: {
              color: "#f5c542",
              position: monaco.editor.OverviewRulerLane.Center,
            },
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        }));

      bookmarkDecorationsRef.current = editor.deltaDecorations(
        bookmarkDecorationsRef.current,
        decorations,
      );
    },
    [],
  );

  const activeBookmarkLinesFromEditor = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (
      !editor ||
      !model ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path) ||
      bookmarkDecorationsRef.current.length === 0
    ) {
      return activeBookmarkLines;
    }

    const lines = bookmarkDecorationsRef.current
      .map((decorationId) => model.getDecorationRange(decorationId)?.startLineNumber)
      .filter((line): line is number => typeof line === "number");
    return normalizeBookmarkLines(lines.length ? lines : activeBookmarkLines);
  }, [activeBookmarkLines, activeDocument]);

  const writeActiveBookmarkLines = useCallback(
    (lines: number[]) => {
      if (!activeBookmarkKey) {
        return;
      }
      const normalized = normalizeBookmarkLines(lines);
      setBookmarkStore((current) => {
        const next = { ...current };
        if (normalized.length) {
          next[activeBookmarkKey] = normalized;
        } else {
          delete next[activeBookmarkKey];
        }
        return next;
      });
    },
    [activeBookmarkKey],
  );

  const toggleBookmarkAtCurrentLine = useCallback(() => {
    const editor = editorRef.current;
    const position = editor?.getPosition();
    if (
      !editor ||
      !position ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      setStatusMessage("Open a document before adding bookmarks.");
      return;
    }

    const currentLines = activeBookmarkLinesFromEditor();
    const exists = currentLines.includes(position.lineNumber);
    const nextLines = exists
      ? currentLines.filter((line) => line !== position.lineNumber)
      : [...currentLines, position.lineNumber];
    writeActiveBookmarkLines(nextLines);
    setStatusMessage(
      exists
        ? `Removed bookmark at line ${position.lineNumber}`
        : `Bookmarked line ${position.lineNumber}`,
    );
    editor.focus();
  }, [activeBookmarkLinesFromEditor, activeDocument, writeActiveBookmarkLines]);

  const jumpToBookmark = useCallback(
    (direction: "next" | "previous") => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (
        !editor ||
        !model ||
        !activeDocument ||
        !editorModelMatchesPath(editor, activeDocument.path)
      ) {
        setStatusMessage("Open a document before using bookmarks.");
        return;
      }

      const lines = activeBookmarkLinesFromEditor().filter(
        (line) => line <= model.getLineCount(),
      );
      if (!lines.length) {
        setStatusMessage("No bookmarks in this file.");
        return;
      }

      const currentLine = editor.getPosition()?.lineNumber ?? 1;
      const targetLine =
        direction === "next"
          ? (lines.find((line) => line > currentLine) ?? lines[0])
          : ([...lines].reverse().find((line) => line < currentLine) ??
            lines[lines.length - 1]);

      editor.setPosition({ lineNumber: targetLine, column: 1 });
      editor.revealLineInCenter(targetLine, monaco.editor.ScrollType.Smooth);
      editor.focus();
      setStatusMessage(`Opened bookmark at line ${targetLine}`);
    },
    [activeBookmarkLinesFromEditor, activeDocument],
  );

  const openLinkAtCursor = useCallback(async () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (
      !editor ||
      !model ||
      !position ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      setStatusMessage("Place the cursor on a link first.");
      return;
    }

    const link = findLatexDocumentLinkAtOffset(
      model.getValue(),
      model.getOffsetAt(position),
    );
    if (!link) {
      setStatusMessage("No LaTeX link at the cursor.");
      return;
    }

    await window.latexdo.openExternalUrl(link.url);
    setStatusMessage(`Opened ${link.url}`);
  }, [activeDocument]);

  const revealOutlineLine = useCallback(
    (line: number, column: number) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (
        !editor ||
        !model ||
        !activeDocument ||
        !editorModelMatchesPath(editor, activeDocument.path)
      ) {
        return;
      }
      const safeLine = Math.min(Math.max(1, line), model.getLineCount());
      const safeColumn = Math.min(
        Math.max(1, column),
        model.getLineMaxColumn(safeLine),
      );
      editor.setPosition({ lineNumber: safeLine, column: safeColumn });
      editor.revealLineInCenter(safeLine, monaco.editor.ScrollType.Smooth);
      editor.focus();
    },
    [activeDocument],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      return;
    }
    applyBookmarkDecorations(editor, activeBookmarkLines);
  }, [activeBookmarkLines, activeDocument, applyBookmarkDecorations]);

  const reviewDecorationsRef = useRef<string[]>([]);

  useEffect(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      !activeDocument ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      return;
    }

    const relevantChats = reviewChats.filter(
      (chat) => chat.filePath === activeDocument.relativePath,
    );
    const decorations = relevantChats.map((chat) => ({
      range: new monaco.Range(
        chat.selection.startLine,
        chat.selection.startColumn,
        chat.selection.endLine,
        chat.selection.endColumn,
      ),
      options: {
        isWholeLine: false,
        className: "review-comment-decoration",
        beforeContentClassName: "review-comment-inline-marker",
        glyphMarginClassName: "review-comment-glyph",
        glyphMargin: { position: monaco.editor.GlyphMarginLane.Center },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        hoverMessage: { value: "Review comment: " + chat.comments[0]?.text },
        glyphMarginHoverMessage: { value: "Review comment: " + chat.comments[0]?.text },
      },
    }));

    reviewDecorationsRef.current = editor.deltaDecorations(
      reviewDecorationsRef.current,
      decorations,
    );
  }, [activeDocument, reviewChats]);

  const latexDecorationsRef = useRef<string[]>([]);

  const updateLatexDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      !activeDocument ||
      !activeDocument.content ||
      !editorModelMatchesPath(editor, activeDocument.path)
    ) {
      return;
    }

    if (settings.showRawLatex) {
      latexDecorationsRef.current = editor.deltaDecorations(
        latexDecorationsRef.current,
        [],
      );
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const ranges: Monaco.editor.IModelDeltaDecoration[] = [];
    const text = activeDocument.content;

    for (const match of text.matchAll(/\\(?:[a-zA-Z]+|\S)|%/g)) {
      const startOffset = match.index!;
      const command = match[0];

      let preText = text.slice(0, startOffset);
      let startLine = 1;
      let lastNewline = -1;
      while (true) {
        const nl = preText.indexOf("\n", lastNewline + 1);
        if (nl === -1 || nl >= startOffset) break;
        startLine++;
        lastNewline = nl;
      }
      let startCol = startOffset - (lastNewline + 1) + 1;

      let endOffset = startOffset + command.length;

      if (command === "%") {
        const nl = text.indexOf("\n", startOffset);
        endOffset = nl === -1 ? text.length : nl;
      } else if (command.startsWith("\\")) {
        const nextChar = text[endOffset];
        if (nextChar === "[") {
          let depth = 1;
          let i = endOffset + 1;
          while (i < text.length && depth > 0) {
            if (text[i] === "[") depth++;
            else if (text[i] === "]") depth--;
            i++;
          }
          endOffset = i;
        }
        if (text[endOffset] === "{") {
          let depth = 1;
          let i = endOffset + 1;
          while (i < text.length && depth > 0) {
            if (text[i] === "{") depth++;
            else if (text[i] === "}") depth--;
            i++;
          }
          endOffset = i;
        }
      }

      let endLine = startLine;
      let endCol = startCol;
      for (let i = startOffset; i < endOffset; i++) {
        if (text[i] === "\n") {
          endLine++;
          endCol = 1;
        } else {
          endCol++;
        }
      }

      ranges.push({
        range: new monaco.Range(startLine, startCol, endLine, endCol),
        options: {
          inlineClassName: "latex-command-hidden",
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }

    latexDecorationsRef.current = editor.deltaDecorations(
      latexDecorationsRef.current,
      ranges,
    );
  }, [activeDocument, settings.showRawLatex]);

  useEffect(() => {
    updateLatexDecorations();
  }, [updateLatexDecorations]);

  const mathPreviewForegrounds: Record<string, string> = {
    graphite: "#d7dce5",
    midnight: "#dce8f8",
    forest: "#e1ebe5",
    sepia: "#eee4d4",
    studio: "#1f2937",
    paper: "#252a31",
  };

  const configureMonaco: BeforeMount = (instance) => {
    monaco = instance;
    const providerDisposables = prepareMonacoProviderDisposables();

    if (!instance.languages.getLanguages().some(({ id }) => id === "latex")) {
      instance.languages.register({
        id: "latex",
        extensions: [".tex", ".sty", ".cls"],
      });
    }
    if (!instance.languages.getLanguages().some(({ id }) => id === "bibtex")) {
      instance.languages.register({ id: "bibtex", extensions: [".bib"] });
    }
    if (!instance.languages.getLanguages().some(({ id }) => id === "asymptote")) {
      instance.languages.register({ id: "asymptote", extensions: [".asy"] });
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
    if (providerDisposables) {
      providerDisposables.push(
        instance.languages.registerFoldingRangeProvider("latex", {
          provideFoldingRanges: (model) =>
            buildLatexFoldingRanges(model.getValue()).map((range) => ({
              start: range.start,
              end: range.end,
              kind:
                range.kind === "comment"
                  ? instance.languages.FoldingRangeKind.Comment
                  : instance.languages.FoldingRangeKind.Region,
            })),
        }),
      );
      providerDisposables.push(
        instance.languages.registerLinkProvider("latex", {
          provideLinks: (model) => ({
            links: findLatexDocumentLinks(model.getValue()).map((link) => ({
              range: new instance.Range(
                link.startLine,
                link.startColumn,
                link.endLine,
                link.endColumn,
              ),
              url: link.url,
              tooltip: `Open ${link.url}`,
            })),
          }),
        }),
      );
    }
    instance.languages.setMonarchTokensProvider("asymptote", {
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [
            /\b(?:access|defaultpen|draw|fill|filldraw|label|pair|path|pen|real|size|string|surface|triple|unitsize)\b/,
            "keyword",
          ],
          [/"([^"\\]|\\.)*$/, "string.invalid"],
          [/"/, "string", "@string"],
          [/[{}[\]();,]/, "delimiter"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, "string", "@pop"],
        ],
      },
    });
    instance.languages.setLanguageConfiguration("asymptote", {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
      ],
    });
    if (providerDisposables) {
      providerDisposables.push(
        instance.languages.registerCompletionItemProvider("asymptote", {
          triggerCharacters: ["(", "."],
          provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };
            return {
              suggestions: [
                ["size", "size(${1:6cm});"],
                ["draw", "draw((${1:0,0})--(${2:1,1}), ${3:blue});"],
                ["fill", "fill(${1:unitcircle}, ${2:lightgray});"],
                ["label", 'label("${1:text}", (${2:0,0}), ${3:N});'],
                ["pair", "pair ${1:p} = (${2:0}, ${3:0});"],
                ["path", "path ${1:p} = (${2:0,0})--(${3:1,1});"],
              ].map(([label, insertText]) => ({
                label,
                kind: instance.languages.CompletionItemKind.Snippet,
                insertText,
                insertTextRules:
                  instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                detail: "Asymptote snippet",
              })),
            };
          },
        }),
      );
      providerDisposables.push(
        instance.languages.registerCompletionItemProvider("latex", {
          triggerCharacters: ["\\", "{", ","],
          provideCompletionItems: async (model, position, _context, token) => {
            const requestVersion = model.getVersionId();
            const requestOffset = model.getOffsetAt(position);
            const requestIsCurrent = () => {
              const editor = editorRef.current;
              const currentPosition = editor?.getPosition();
              return (
                !token.isCancellationRequested &&
                !model.isDisposed() &&
                model.getVersionId() === requestVersion &&
                editor?.getModel() === model &&
                currentPosition !== null &&
                currentPosition !== undefined &&
                model.getOffsetAt(currentPosition) === requestOffset
              );
            };
            const lineContent = model.getLineContent(position.lineNumber);
            const argumentCompletion = getLatexCompletionContext(
              lineContent,
              position.column,
            );
            const commandCompletion = getLatexCommandCompletionRange(
              lineContent,
              position.column,
            );
            const completionRange = (completion: {
              rangeStartColumn: number;
              rangeEndColumn: number;
            }) => completionRangeAtPosition(model, position, completion);
            const currentProject = projectIdRef.current;
            const readCompletionFile = (relativePath: string) =>
              isSafeIpcProjectId(currentProject) &&
              isSafeIpcRelativePath(relativePath, [".tex", ".bib"])
                ? window.latexdo.readFile(currentProject, relativePath)
                : Promise.reject(new Error("Invalid completion file path."));

            // Check if we are inside \cite{...}
            if (argumentCompletion?.type === "citation") {
              if (!isSafeIpcProjectId(currentProject)) {
                return { suggestions: [] };
              }
              const range = completionRange(argumentCompletion);
              const suggestions: Monaco.languages.CompletionItem[] = [];
              const allEntries = flattenEntries(projectEntriesRef.current);
              const bibFiles = allEntries.filter(
                (entry) =>
                  entry.type === "file" &&
                  entry.name.endsWith(".bib") &&
                  isSafeIpcRelativePath(entry.relativePath, [".bib"]),
              );
              for (const bib of bibFiles) {
                if (!requestIsCurrent()) {
                  return { suggestions: [] };
                }
                try {
                  const content = await readCompletionFile(bib.relativePath);
                  const regex = /@\w+\s*{\s*([^,]+),/g;
                  let match;
                  while ((match = regex.exec(content)) !== null) {
                    const key = match[1].trim();
                    const start = match.index;
                    const end = content.indexOf("@", start + 1);
                    const block =
                      end === -1 ? content.slice(start) : content.slice(start, end);

                    const titleMatch = block.match(/title\s*=\s*[{"]([^}"]+)[}"]/i);
                    const authorMatch = block.match(/author\s*=\s*[{"]([^}"]+)[}"]/i);
                    const yearMatch = block.match(/year\s*=\s*[{"]([^}"]+)[}"]/i);

                    const detail = titleMatch
                      ? titleMatch[1].replace(/\s+/g, " ").trim()
                      : "BibTeX Entry";
                    let doc = "";
                    if (authorMatch)
                      doc += `Author: ${authorMatch[1].replace(/\s+/g, " ").trim()}\n`;
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
              if (!requestIsCurrent()) {
                return { suggestions: [] };
              }
              return { suggestions };
            }

            // Check if we are inside \ref{...}
            if (argumentCompletion?.type === "reference") {
              if (!isSafeIpcProjectId(currentProject)) {
                return { suggestions: [] };
              }
              const range = completionRange(argumentCompletion);
              const suggestions: Monaco.languages.CompletionItem[] = [];
              const allEntries = flattenEntries(projectEntriesRef.current);
              const texFiles = allEntries.filter(
                (entry) =>
                  entry.type === "file" &&
                  entry.name.endsWith(".tex") &&
                  isSafeIpcRelativePath(entry.relativePath, [".tex"]),
              );

              const openDocs = new Map(
                documentsRef.current.map((d) => [d.path, d.content]),
              );

              for (const tex of texFiles) {
                if (!requestIsCurrent()) {
                  return { suggestions: [] };
                }
                try {
                  let content = openDocs.get(tex.path);
                  if (content === undefined) {
                    content = await readCompletionFile(tex.relativePath);
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
              if (!requestIsCurrent()) {
                return { suggestions: [] };
              }
              // Remove duplicates
              const unique = new Map();
              for (const s of suggestions) unique.set(s.label, s);
              return { suggestions: Array.from(unique.values()) };
            }

            // Default snippet completion (triggered by \)
            if (commandCompletion) {
              const range = completionRange(commandCompletion);
              const builtInSuggestions: Monaco.languages.CompletionItem[] =
                latexCommandSnippets.map((snippet) => ({
                  label: `\\${snippet.label}`,
                  kind: instance.languages.CompletionItemKind.Snippet,
                  insertText: snippet.insertText,
                  insertTextRules:
                    instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  detail: snippet.detail,
                  documentation: snippet.documentation,
                }));
              const mathSuggestions: Monaco.languages.CompletionItem[] =
                SYMBOL_PALETTE.map((symbol) => ({
                  label: symbol.latex,
                  kind: instance.languages.CompletionItemKind.Operator,
                  insertText: symbol.latex,
                  range,
                  detail: `${symbol.display} math symbol`,
                  documentation: symbol.search,
                }));
              const extensionSuggestions: Monaco.languages.CompletionItem[] =
                installedExtensionSnippetsRef.current.map((snippet) => ({
                  label: `\\${snippet.label}`,
                  kind: instance.languages.CompletionItemKind.Snippet,
                  insertText: snippet.insertText,
                  insertTextRules:
                    instance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  detail: snippet.detail ?? "Extension snippet",
                  documentation: snippet.documentation,
                }));

              return {
                suggestions: [
                  ...builtInSuggestions,
                  ...mathSuggestions,
                  ...extensionSuggestions,
                ],
              };
            }

            return { suggestions: [] };
          },
        }),
      );
      providerDisposables.push(
        instance.languages.registerHoverProvider("latex", {
          provideHover: async (model, position) => {
            try {
              const { parseMathAtPosition, mathPreviewDataUri } =
                await import("./latex/mathPreview");
              const mathTarget = parseMathAtPosition(
                model.getValue(),
                position.lineNumber,
                position.column,
              );
              if (mathTarget) {
                const foreground =
                  mathPreviewForegrounds[settingsRef.current.colorTheme] ?? "#d7dce5";
                const rendered = mathPreviewDataUri(
                  mathTarget.tex,
                  mathTarget.display,
                  foreground,
                );
                if (rendered) {
                  return {
                    range: new instance.Range(
                      mathTarget.startLine,
                      mathTarget.startColumn,
                      mathTarget.endLine,
                      mathTarget.endColumn,
                    ),
                    contents: [{ value: `![equation](${rendered})` }],
                  };
                }
              }
            } catch {
              // Equation preview is best-effort; fall through to other hovers.
            }

            const includeTarget = parseIncludeGraphicsAtPosition(
              model.getLineContent(position.lineNumber),
              position.column,
            );
            if (!includeTarget) {
              return null;
            }

            const currentProject = projectIdRef.current;
            const document = documentsRef.current.find(
              (item) => item.path === activePathRef.current,
            );
            if (!isSafeIpcProjectId(currentProject) || !document) {
              return null;
            }

            const candidates = figurePreviewCandidatePaths(
              includeTarget.path,
              document.relativePath,
            );
            const range = new instance.Range(
              position.lineNumber,
              includeTarget.startColumn,
              position.lineNumber,
              includeTarget.endColumn,
            );

            if (!candidates.length) {
              return {
                range,
                contents: [
                  {
                    value: `**Figure preview**\n\nCannot resolve \`${includeTarget.rawPath.trim()}\`.`,
                  },
                ],
              };
            }

            for (const candidate of candidates) {
              if (
                !isSafeIpcRelativePath(candidate, [
                  ".png",
                  ".jpg",
                  ".jpeg",
                  ".svg",
                  ".pdf",
                ])
              ) {
                continue;
              }

              if (!figureCanRenderInline(candidate)) {
                if (figurePreviewMimeType(candidate) === "application/pdf") {
                  try {
                    if (await window.latexdo.fileExists(currentProject, candidate)) {
                      return {
                        range,
                        contents: [
                          {
                            value: `**Figure**\n\n\`${candidate}\`\n\nPDF figures preview in the compiled PDF.`,
                          },
                        ],
                      };
                    }
                  } catch {
                    // Try the next candidate.
                  }
                }
                continue;
              }

              const mimeType = figurePreviewMimeType(candidate);
              if (!mimeType) {
                continue;
              }

              try {
                const cacheKey = `${currentProject}:${candidate}`;
                let dataUrl = figurePreviewCacheRef.current.get(cacheKey);
                if (!dataUrl) {
                  if (!(await window.latexdo.fileExists(currentProject, candidate))) {
                    continue;
                  }
                  const bytes = await window.latexdo.readAsset(
                    currentProject,
                    candidate,
                  );
                  dataUrl = figureBytesToDataUrl(bytes, mimeType);
                  figurePreviewCacheRef.current.set(cacheKey, dataUrl);
                }

                return {
                  range,
                  contents: [
                    {
                      supportHtml: true,
                      value: [
                        '<div class="latexdo-figure-hover">',
                        `<strong>${escapeHtml(candidate)}</strong>`,
                        `<img src="${dataUrl}" alt="${escapeHtml(fileName(candidate))}" />`,
                        "</div>",
                      ].join(""),
                    },
                  ],
                };
              } catch {
                // Try the next candidate.
              }
            }

            return {
              range,
              contents: [
                {
                  value: `**Figure not found**\n\nTried: ${candidates
                    .map((candidate) => `\`${candidate}\``)
                    .join(", ")}`,
                },
              ],
            };
          },
        }),
      );
    }
    const sharedRules = [
      { token: "comment", foreground: "6B7280", fontStyle: "italic" },
      { token: "keyword", foreground: "7CA6FF" },
      { token: "keyword.control", foreground: "C099FF" },
      { token: "string", foreground: "8FCB9B" },
      { token: "number", foreground: "E5A66E" },
      { token: "delimiter", foreground: "D5DAE3" },
    ];
    const themes = [
      {
        id: "latexdo-graphite",
        base: "vs-dark" as const,
        rules: sharedRules,
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
      },
      {
        id: "latexdo-midnight",
        base: "vs-dark" as const,
        rules: [
          { token: "comment", foreground: "64748B", fontStyle: "italic" },
          { token: "keyword", foreground: "74B8FF" },
          { token: "keyword.control", foreground: "BFA7FF" },
          { token: "string", foreground: "8DE0C0" },
          { token: "number", foreground: "F3B77A" },
          { token: "delimiter", foreground: "D8E4F4" },
        ],
        colors: {
          "editor.background": "#0b1424",
          "editor.foreground": "#dce8f8",
          "editorLineNumber.foreground": "#536176",
          "editorLineNumber.activeForeground": "#b4c6de",
          "editor.lineHighlightBackground": "#101d31",
          "editorCursor.foreground": "#5fa8ff",
          "editor.selectionBackground": "#235a9288",
          "editor.inactiveSelectionBackground": "#1c3c6388",
          "editorIndentGuide.background1": "#1c2b40",
          "editorIndentGuide.activeBackground1": "#36516f",
        },
      },
      {
        id: "latexdo-forest",
        base: "vs-dark" as const,
        rules: [
          { token: "comment", foreground: "6D7D73", fontStyle: "italic" },
          { token: "keyword", foreground: "76D99B" },
          { token: "keyword.control", foreground: "D1B3FF" },
          { token: "string", foreground: "A9D992" },
          { token: "number", foreground: "E7B978" },
          { token: "delimiter", foreground: "DCE7DF" },
        ],
        colors: {
          "editor.background": "#111a16",
          "editor.foreground": "#e1ebe5",
          "editorLineNumber.foreground": "#536159",
          "editorLineNumber.activeForeground": "#b8c8bf",
          "editor.lineHighlightBackground": "#17231d",
          "editorCursor.foreground": "#65c28f",
          "editor.selectionBackground": "#2f6f4c88",
          "editor.inactiveSelectionBackground": "#24483688",
          "editorIndentGuide.background1": "#213029",
          "editorIndentGuide.activeBackground1": "#3a5848",
        },
      },
      {
        id: "latexdo-sepia",
        base: "vs-dark" as const,
        rules: [
          { token: "comment", foreground: "8D7C69", fontStyle: "italic" },
          { token: "keyword", foreground: "E2A86D" },
          { token: "keyword.control", foreground: "D9A6E8" },
          { token: "string", foreground: "B7C982" },
          { token: "number", foreground: "F0BD72" },
          { token: "delimiter", foreground: "E8D9C4" },
        ],
        colors: {
          "editor.background": "#1b1510",
          "editor.foreground": "#eee4d4",
          "editorLineNumber.foreground": "#6d5f50",
          "editorLineNumber.activeForeground": "#cdbda8",
          "editor.lineHighlightBackground": "#241b14",
          "editorCursor.foreground": "#d69a5b",
          "editor.selectionBackground": "#80542e88",
          "editor.inactiveSelectionBackground": "#5d3e2688",
          "editorIndentGuide.background1": "#31261d",
          "editorIndentGuide.activeBackground1": "#5d4633",
        },
      },
      {
        id: "latexdo-studio",
        base: "vs" as const,
        rules: [
          { token: "comment", foreground: "667085", fontStyle: "italic" },
          { token: "keyword", foreground: "1D5FD0" },
          { token: "keyword.control", foreground: "7A3FB3" },
          { token: "string", foreground: "21815F" },
          { token: "number", foreground: "B15D22" },
          { token: "delimiter", foreground: "374151" },
        ],
        colors: {
          "editor.background": "#ffffff",
          "editor.foreground": "#1f2937",
          "editorLineNumber.foreground": "#9aa4b2",
          "editorLineNumber.activeForeground": "#374151",
          "editor.lineHighlightBackground": "#f3f6fb",
          "editorCursor.foreground": "#2f6fdb",
          "editor.selectionBackground": "#c9dcff",
          "editor.inactiveSelectionBackground": "#dce7fb",
          "editorIndentGuide.background1": "#dde4ef",
          "editorIndentGuide.activeBackground1": "#9fb2d0",
        },
      },
      {
        id: "latexdo-paper",
        base: "vs" as const,
        rules: [
          { token: "comment", foreground: "6b7280", fontStyle: "italic" },
          { token: "keyword", foreground: "1f6eb3" },
          { token: "keyword.control", foreground: "8b4aa6" },
          { token: "string", foreground: "1d7a56" },
          { token: "number", foreground: "a65f1b" },
          { token: "delimiter", foreground: "3a414c" },
        ],
        colors: {
          "editor.background": "#fffefa",
          "editor.foreground": "#252a31",
          "editorLineNumber.foreground": "#a0a8b2",
          "editorLineNumber.activeForeground": "#3a414c",
          "editor.lineHighlightBackground": "#f2f6f1",
          "editorCursor.foreground": "#2f8f6b",
          "editor.selectionBackground": "#cce8d9",
          "editor.inactiveSelectionBackground": "#e1efe7",
          "editorIndentGuide.background1": "#dce5dd",
          "editorIndentGuide.activeBackground1": "#98b6a6",
        },
      },
    ];

    for (const theme of themes) {
      instance.editor.defineTheme(theme.id, {
        base: theme.base,
        inherit: true,
        rules: theme.rules,
        colors: theme.colors,
      });
    }
  };

  const disposeCollaborationBinding = useCallback(() => {
    collaborationBindingRequestIdRef.current += 1;
    collaborationBindingRef.current?.destroy();
    collaborationBindingRef.current = null;
  }, []);

  const connectCollaborationBinding = useCallback(
    (editor = editorRef.current) => {
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      const token = collaborationState.token;

      if (
        !editor ||
        !document ||
        !isTextDocument(document) ||
        !projectIdRef.current ||
        !collaborationAvailable ||
        !collaborationState.enabled ||
        !token ||
        !editorModelMatchesPath(editor, document.path)
      ) {
        disposeCollaborationBinding();
        return;
      }

      const bindingKey = `${projectIdRef.current}:${document.relativePath}:${token}:${collaborationDisplayName}`;
      if (collaborationBindingRef.current?.key === bindingKey) {
        return;
      }

      disposeCollaborationBinding();
      const requestId = ++collaborationBindingRequestIdRef.current;
      setRealtimeReadyDocuments((current) => {
        if (!current.has(document.relativePath)) return current;
        const next = new Set(current);
        next.delete(document.relativePath);
        realtimeReadyDocumentsRef.current = next;
        return next;
      });
      const bindingProjectId = projectIdRef.current;
      void import("./collaboration/MonacoCollaborationBinding").then(
        ({ MonacoCollaborationBinding }) => {
          const currentDocument = documentsRef.current.find(
            (item) => item.path === activePathRef.current,
          );
          if (
            collaborationBindingRequestIdRef.current !== requestId ||
            editorRef.current !== editor ||
            !editorModelMatchesPath(editor, document.path) ||
            projectIdRef.current !== bindingProjectId ||
            currentDocument?.relativePath !== document.relativePath ||
            !collaborationState.enabled ||
            collaborationState.token !== token
          ) {
            return;
          }

          collaborationBindingRef.current = new MonacoCollaborationBinding({
            editor,
            projectId: bindingProjectId,
            relativePath: document.relativePath,
            shareToken: token,
            apiBaseUrl: collaboration.apiBaseUrl,
            clientName: collaborationDisplayName,
            color: collaboration.color,
            onStatusChange: (status) => {
              if (status === "connected") {
                setStatusMessage(
                  `Live collaboration syncing: ${pathForDisplay(document.relativePath)}`,
                );
              } else if (status === "error") {
                setStatusMessage("Live collaboration connection failed.");
              }
            },
            onSynced: () => {
              setRealtimeBlockedDocuments((current) => {
                if (!(document.relativePath in current)) return current;
                const next = { ...current };
                delete next[document.relativePath];
                realtimeBlockedDocumentsRef.current = next;
                return next;
              });
              setRealtimeReadyDocuments((current) => {
                const next = new Set(current).add(document.relativePath);
                realtimeReadyDocumentsRef.current = next;
                return next;
              });
              setStatusMessage(
                `Live collaboration connected: ${pathForDisplay(document.relativePath)}`,
              );
            },
            onConnectionError: (message, status) => {
              if (status && [400, 403, 404, 413, 415].includes(status)) {
                setRealtimeBlockedDocuments((current) => {
                  const next = { ...current, [document.relativePath]: message };
                  realtimeBlockedDocumentsRef.current = next;
                  return next;
                });
                setRealtimeReadyDocuments((current) => {
                  if (!current.has(document.relativePath)) return current;
                  const next = new Set(current);
                  next.delete(document.relativePath);
                  realtimeReadyDocumentsRef.current = next;
                  return next;
                });
                queueMicrotask(disposeCollaborationBinding);
                void window.latexdo
                  .readFile(bindingProjectId, document.relativePath)
                  .then((content) => {
                    if (projectIdRef.current !== bindingProjectId) return;
                    setDocuments((current) => {
                      const next = current.map((item) =>
                        item.relativePath === document.relativePath
                          ? { ...item, content, savedContent: content }
                          : item,
                      );
                      documentsRef.current = next;
                      return next;
                    });
                    setStatusMessage(
                      `Read-only authoritative copy loaded: ${pathForDisplay(document.relativePath)}`,
                    );
                  })
                  .catch((error: unknown) => {
                    setStatusMessage(
                      error instanceof Error
                        ? `Could not reload the authoritative copy: ${error.message}`
                        : "Could not reload the authoritative copy.",
                    );
                  });
              }
              setStatusMessage(`Live collaboration unavailable: ${message}`);
            },
            onPresenceChange: (users) => {
              setCollaborationState((current) => ({ ...current, users }));
            },
          });
        },
      );
    },
    [
      collaboration.apiBaseUrl,
      collaborationDisplayName,
      collaboration.color,
      collaborationAvailable,
      collaborationState.enabled,
      collaborationState.token,
      disposeCollaborationBinding,
    ],
  );

  useEffect(() => {
    connectCollaborationBinding();
  }, [
    activePath,
    collaborationState.enabled,
    collaborationState.token,
    connectCollaborationBinding,
    projectId,
  ]);

  useEffect(() => disposeCollaborationBinding, [disposeCollaborationBinding]);

  useEffect(() => {
    realtimeBlockedDocumentsRef.current = {};
    realtimeReadyDocumentsRef.current = new Set();
    setRealtimeBlockedDocuments({});
    setRealtimeReadyDocuments(new Set());
  }, [projectId, collaborationState.token]);

  const applyEditorBlameDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (!editorModelMatchesPath(editor, activePathRef.current)) return;

    const state = editorBlameStateRef.current;
    const now = new Date();

    const inlineDecorations: Monaco.editor.IModelDeltaDecoration[] = [];
    if (state.inlineEnabled && !state.fileBlameEnabled && state.byLine.size) {
      const position = editor.getPosition();
      if (position && position.lineNumber <= model.getLineCount()) {
        const lineNumber = position.lineNumber;
        const blame = state.byLine.get(lineNumber);
        const text = state.dirty
          ? unsavedChangesBlameText()
          : blame
            ? inlineBlameText(blame, now)
            : "";
        if (text) {
          const column = model.getLineMaxColumn(lineNumber);
          inlineDecorations.push({
            range: new monaco.Range(lineNumber, column, lineNumber, column),
            options: {
              after: {
                content: "\u00a0\u00a0\u00a0\u00a0" + text,
                inlineClassName: "git-inline-blame",
                cursorStops: monaco.editor.InjectedTextCursorStops.None,
              },
            },
          });
        }
      }
    }
    inlineBlameDecorationsRef.current = editor.deltaDecorations(
      inlineBlameDecorationsRef.current,
      inlineDecorations,
    );

    const gutterDecorations: Monaco.editor.IModelDeltaDecoration[] = [];
    if (state.fileBlameEnabled && !state.dirty && state.byLine.size) {
      const annotations = buildBlameAnnotations([...state.byLine.values()], now);
      const lineCount = model.getLineCount();
      for (const annotation of annotations) {
        if (annotation.lineNumber > lineCount) continue;
        gutterDecorations.push({
          range: new monaco.Range(annotation.lineNumber, 1, annotation.lineNumber, 1),
          options: {
            before: {
              content: annotation.gutterText + "\u2002",
              inlineClassName: `git-blame-gutter git-blame-heat-${annotation.heatLevel}`,
              cursorStops: monaco.editor.InjectedTextCursorStops.None,
            },
          },
        });
      }
    }
    fileBlameDecorationsRef.current = editor.deltaDecorations(
      fileBlameDecorationsRef.current,
      gutterDecorations,
    );
  }, []);

  const refreshEditorBlame = useCallback(async () => {
    const currentProject = projectIdRef.current;
    const currentPath = activePathRef.current;
    const currentDocument = documentsRef.current.find(
      (document) => document.path === currentPath,
    );
    const sequence = ++editorBlameFetchSeqRef.current;
    if (!currentProject || !currentDocument || !isTextDocument(currentDocument)) {
      setEditorBlameLines([]);
      return;
    }

    try {
      const blame = await window.latexdo.getGitBlame(
        currentProject,
        currentDocument.relativePath,
        {
          kind: "working-tree",
        },
      );
      if (
        sequence === editorBlameFetchSeqRef.current &&
        currentPath === activePathRef.current
      ) {
        setEditorBlameLines(blame);
      }
    } catch {
      if (sequence === editorBlameFetchSeqRef.current) {
        setEditorBlameLines([]);
      }
    }
  }, []);

  useEffect(() => {
    setEditorBlameLines([]);
    void refreshEditorBlame();
  }, [activePath, projectId, refreshEditorBlame]);

  useEffect(() => {
    return window.latexdo.onGitChanged((event: GitChangedEvent) => {
      if (event.projectId === projectIdRef.current) {
        void refreshEditorBlame();
      }
    });
  }, [refreshEditorBlame]);

  useEffect(() => {
    editorBlameStateRef.current = {
      byLine: blameByLine(editorBlameLines),
      dirty: activeTextDocument
        ? activeTextDocument.content !== activeTextDocument.savedContent
        : false,
      inlineEnabled: settings.inlineBlame,
      fileBlameEnabled,
    };
    applyEditorBlameDecorations();
  }, [
    editorBlameLines,
    activeTextDocument,
    settings.inlineBlame,
    fileBlameEnabled,
    applyEditorBlameDecorations,
  ]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    editorMouseDisposableRef.current?.dispose();
    for (const disposable of editorActionDisposablesRef.current) {
      disposable.dispose();
    }
    for (const disposable of editorBlameDisposablesRef.current) {
      disposable.dispose();
    }
    editorBlameDisposablesRef.current = [
      editor.onDidChangeCursorPosition(() => {
        applyEditorBlameDecorations();
      }),
      editor.onDidChangeModel(() => {
        inlineBlameDecorationsRef.current = [];
        fileBlameDecorationsRef.current = [];
        applyEditorBlameDecorations();
      }),
    ];
    for (const disposable of blameHoverDisposablesRef.current) {
      disposable.dispose();
    }
    blameHoverDisposablesRef.current = [
      "latex",
      "bibtex",
      "asymptote",
      "markdown",
      "json",
      "plaintext",
    ].map((language) =>
      monaco.languages.registerHoverProvider(language, {
        provideHover: (model, position) => {
          if (editorRef.current?.getModel() !== model) return null;
          const state = editorBlameStateRef.current;
          if (state.dirty) return null;
          const blame = state.byLine.get(position.lineNumber);
          if (!blame) return null;
          return {
            range: new monaco.Range(
              position.lineNumber,
              1,
              position.lineNumber,
              model.getLineMaxColumn(position.lineNumber),
            ),
            contents: [{ value: blameHoverMarkdown(blame, new Date()) }],
          };
        },
      }),
    );
    editorActionDisposablesRef.current = [
      editor.addAction({
        id: "latexdo.toggleFileBlame",
        label: "Git: Toggle File Blame Annotations",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyB],
        contextMenuGroupId: "navigation",
        contextMenuOrder: 0,
        run: () => setFileBlameEnabled((current) => !current),
      }),
      editor.addAction({
        id: "latexdo.toggleBookmark",
        label: "Toggle Bookmark",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2],
        contextMenuGroupId: "navigation",
        contextMenuOrder: 1,
        run: () => toggleBookmarkAtCurrentLine(),
      }),
      editor.addAction({
        id: "latexdo.nextBookmark",
        label: "Go to Next Bookmark",
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F2],
        contextMenuGroupId: "navigation",
        contextMenuOrder: 2,
        run: () => jumpToBookmark("next"),
      }),
      editor.addAction({
        id: "latexdo.previousBookmark",
        label: "Go to Previous Bookmark",
        keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.F2],
        contextMenuGroupId: "navigation",
        contextMenuOrder: 3,
        run: () => jumpToBookmark("previous"),
      }),
      editor.addAction({
        id: "latexdo.openLinkAtCursor",
        label: "Open Link at Cursor",
        contextMenuGroupId: "navigation",
        contextMenuOrder: 4,
        run: () => openLinkAtCursor(),
      }),
      editor.addAction({
        id: "latexdo.formatLatexTable",
        label: "Format LaTeX Table",
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 1,
        run: () => applyLatexToolbarCommand("formatTable"),
      }),
      editor.addAction({
        id: "latexdo.continueLatexList",
        label: "Continue or Close LaTeX List",
        keybindings: [monaco.KeyCode.Enter],
        precondition:
          "editorTextFocus && editorLangId == 'latex' && !suggestWidgetVisible",
        run: (targetEditor) => {
          const model = targetEditor.getModel();
          const position = targetEditor.getPosition();
          const selections = targetEditor.getSelections() ?? [];

          if (
            !model ||
            !position ||
            selections.length !== 1 ||
            !selections[0].isEmpty()
          ) {
            targetEditor.trigger("keyboard", "type", { text: "\n" });
            return;
          }

          const edit = getLatexListEnterEdit(
            model.getValue(),
            model.getOffsetAt(position),
          );
          if (!edit) {
            targetEditor.trigger("keyboard", "type", { text: "\n" });
            return;
          }

          const start = model.getPositionAt(edit.startOffset);
          const end = model.getPositionAt(edit.endOffset);
          targetEditor.executeEdits("latex-list-enter", [
            {
              range: new monaco.Range(
                start.lineNumber,
                start.column,
                end.lineNumber,
                end.column,
              ),
              text: edit.text,
              forceMoveMarkers: true,
            },
          ]);

          const cursor = model.getPositionAt(edit.startOffset + edit.cursorOffset);
          targetEditor.setPosition(cursor);
          targetEditor.revealPositionInCenterIfOutsideViewport(cursor);
        },
      }),
    ];
    applyBookmarkDecorations(editor, activeBookmarkLines);
    editorMouseDisposableRef.current = editor.onMouseDown((event) => {
      if (event.event.detail === 2 && event.target.position) {
        void forwardSyncRef.current?.(event.target.position);
      }
    });
    requestAnimationFrame(() => {
      revealPendingSource();
    });
    connectCollaborationBinding(editor);
    editor.focus();
  };

  const handleEditorChange = useCallback((documentPath: string, value?: string) => {
    const nextContent = value ?? "";
    if (!documentPath) return;
    if (
      documentsRef.current.find((document) => document.path === documentPath)
        ?.content === nextContent
    ) {
      return;
    }

    setDocuments((current) => {
      const nextDocuments = current.map((document) =>
        document.path === documentPath
          ? { ...document, content: nextContent }
          : document,
      );
      documentsRef.current = nextDocuments;
      return nextDocuments;
    });
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !activeDocument) {
      return;
    }

    if (!editorModelMatchesPath(editor, activeDocument.path)) {
      return;
    }

    if (model.getValue() === activeDocument.content) {
      return;
    }

    const selections = editor.getSelections() ?? [];
    const scrollTop = editor.getScrollTop();
    const scrollLeft = editor.getScrollLeft();

    editor.executeEdits("latexdo-sync-document", [
      {
        range: model.getFullModelRange(),
        text: activeDocument.content,
        forceMoveMarkers: true,
      },
    ]);

    const updatedModel = editor.getModel();
    if (updatedModel && selections.length) {
      editor.setSelections(
        selections.map((selection) => clampSelectionToModel(updatedModel, selection)),
      );
    }
    editor.setScrollTop(scrollTop);
    editor.setScrollLeft(scrollLeft);
  }, [activeDocument?.content, activeDocument?.path]);

  const insertLatexBlockAtEditorPosition = useCallback(
    (text: string, position?: Monaco.IPosition | null): boolean => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (
        !editor ||
        !model ||
        !document ||
        !editorModelMatchesPath(editor, document.path)
      ) {
        return false;
      }

      const target = position ??
        editor.getPosition() ?? {
          lineNumber: model.getLineCount(),
          column: model.getLineMaxColumn(model.getLineCount()),
        };
      const lineBefore = model
        .getLineContent(target.lineNumber)
        .slice(0, target.column - 1);
      const textToInsert = `${lineBefore.trim() ? "\n" : ""}${text}\n`;
      const startOffset = model.getOffsetAt(target);
      const range = new monaco.Range(
        target.lineNumber,
        target.column,
        target.lineNumber,
        target.column,
      );

      editor.executeEdits("latexdo-insert-block", [
        {
          range,
          text: textToInsert,
          forceMoveMarkers: true,
        },
      ]);
      editor.setPosition(model.getPositionAt(startOffset + textToInsert.length));
      editor.focus();
      return true;
    },
    [],
  );

  const editorTheme = monacoThemeFor(settings.colorTheme);

  useEffect(
    () => () => {
      editorMouseDisposableRef.current?.dispose();
      for (const disposable of editorActionDisposablesRef.current) {
        disposable.dispose();
      }
      editorActionDisposablesRef.current = [];
      if (sourceSyncClearTimerRef.current !== null) {
        window.clearTimeout(sourceSyncClearTimerRef.current);
        sourceSyncClearTimerRef.current = null;
      }
      const editor = editorRef.current;
      if (editor) {
        sourceSyncDecorationsRef.current = editor.deltaDecorations(
          sourceSyncDecorationsRef.current,
          [],
        );
        bookmarkDecorationsRef.current = editor.deltaDecorations(
          bookmarkDecorationsRef.current,
          [],
        );
      }
      if (historySaveTimerRef.current !== null) {
        window.clearTimeout(historySaveTimerRef.current);
      }
      if (historyAutoCaptureTimerRef.current !== null) {
        window.clearTimeout(historyAutoCaptureTimerRef.current);
      }
    },
    [],
  );

  const openProject = async () => {
    try {
      const project = await window.latexdo.openProject();
      if (project) {
        await loadProject(project, true, false);
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not open folder.",
      );
    }
  };

  const copyToClipboard = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = globalThis.document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    globalThis.document.body.append(textarea);
    textarea.focus();
    textarea.select();
    globalThis.document.execCommand("copy");
    textarea.remove();
  };

  const refreshCollaborationState = useCallback(
    async (currentProject = projectIdRef.current) => {
      if (!currentProject || !collaborationAvailable) {
        setCollaborationState({ enabled: false, users: [] });
        return;
      }

      try {
        const state = await window.latexdo.getCollaborationState(currentProject);
        setCollaborationState(state);
        if (state.currentUserRole) {
          setCurrentUserRole(state.currentUserRole);
        }
        if (typeof state.isAdmin === "boolean") {
          setIsProjectAdmin(state.isAdmin);
        }
      } catch {
        setCollaborationState({ enabled: false, users: [] });
      }
    },
    [collaborationAvailable],
  );

  const createCollaborationLink = async () => {
    setShareDialogOpen(true);
    setJoinCollaborationError("");
    const currentProject = projectIdRef.current;
    if (!currentProject) {
      setStatusMessage("Paste a collaboration token or open a project to share.");
      return;
    }

    if (!collaborationAvailable) {
      setStatusMessage("Cloud collaboration is not available in this runtime.");
      return;
    }

    setCollaborationBusy(true);
    try {
      const dirtyDocuments = documentsRef.current.filter(
        (document) => document.content !== document.savedContent,
      );
      await Promise.all(dirtyDocuments.map((document) => saveDocument(document)));

      const state = await window.latexdo.createCollaborationLink(currentProject);
      let activeState = state;

      if (state.token && state.projectId && state.projectId !== currentProject) {
        const opened = await window.latexdo.joinCollaboration(state.token);
        activeState = opened.collaboration;
        await loadProject(opened.project, true, false);
      }

      setCollaborationState(activeState);
      const activeProjectId = activeState.projectId ?? projectIdRef.current;
      if (activeProjectId) {
        await loadCollaborationPermissions(activeProjectId);
      }
      const tokenOrUrl = activeState.token ?? activeState.shareUrl;
      if (tokenOrUrl) {
        await copyToClipboard(tokenOrUrl);
        setCollaborationCopied(true);
        window.setTimeout(() => setCollaborationCopied(false), 1800);
        setStatusMessage("Collaboration token copied");
      } else {
        setStatusMessage("Collaboration token ready");
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not create collaboration link",
      );
    } finally {
      setCollaborationBusy(false);
    }
  };

  const regenerateCollaborationLink = async () => {
    const currentProject = collaborationState.projectId ?? projectIdRef.current;
    if (!currentProject) {
      setStatusMessage("Open a shared project to regenerate its link.");
      return;
    }
    if (!collaborationAvailable) {
      setStatusMessage("Cloud collaboration is not available in this runtime.");
      return;
    }

    setCollaborationBusy(true);
    try {
      const state = await window.latexdo.rotateCollaborationLink(currentProject);
      setCollaborationState(state);
      const activeProjectId = state.projectId ?? currentProject;
      await loadCollaborationPermissions(activeProjectId);
      const tokenOrUrl = state.token ?? state.shareUrl;
      if (tokenOrUrl) {
        await copyToClipboard(tokenOrUrl);
        setCollaborationCopied(true);
        window.setTimeout(() => setCollaborationCopied(false), 1800);
        setStatusMessage(
          "New collaboration link copied. The old link no longer works.",
        );
      } else {
        setStatusMessage("Collaboration link regenerated.");
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Could not regenerate collaboration link",
      );
    } finally {
      setCollaborationBusy(false);
    }
  };

  const joinCollaborationFromDialog = async () => {
    const token = joinTokenDraft.trim();
    if (!token || joinCollaborationBusy) {
      return;
    }

    setJoinCollaborationBusy(true);
    setJoinCollaborationError("");
    setStatusMessage("Joining collaboration...");
    try {
      const opened = await window.latexdo.joinCollaboration(token);
      setCollaborationState(opened.collaboration);
      setJoinTokenDraft("");
      await loadProject(opened.project, true, false);
      setShareDialogOpen(false);
      setStatusMessage("Joined shared project");
      await loadCollaborationPermissions(opened.project.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not join collaboration";
      setJoinCollaborationError(message);
      setStatusMessage(message);
    } finally {
      setJoinCollaborationBusy(false);
    }
  };

  const loadCollaborationPermissions = useCallback(
    async (projectId: string) => {
      if (!collaborationAvailable) return;

      try {
        const result = await window.latexdo.getCollaborationPermissions(projectId);
        setCollaborationPermissions(result.permissions);
        setIsProjectAdmin(result.isAdmin);
        setCurrentUserRole(result.currentUserRole as "admin" | "editor" | "viewer");
      } catch {
        setCollaborationPermissions([]);
        setIsProjectAdmin(false);
        setCurrentUserRole("viewer");
      }
    },
    [collaborationAvailable],
  );

  const handleUpdatePermission = useCallback(
    async (update: { clientId: string; role: "admin" | "editor" | "viewer" }) => {
      const currentProject = projectIdRef.current;
      if (!currentProject || !collaborationAvailable) return;

      try {
        await window.latexdo.updateCollaborationPermission(currentProject, update);
        await loadCollaborationPermissions(currentProject);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to update permission",
        );
      }
    },
    [collaborationAvailable, loadCollaborationPermissions],
  );

  const handleRemoveCollaborator = useCallback(
    async (clientId: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject || !collaborationAvailable) return;

      try {
        await window.latexdo.removeCollaborator(currentProject, clientId);
        await loadCollaborationPermissions(currentProject);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to remove collaborator",
        );
      }
    },
    [collaborationAvailable, loadCollaborationPermissions],
  );

  const handleCollaborationDisplayNameChange = useCallback((value: string) => {
    const nextName = storeCollaborationDisplayName(value);
    setCollaborationDisplayName(nextName);
  }, []);

  const createProject = async () => {
    try {
      const project = await window.latexdo.createProject();
      if (project) {
        await loadProject(project, true, false);
        setStatusMessage("Project created");
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not create project",
      );
    }
  };

  const createProjectFromTemplate = async (template: WelcomeTemplate) => {
    if (templateCreating) return;

    setTemplateCreating(template.id);
    setStatusMessage(`Creating ${template.name} project...`);
    try {
      const project = await window.latexdo.createProject({
        folderName: template.name,
      });
      if (!project) {
        return;
      }

      await window.latexdo.writeFile(project.id, "main.tex", template.mainTex);
      if (template.bibTex) {
        await window.latexdo.writeFile(project.id, "references.bib", template.bibTex);
      }

      await loadProject(project, true, false);
      setStatusMessage(`${template.name} project created`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : `Could not create ${template.name} project`,
      );
    } finally {
      setTemplateCreating(null);
    }
  };

  useEffect(() => {
    if (!projectId || hideProjectEntries) {
      setCollaborationState({ enabled: false, users: [] });
      return;
    }

    void refreshCollaborationState(projectId);
  }, [hideProjectEntries, projectId, refreshCollaborationState]);

  useEffect(() => {
    if (
      !projectId ||
      !collaborationAvailable ||
      !collaborationState.enabled ||
      hideProjectEntries
    ) {
      return;
    }

    let cancelled = false;
    const sendPresence = async () => {
      try {
        const active = documentsRef.current.find(
          (document) => document.path === activePathRef.current,
        );
        const state = await window.latexdo.updateCollaborationPresence(
          projectId,
          active?.relativePath ?? null,
        );
        if (!cancelled) {
          setCollaborationState(state);
          if (state.currentUserRole) {
            setCurrentUserRole(state.currentUserRole);
          }
          if (typeof state.isAdmin === "boolean") {
            setIsProjectAdmin(state.isAdmin);
          }
        }
      } catch {
        // Presence is opportunistic; editing should keep working offline.
      }
    };

    void sendPresence();
    const interval = window.setInterval(() => void sendPresence(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activePath,
    collaborationAvailable,
    collaborationState.enabled,
    hideProjectEntries,
    projectId,
  ]);

  useEffect(() => {
    if (
      !projectId ||
      !collaborationAvailable ||
      !collaborationState.enabled ||
      hideProjectEntries
    ) {
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    const reconcileProjectTree = async () => {
      if (requestInFlight || document.visibilityState === "hidden") {
        return;
      }
      requestInFlight = true;
      try {
        await refreshProject(projectId);
      } catch {
        // Reconciliation is opportunistic; Yjs remains the live document channel.
      } finally {
        if (!cancelled) {
          requestInFlight = false;
        }
      }
    };

    const reconcileWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void reconcileProjectTree();
      }
    };
    const interval = window.setInterval(
      () => void reconcileProjectTree(),
      collaborationProjectReconciliationMs,
    );
    window.addEventListener("focus", reconcileWhenVisible);
    document.addEventListener("visibilitychange", reconcileWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcileWhenVisible);
      document.removeEventListener("visibilitychange", reconcileWhenVisible);
    };
  }, [
    collaborationAvailable,
    collaborationState.enabled,
    hideProjectEntries,
    projectId,
    refreshProject,
  ]);

  const renderTemplateIcon = (template: WelcomeTemplate) => {
    switch (template.id) {
      case "beamer":
        return <Play size={17} />;
      case "letter":
        return <MessageCircle size={17} />;
      case "research":
        return <BookOpenText size={17} />;
      case "notes":
        return <Sigma size={17} />;
      case "response":
        return <MessageSquare size={17} />;
      case "article":
      default:
        return <FilePlus2 size={17} />;
    }
  };

  const openCreateDialog = (type: "file" | "folder") => {
    if (!projectId || hideProjectEntries) {
      setStatusMessage("Create or open a project before adding files.");
      return;
    }
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
    if (!projectId || !createDialog || !relativePath) {
      setCreateError("Enter a name or path.");
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      if (createDialog === "file") {
        const createdPath = await window.latexdo.createFile(projectId, relativePath);
        const entries = await refreshProject(projectId);
        const entry = flattenEntries(entries).find(
          (item) =>
            normalizeRelativePath(item.relativePath) ===
            normalizeRelativePath(createdPath),
        );
        if (!entry) {
          throw new Error("The file was created but could not be opened.");
        }
        await openDocument(entry);
        setStatusMessage(`Created ${pathForDisplay(relativePath)}`);
      } else {
        await window.latexdo.createFolder(projectId, relativePath);
        await refreshProject(projectId);
        setStatusMessage(`Created folder ${pathForDisplay(relativePath)}`);
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

  const importExternalFilePaths = useCallback(
    async (
      sourcePaths: string[],
      destinationDirectory: string,
    ): Promise<ImportedProjectEntry[]> => {
      const currentProject = projectIdRef.current;
      const uniquePaths = [...new Set(sourcePaths.filter(Boolean))];
      if (!currentProject) {
        setStatusMessage("Open a project before importing files.");
        return [];
      }
      if (uniquePaths.length === 0) {
        setStatusMessage("File drop import is available in the desktop app.");
        return [];
      }

      try {
        const imported = await window.latexdo.importExternalFiles(
          currentProject,
          destinationDirectory,
          uniquePaths,
        );
        await refreshProject(currentProject);
        setStatusMessage(
          imported.length === 1
            ? `Imported ${pathForDisplay(imported[0].relativePath)}`
            : `Imported ${imported.length} items`,
        );
        return imported;
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not import dropped files.",
        );
        return [];
      }
    },
    [refreshProject],
  );

  const importExternalFiles = useCallback(
    async (files: File[], destination: ProjectEntry | null) => {
      const sourcePaths = window.latexdo.getDroppedFilePaths(files);
      const destinationDirectory = normalizeRelativePath(
        destination?.relativePath ?? "",
      ).replace(/\/+$/, "");
      await importExternalFilePaths(sourcePaths, destinationDirectory);
    },
    [importExternalFilePaths],
  );

  const chooseImportFiles = useCallback(
    async (destination: ProjectEntry | null) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("Open a project before importing files.");
        return;
      }

      const destinationDirectory = normalizeRelativePath(
        destination?.relativePath ?? "",
      ).replace(/\/+$/, "");

      try {
        const imported = await window.latexdo.chooseImportExternalFiles(
          currentProject,
          destinationDirectory,
        );
        if (imported.length === 0) {
          return;
        }
        await refreshProject(currentProject);
        setStatusMessage(
          imported.length === 1
            ? `Imported ${pathForDisplay(imported[0].relativePath)}`
            : `Imported ${imported.length} items`,
        );
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not import files.",
        );
      }
    },
    [refreshProject],
  );

  const insertImageReference = useCallback(
    (entry: ProjectEntry) => {
      if (!activeDocumentIsLatex) {
        setStatusMessage("Open a LaTeX file before inserting image code.");
        return;
      }
      if (!isImagePath(entry.relativePath)) {
        setStatusMessage("Choose an image file to insert LaTeX image code.");
        return;
      }
      const inserted = insertLatexBlockAtEditorPosition(
        latexFigureCode(entry.relativePath),
      );
      if (inserted) {
        setStatusMessage(
          `Inserted image code for ${pathForDisplay(entry.relativePath)}`,
        );
      }
    },
    [activeDocumentIsLatex, insertLatexBlockAtEditorPosition],
  );

  const copyRelativePath = useCallback(async (entry: ProjectEntry) => {
    try {
      await navigator.clipboard.writeText(entry.relativePath);
      setStatusMessage(`Copied ${pathForDisplay(entry.relativePath)}`);
    } catch {
      setStatusMessage("Could not copy the relative path.");
    }
  }, []);

  const openImportedTexDocument = useCallback(
    async (
      result: { relativePath: string; project?: OpenProject },
      currentProject?: string,
    ) => {
      const targetProject = result.project?.id ?? currentProject;
      if (!targetProject) {
        throw new Error("Import did not return a project.");
      }

      if (result.project && result.project.id !== currentProject) {
        await loadProject(result.project, false, false);
      }

      const entries = await refreshProject(targetProject);
      const importedEntry = flattenEntries(entries).find(
        (entry) =>
          entry.type === "file" &&
          normalizeRelativePath(entry.relativePath) ===
            normalizeRelativePath(result.relativePath),
      );

      if (!importedEntry) {
        throw new Error(
          `Imported file ${pathForDisplay(result.relativePath)} was not found.`,
        );
      }

      if (!importedEntry.name.toLowerCase().endsWith(".tex")) {
        throw new Error(
          `Imported file ${pathForDisplay(result.relativePath)} is not a TeX file.`,
        );
      }

      await openDocument(importedEntry, targetProject);
      setWelcomeOpen(false);
      setRootFile(importedEntry.relativePath);
      rootFileRef.current = importedEntry.relativePath;
    },
    [loadProject, openDocument, refreshProject],
  );

  const handleEditorFileDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!activeDocumentIsLatex) {
        setStatusMessage("Drop images into a LaTeX file to insert image code.");
        return;
      }

      const sourcePaths = window.latexdo.getDroppedFilePaths(files).filter(isImagePath);
      if (sourcePaths.length === 0) {
        setStatusMessage("Drop PNG, JPG, SVG, or PDF images into the LaTeX editor.");
        return;
      }

      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("Open a project before importing images.");
        return;
      }

      await window.latexdo.createFolder(currentProject, "figures").catch(() => {
        // Existing folder or unavailable folder creation is handled by the import step.
      });
      const imported = await importExternalFilePaths(sourcePaths, "figures");
      const importedImages = imported.filter(
        (entry) => entry.type === "file" && isImagePath(entry.relativePath),
      );
      if (importedImages.length === 0) {
        return;
      }

      const editor = editorRef.current;
      const dropPosition =
        editor?.getTargetAtClientPoint(event.clientX, event.clientY)?.position ??
        editor?.getPosition() ??
        null;
      const code = importedImages
        .map((entry) => latexFigureCode(entry.relativePath))
        .join("\n\n");
      if (insertLatexBlockAtEditorPosition(code, dropPosition)) {
        setStatusMessage(
          importedImages.length === 1
            ? `Inserted image code for ${pathForDisplay(importedImages[0].relativePath)}`
            : `Inserted ${importedImages.length} image figures`,
        );
      }
    },
    [activeDocumentIsLatex, importExternalFilePaths, insertLatexBlockAtEditorPosition],
  );

  const importDocx = useCallback(async () => {
    if (typeof window.latexdo.importDocx !== "function") {
      setStatusMessage(
        "DOCX import is not loaded in this app window. Restart the dev app and try again.",
      );
      return;
    }

    const currentProject =
      projectIdRef.current && !hideProjectEntriesRef.current
        ? projectIdRef.current
        : undefined;
    if (!currentProject) {
      setWelcomeOpen(true);
    }

    setDocxImporting(true);
    try {
      const result = await window.latexdo.importDocx(currentProject);
      if (!result) {
        return;
      }

      await openImportedTexDocument(result, currentProject);

      const converterName =
        result.converter === "pandoc" ? "Pandoc" : "built-in importer";
      const mediaSummary = result.mediaFiles.length
        ? ` with ${result.mediaFiles.length} media file${
            result.mediaFiles.length === 1 ? "" : "s"
          }`
        : "";
      const warningSummary = result.warnings.length ? ` ${result.warnings[0]}` : "";
      setStatusMessage(
        `Imported ${fileName(result.sourcePath)} to ${pathForDisplay(result.relativePath)} via ${converterName}${mediaSummary}.${warningSummary}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import DOCX.";
      if (
        message.includes("No handler registered") ||
        message.includes("importDocx is not a function")
      ) {
        setStatusMessage("Restart the LatexDo app to finish loading DOCX import.");
        return;
      }
      setStatusMessage(message.replace(/^Error invoking remote method '[^']+': /, ""));
    } finally {
      setDocxImporting(false);
    }
  }, [openImportedTexDocument]);

  const importMarkdown = useCallback(async () => {
    if (typeof window.latexdo.importMarkdown !== "function") {
      setStatusMessage(
        "Markdown import is not loaded in this app window. Restart the dev app and try again.",
      );
      return;
    }

    const currentProject =
      projectIdRef.current && !hideProjectEntriesRef.current
        ? projectIdRef.current
        : undefined;
    if (!currentProject) {
      setWelcomeOpen(true);
    }

    setMarkdownImporting(true);
    try {
      const result = await window.latexdo.importMarkdown(currentProject);
      if (!result) return;

      await openImportedTexDocument(result, currentProject);

      const converterName =
        result.converter === "pandoc" ? "Pandoc" : "built-in converter";
      const warningSummary = result.warnings.length ? ` ${result.warnings[0]}` : "";
      setStatusMessage(
        `Imported ${fileName(result.sourcePath)} to ${pathForDisplay(result.relativePath)} via ${converterName}.${warningSummary}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not import Markdown.";
      if (
        message.includes("No handler registered") ||
        message.includes("importMarkdown is not a function")
      ) {
        setStatusMessage("Restart the LatexDo app to finish loading Markdown import.");
        return;
      }
      setStatusMessage(message.replace(/^Error invoking remote method '[^']+': /, ""));
    } finally {
      setMarkdownImporting(false);
    }
  }, [openImportedTexDocument]);

  const closeDocument = (path: string) => {
    const currentDocuments = documentsRef.current;
    const target = currentDocuments.find((document) => document.path === path);
    if (
      target &&
      target.content !== target.savedContent &&
      !window.confirm(`Close ${target.name} without saving?`)
    ) {
      return;
    }
    const index = currentDocuments.findIndex((document) => document.path === path);
    const nextDocuments = currentDocuments.filter((document) => document.path !== path);
    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
    if (activePathRef.current === path) {
      const nextPath =
        nextDocuments[Math.min(index, nextDocuments.length - 1)]?.path ?? "";
      setActivePath(nextPath);
      activePathRef.current = nextPath;
    }
  };

  const showWelcomePage = () => {
    if (activePathRef.current) {
      editorPathBeforeWelcomeRef.current = activePathRef.current;
    }
    setWelcomeOpen(true);
    setActivePath("");
    activePathRef.current = "";
    setStatusMessage("Welcome to LatexDo");
  };

  const loadSpellCheckerSettings = useCallback(async () => {
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
  }, []);

  const saveSpellCheckerSettings = useCallback(
    async (
      nextSettings: SpellCheckerSettings,
      successMessage?: string,
      options?: { clearWordDraft?: boolean },
    ) => {
      setSpellCheckerLoading(true);
      setSpellCheckerError("");
      try {
        const saved = await window.latexdo.updateSpellCheckerSettings(nextSettings);
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
        error instanceof Error ? error.message : "Could not load proofreading settings";
      setProofreadingError(
        message.replace(/^Error invoking remote method '[^']+': /, ""),
      );
    }
  }, []);

  const saveProofreadingSettings = useCallback(
    async (nextSettings: ProofreadingSettings, successMessage?: string) => {
      setProofreadingError("");
      try {
        const saved = await window.latexdo.updateProofreadingSettings(nextSettings);
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

  // --- AI agent integration -------------------------------------------------
  const aiIsDesktop = Boolean((window as { aiApi?: unknown }).aiApi);

  const applyAgentEdit = useCallback(
    async (proposal: EditProposal) => {
      const editor = editorRef.current;
      if (proposal.kind === "replace-selection" && editor) {
        const selection = editor.getSelection();
        if (selection) {
          editor.executeEdits("ai-agent", [
            { range: selection, text: proposal.newText },
          ]);
          editor.focus();
        }
        return;
      }
      if (proposal.kind === "insert-at-cursor" && editor) {
        const position = editor.getPosition();
        if (position) {
          editor.executeEdits("ai-agent", [
            {
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
              text: proposal.newText,
            },
          ]);
          editor.focus();
        }
        return;
      }
      // replace-file
      if (proposal.path === activeTextDocument?.relativePath && editor?.getModel()) {
        editor.getModel()?.setValue(proposal.newText);
      } else if (projectId) {
        await window.latexdo.writeFile(projectId, proposal.path, proposal.newText);
      }
    },
    [activeTextDocument, projectId],
  );

  const insertCitationKey = useCallback(
    (key: string) => {
      const editor = editorRef.current;
      const position = editor?.getPosition();
      if (!editor || !position) {
        setStatusMessage(
          `Open a .tex file and place the cursor where you want \\cite{${key}}.`,
        );
        return;
      }
      editor.executeEdits("knowledge-graph", [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          text: `\\cite{${key}}`,
        },
      ]);
      editor.focus();
      setStatusMessage(`Inserted \\cite{${key}}.`);
    },
    [setStatusMessage],
  );

  const recommendCitationsForSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const passage =
      selection && editor
        ? (editor.getModel()?.getValueInRange(selection) ?? "")
        : "";
    const text = passage.trim();
    if (!text) {
      setStatusMessage("Select a sentence or paragraph first to recommend citations.");
      return;
    }
    const recommendations = recommendCitations(text, citationAnalysis.entries, {
      citedKeys: citationAnalysis.citedKeys,
      limit: 6,
    });
    if (recommendations.length === 0) {
      setStatusMessage("No matching references found for the selected text.");
      return;
    }
    setStatusMessage(
      `Suggested citations: ${recommendations
        .map((rec) => `\\cite{${rec.key}}`)
        .join(", ")}`,
    );
  }, [citationAnalysis, setStatusMessage]);

  const flattenProjectFiles = useCallback((entries: ProjectEntry[]): string[] => {
    const out: string[] = [];
    const walk = (list: ProjectEntry[]) => {
      for (const entry of list) {
        if (entry.type === "directory") {
          if (entry.children) walk(entry.children);
        } else {
          out.push(entry.relativePath);
        }
      }
    };
    walk(entries);
    return out;
  }, []);

  const agentContext = useMemo<AgentContext>(
    () => ({
      projectName: () => projectName || "Untitled project",
      activeFilePath: () => activeTextDocument?.relativePath ?? null,
      listFiles: async () => {
        if (!projectId) return [];
        const entries = await window.latexdo.listProject(projectId);
        return flattenProjectFiles(entries);
      },
      readFile: (path) =>
        projectId
          ? window.latexdo.readFile(projectId, path)
          : Promise.reject(new Error("No project open")),
      writeFile: async (path, content) => {
        if (!projectId) throw new Error("No project open");
        await window.latexdo.writeFile(projectId, path, content);
      },
      documentText: () =>
        editorRef.current?.getModel()?.getValue() ?? activeTextDocument?.content ?? "",
      selection: () => {
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        const text =
          selection && editor
            ? (editor.getModel()?.getValueInRange(selection) ?? "")
            : "";
        return { text, hasSelection: text.trim().length > 0 };
      },
      applyEdit: applyAgentEdit,
      compile: async () => {
        const result = await compile();
        return {
          ok: Boolean(result?.ok),
          log: result?.output ?? "",
          diagnostics: (result?.diagnostics ?? []).map(
            (d) => `${d.severity} ${d.file}:${d.line} — ${d.message}`,
          ),
        };
      },
      runChecks: async (kind) => {
        const diagnostics = compileResult?.diagnostics ?? [];
        if (!diagnostics.length) {
          return `The '${kind}' checker found no compile-level issues. Open the Problems panel for the full built-in ${kind} report.`;
        }
        return (
          `Current diagnostics (also feeding the ${kind} checker):\n` +
          diagnostics
            .slice(0, 30)
            .map((d) => `- ${d.severity} ${d.file}:${d.line} — ${d.message}`)
            .join("\n")
        );
      },
      insertCitation: async (query) => {
        const needle = query.toLowerCase();
        for (const doc of documents) {
          if (!doc.relativePath.endsWith(".bib")) continue;
          const entries = doc.content.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,([^@]*)/g);
          for (const match of entries) {
            const key = match[1];
            const body = (match[2] ?? "").toLowerCase();
            if (key.toLowerCase().includes(needle) || body.includes(needle)) {
              return `Use \\cite{${key}} — matched in ${doc.relativePath}.`;
            }
          }
        }
        return `No bibliography entry matched "${query}". Add it to a .bib file first.`;
      },
      recommendCitations: async (passage) => {
        const recommendations = recommendCitations(
          passage,
          citationAnalysis.entries,
          { citedKeys: citationAnalysis.citedKeys },
        );
        return formatRecommendations(recommendations);
      },
      // Edits flow through Monaco (visible + undoable); a diff-approval UI is a
      // planned follow-up, so for now we apply and rely on undo.
      requestApproval: async () => true,
    }),
    [
      projectName,
      activeTextDocument,
      projectId,
      documents,
      compileResult,
      compile,
      applyAgentEdit,
      flattenProjectFiles,
      citationAnalysis,
    ],
  );

  const applyLayoutPreset = useCallback(
    (config: AiConfig) => {
      const flags = layoutPresetFlags[config.layoutPreset];
      setSidebarVisible(flags.sidebarVisible);
      setPreviewVisible(flags.previewVisible);
      setPanelVisible(flags.panelVisible);
      setSettings((current) => ({ ...current, minimap: flags.minimap }));
    },
    [setSettings],
  );

  const completeAiSetup = useCallback(
    (config: AiConfig) => {
      setAiConfig(config);
      setAiWizardOpen(false);
      applyLayoutPreset(config);
      setStatusMessage(
        config.userName
          ? `Welcome, ${config.userName}. AI assistant ready.`
          : "AI assistant ready.",
      );
    },
    [applyLayoutPreset],
  );

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

      const customWords = uniqueWords([...spellCheckerSettings.customWords, word]);
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

  useEffect(() => {
    return window.latexdo.onImportDocxMenu(() => {
      void importDocx();
    });
  }, [importDocx]);

  useEffect(() => {
    return window.latexdo.onImportMarkdownMenu(() => {
      void importMarkdown();
    });
  }, [importMarkdown]);

  useEffect(() => {
    return window.latexdo.onCloseTabMenu(() => {
      closeActiveTab();
    });
  }, [closeActiveTab]);

  const toggleSidebar = () => {
    setSidebarVisible((visible) => !visible);
  };

  const togglePanel = () => {
    setPanelVisible((visible) => !visible);
  };

  const openPanel = useCallback((panel: PanelKind) => {
    if (panel === "terminal") {
      setTerminalStarted(true);
    }
    setPanelVisible(true);
    setActivePanel(panel);
  }, []);

  const refreshGitStatus = useCallback(async () => {
    const currentProject = projectIdRef.current;
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

  const refreshGitHistories = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) {
      setGitRepoHistory(null);
      setGitFileHistory(null);
      return;
    }

    const currentDocument = documentsRef.current.find(
      (document) => document.path === activePathRef.current,
    );
    const targetPath =
      gitFileHistoryPathRef.current || currentDocument?.relativePath || "";
    try {
      const [repositoryHistory, fileHistory] = await Promise.all([
        window.latexdo.getGitHistory(currentProject),
        targetPath
          ? window.latexdo.getGitHistory(currentProject, targetPath)
          : Promise.resolve(null),
      ]);
      setGitRepoHistory(repositoryHistory);
      setGitFileHistory(fileHistory);
    } catch {
      setGitRepoHistory(null);
      setGitFileHistory(null);
    }
  }, []);

  const refreshOpenGitDiff = useCallback(async () => {
    const currentProject = projectIdRef.current;
    const currentSession = gitDiffSessionRef.current;
    if (!currentProject || !currentSession) return;

    const area =
      currentSession.modifiedRef.kind === "index"
        ? "staged"
        : currentSession.modifiedRef.kind === "working-tree"
          ? "changes"
          : null;
    if (!area) return;

    try {
      const refreshedSession = await window.latexdo.getGitEditorDiff(
        currentProject,
        currentSession.relativePath,
        area,
      );
      if (gitDiffSessionRef.current?.id !== currentSession.id) return;
      gitDiffSessionRef.current = refreshedSession;
      gitDiffSessionIdRef.current = refreshedSession.id;
      setGitDiffSession(refreshedSession);
      const blame =
        refreshedSession.binary || refreshedSession.tooLarge
          ? []
          : await window.latexdo.getGitBlame(
              currentProject,
              refreshedSession.relativePath,
              refreshedSession.modifiedRef,
            );
      if (gitDiffSessionRef.current?.id === refreshedSession.id) {
        setGitBlameLines(blame);
      }
    } catch {
      // The revision may disappear after a stage/commit; the explicit operation closes it.
    }
  }, []);

  const refreshGitData = useCallback(async () => {
    await Promise.all([
      refreshGitStatus(),
      refreshGitHistories(),
      refreshOpenGitDiff(),
    ]);
  }, [refreshGitHistories, refreshGitStatus, refreshOpenGitDiff]);

  const scheduleGitRefresh = useCallback(() => {
    if (gitRefreshTimerRef.current !== null) {
      window.clearTimeout(gitRefreshTimerRef.current);
    }
    gitRefreshTimerRef.current = window.setTimeout(() => {
      gitRefreshTimerRef.current = null;
      void refreshGitData();
    }, 150);
  }, [refreshGitData]);
  scheduleGitRefreshRef.current = scheduleGitRefresh;

  const closeGitDiffSession = useCallback(
    (restoreDocument = true) => {
      const diffWasActive = !activePathRef.current && !welcomeOpen;
      setGitDiffSession(null);
      gitDiffSessionRef.current = null;
      setGitBlameLines([]);
      gitDiffSessionIdRef.current = "";
      if (!restoreDocument || !diffWasActive) return;

      const returnPath = gitDiffReturnPathRef.current;
      const nextPath = documentsRef.current.some(
        (document) => document.path === returnPath,
      )
        ? returnPath
        : (documentsRef.current[0]?.path ?? "");
      setActivePath(nextPath);
      activePathRef.current = nextPath;
    },
    [welcomeOpen],
  );

  const activateGitDiffSession = useCallback(async (session: GitDiffSession) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    if (activePathRef.current) {
      gitDiffReturnPathRef.current = activePathRef.current;
    }
    gitDiffSessionIdRef.current = session.id;
    gitDiffSessionRef.current = session;
    setGitDiffSession(session);
    setGitBlameLines([]);
    setWelcomeOpen(false);
    setActivePath("");
    activePathRef.current = "";

    if (session.modifiedRef.kind === "empty" || session.binary || session.tooLarge) {
      return;
    }
    try {
      const blame = await window.latexdo.getGitBlame(
        currentProject,
        session.relativePath,
        session.modifiedRef,
      );
      if (gitDiffSessionIdRef.current === session.id) {
        setGitBlameLines(blame);
      }
    } catch {
      if (gitDiffSessionIdRef.current === session.id) {
        setGitBlameLines([]);
      }
    }
  }, []);

  const checkForUpdates = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setCheckingUpdates(true);
      setUpdateProgress(null);
    }
    try {
      const result = await window.latexdo.checkForUpdates();
      setUpdateInfo(result);
      if (result.updateAvailable && result.latestVersion) {
        setDismissedUpdateVersion((current) =>
          current && current !== result.latestVersion ? null : current,
        );
        setStatusMessage(`LatexDo ${result.latestVersion} is available.`);
      } else if (!options?.silent) {
        setStatusMessage(`LatexDo ${result.currentVersion} is up to date.`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not check for updates.";
      setUpdateInfo((current) => ({
        currentVersion: current?.currentVersion ?? "Unknown",
        latestVersion: current?.latestVersion ?? null,
        releaseUrl: current?.releaseUrl ?? null,
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
        error: message,
      }));
      if (!options?.silent) {
        setStatusMessage(message);
      }
    } finally {
      if (!options?.silent) {
        setCheckingUpdates(false);
      }
    }
  }, []);

  const updateNow = useCallback(async () => {
    setUpdatingNow(true);
    setUpdateProgress((current) => ({
      status: "checking",
      currentVersion:
        updateInfo?.currentVersion ?? current?.currentVersion ?? "Unknown",
      latestVersion: updateInfo?.latestVersion ?? current?.latestVersion ?? null,
      fileName: null,
      fileLabel: null,
      transferredBytes: 0,
      totalBytes: null,
      percent: null,
      message: "Checking for the latest build",
    }));
    try {
      const result = await window.latexdo.updateNow();
      setUpdateInfo(result);

      if (result.error) {
        setUpdateProgress((current) =>
          current
            ? { ...current, status: "error", message: result.error }
            : {
                status: "error",
                currentVersion: result.currentVersion,
                latestVersion: result.latestVersion,
                fileName: null,
                fileLabel: null,
                transferredBytes: 0,
                totalBytes: null,
                percent: null,
                message: result.error,
              },
        );
        setStatusMessage(result.error);
        return;
      }

      if (!result.updateAvailable) {
        setUpdateProgress({
          status: "done",
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          fileName: null,
          fileLabel: null,
          transferredBytes: 0,
          totalBytes: null,
          percent: null,
          message: `Current build ${result.currentVersion} is up to date.`,
        });
        setStatusMessage(`LatexDo ${result.currentVersion} is up to date.`);
        return;
      }

      if (result.opened && result.latestVersion) {
        const manualDownload = result.manualDownload === true;
        setUpdateProgress((current) => ({
          status: result.restartScheduled
            ? "restarting"
            : manualDownload
              ? "done"
              : "opening",
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          fileName: current?.fileName ?? null,
          fileLabel: current?.fileLabel ?? null,
          transferredBytes: current?.transferredBytes ?? 1,
          totalBytes: current?.totalBytes ?? 1,
          percent: current?.percent ?? 100,
          message: result.restartScheduled
            ? "Restarting LatexDo"
            : manualDownload
              ? "Opened downloads page"
              : "Opened installer",
        }));
        setStatusMessage(
          result.restartScheduled
            ? `Restarting LatexDo to finish ${result.latestVersion}.`
            : manualDownload
              ? `Opened LatexDo ${result.latestVersion} downloads.`
              : `Opened LatexDo ${result.latestVersion} installer.`,
        );
      } else if (result.latestVersion) {
        setUpdateProgress((current) => ({
          status: "done",
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          fileName: current?.fileName ?? null,
          fileLabel: current?.fileLabel ?? null,
          transferredBytes: current?.transferredBytes ?? 1,
          totalBytes: current?.totalBytes ?? 1,
          percent: current?.percent ?? 100,
          message: `LatexDo ${result.latestVersion} update is ready.`,
        }));
        setStatusMessage(`LatexDo ${result.latestVersion} update is ready.`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not start the update.";
      setUpdateProgress((current) =>
        current
          ? { ...current, status: "error", message }
          : {
              status: "error",
              currentVersion: updateInfo?.currentVersion ?? "Unknown",
              latestVersion: updateInfo?.latestVersion ?? null,
              fileName: null,
              fileLabel: null,
              transferredBytes: 0,
              totalBytes: null,
              percent: null,
              message,
            },
      );
      setStatusMessage(message);
    } finally {
      setUpdatingNow(false);
    }
  }, [updateInfo?.currentVersion, updateInfo?.latestVersion]);

  const stageGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`stage:${relativePath}`);
      try {
        await window.latexdo.stageGitFile(currentProject, relativePath);
        if (
          gitDiffSessionIdRef.current &&
          gitDiffSession?.relativePath === relativePath
        ) {
          closeGitDiffSession();
        }
        await refreshGitData();
        setStatusMessage(`Staged ${pathForDisplay(relativePath)}`);
      } finally {
        setGitActionBusy(null);
      }
    },
    [closeGitDiffSession, gitDiffSession?.relativePath, refreshGitData],
  );

  const unstageGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`unstage:${relativePath}`);
      try {
        await window.latexdo.unstageGitFile(currentProject, relativePath);
        if (
          gitDiffSessionIdRef.current &&
          gitDiffSession?.relativePath === relativePath
        ) {
          closeGitDiffSession();
        }
        await refreshGitData();
        setStatusMessage(`Unstaged ${pathForDisplay(relativePath)}`);
      } finally {
        setGitActionBusy(null);
      }
    },
    [closeGitDiffSession, gitDiffSession?.relativePath, refreshGitData],
  );

  const commitGitChanges = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setGitActionBusy("commit");
    try {
      await window.latexdo.commitGit(currentProject, gitCommitMessage);
      setGitCommitMessage("");
      closeGitDiffSession();
      await refreshGitData();
      setStatusMessage("Created commit");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Git commit failed");
    } finally {
      setGitActionBusy(null);
    }
  }, [closeGitDiffSession, gitCommitMessage, refreshGitData]);

  const discardGitEntry = useCallback(
    async (relativePath: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`discard:${relativePath}`);
      try {
        const result = await window.latexdo.discardGitFile(
          currentProject,
          relativePath,
        );
        if (!result.discarded) {
          setStatusMessage("Discard canceled.");
          return;
        }
        if (activePathRef.current.endsWith(relativePath)) {
          await refreshProject(currentProject);
        }
        if (gitDiffSession?.relativePath === relativePath) {
          closeGitDiffSession();
        }
        await refreshGitData();
        setStatusMessage(
          gitDiscardStatusMessage(
            result,
            `Discarded changes in ${pathForDisplay(relativePath)}`,
          ),
        );
      } finally {
        setGitActionBusy(null);
      }
    },
    [closeGitDiffSession, gitDiffSession?.relativePath, refreshGitData, refreshProject],
  );

  const stageAllGitEntries = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setGitActionBusy("stage-all");
    try {
      await window.latexdo.stageAllGit(currentProject);
      closeGitDiffSession();
      await refreshGitData();
      setStatusMessage("Staged all changes");
    } finally {
      setGitActionBusy(null);
    }
  }, [closeGitDiffSession, refreshGitData]);

  const unstageAllGitEntries = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setGitActionBusy("unstage-all");
    try {
      await window.latexdo.unstageAllGit(currentProject);
      closeGitDiffSession();
      await refreshGitData();
      setStatusMessage("Unstaged all changes");
    } finally {
      setGitActionBusy(null);
    }
  }, [closeGitDiffSession, refreshGitData]);

  const discardAllGitEntries = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setGitActionBusy("discard-all");
    try {
      const result = await window.latexdo.discardAllGit(currentProject);
      if (!result.discarded) {
        setStatusMessage("Discard canceled.");
        return;
      }
      closeGitDiffSession();
      await refreshProject(currentProject);
      await refreshGitData();
      setStatusMessage(
        gitDiscardStatusMessage(result, "Discarded all unstaged changes"),
      );
    } finally {
      setGitActionBusy(null);
    }
  }, [closeGitDiffSession, refreshGitData, refreshProject]);

  const openGitCommitDetails = useCallback(async (hash: string) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;

    setSelectedGitCommitHash(hash);
    setGitActionBusy(`commit:${hash}`);
    try {
      const details = await window.latexdo.getGitCommitDetails(currentProject, hash);
      setGitCommitDetails(details);
      setGitCommitParentHash(details.parents[0] ?? "");
    } finally {
      setGitActionBusy(null);
    }
  }, []);

  const openGitCommitRevisionDiff = useCallback(
    async (hash: string, relativePath: string, parentHash?: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`commit-diff:${hash}:${relativePath}`);
      try {
        const snapshot = await window.latexdo.getGitCommitFileDiff(
          currentProject,
          relativePath,
          hash,
          parentHash || undefined,
        );
        await activateGitDiffSession(snapshot);
        setStatusMessage(
          `Opened ${pathForDisplay(relativePath)} at ${hash.slice(0, 7)}`,
        );
      } finally {
        setGitActionBusy(null);
      }
    },
    [activateGitDiffSession],
  );

  useEffect(() => {
    if (!projectId) return;
    scheduleGitRefresh();
  }, [activeSidebar, projectId, scheduleGitRefresh]);

  useEffect(() => {
    setCollapsedGitGroups(new Set());
  }, [projectId]);

  useEffect(() => {
    const nextPath = activeDocument?.relativePath;
    if (!nextPath) return;
    setGitFileHistoryPath(nextPath);
    gitFileHistoryPathRef.current = nextPath;
    if (activeSidebar === "sourceControl" && projectId) {
      scheduleGitRefresh();
    }
  }, [activeDocument?.relativePath, activeSidebar, projectId, scheduleGitRefresh]);

  useEffect(() => {
    const handleFocus = () => scheduleGitRefresh();
    window.addEventListener("focus", handleFocus);
    const disposeGitWatcher = window.latexdo.onGitChanged((event: GitChangedEvent) => {
      if (event.projectId === projectIdRef.current) {
        scheduleGitRefresh();
      }
    });
    return () => {
      window.removeEventListener("focus", handleFocus);
      disposeGitWatcher();
      if (gitRefreshTimerRef.current !== null) {
        window.clearTimeout(gitRefreshTimerRef.current);
        gitRefreshTimerRef.current = null;
      }
      if (gitRowClickTimerRef.current !== null) {
        window.clearTimeout(gitRowClickTimerRef.current);
        gitRowClickTimerRef.current = null;
      }
    };
  }, [scheduleGitRefresh]);

  useEffect(() => {
    if (!gitContextMenu) return;
    const closeContextMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".scm-context-menu")) return;
      setGitContextMenu(null);
    };
    const closeContextMenuFromKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGitContextMenu(null);
    };
    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", closeContextMenuFromKey);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenuFromKey);
    };
  }, [gitContextMenu]);

  useEffect(() => {
    return window.latexdo.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
      setUpdateInfo((current) => ({
        currentVersion: progress.currentVersion,
        latestVersion: progress.latestVersion ?? current?.latestVersion ?? null,
        releaseUrl: current?.releaseUrl ?? null,
        updateAvailable:
          progress.status === "done" ? false : (current?.updateAvailable ?? false),
        automaticInstallAvailable: current?.automaticInstallAvailable,
        publishedAt: current?.publishedAt,
        channel: current?.channel,
        manifestUrl: current?.manifestUrl,
        checkedAt: current?.checkedAt,
        error: progress.status === "error" ? progress.message : current?.error,
      }));
      if (progress.status === "restarting") {
        setStatusMessage("Restarting LatexDo to finish the update.");
      } else if (progress.status === "error" && progress.message) {
        setStatusMessage(progress.message);
      }
    });
  }, []);

  useEffect(() => {
    const startupTimer = window.setTimeout(() => {
      void checkForUpdates({ silent: true });
    }, startupUpdateCheckDelayMs);
    const interval = window.setInterval(() => {
      void checkForUpdates({ silent: true });
    }, updateCheckIntervalMs);
    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [checkForUpdates]);

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
        (entry) => entry.type === "file" && entry.relativePath === rootFileRef.current,
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
      const previousEditorPath = editorPathBeforeWelcomeRef.current;
      const nextPath =
        documents.find((document) => document.path === previousEditorPath)?.path ??
        documents[0]?.path ??
        "";
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
      setStatusMessage(`Could not locate ${targetDiagnosticPath} in the open project`);
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
    setStatusMessage(
      `Opened ${diagnosticLocationLabel(diagnostic, rootFileRef.current)}`,
    );
  };

  const openGitFile = useCallback(
    async (relativePath: string) => {
      let entry = allProjectEntries.find(
        (item) => item.type === "file" && item.relativePath === relativePath,
      );
      if (!entry) {
        const refreshedEntries = await refreshProject();
        entry = flattenEntries(refreshedEntries).find(
          (item) => item.type === "file" && item.relativePath === relativePath,
        );
      }
      if (!entry) {
        setStatusMessage(
          `${pathForDisplay(relativePath)} is not present in the working tree.`,
        );
        return;
      }
      await openDocument(entry);
    },
    [allProjectEntries, openDocument, refreshProject],
  );

  const openGitDiffEditor = useCallback(
    async (entry: GitChangeEntry, area: GitChangeArea) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) return;

      setGitActionBusy(`editor-diff:${area}:${entry.path}`);
      try {
        const session = await window.latexdo.getGitEditorDiff(
          currentProject,
          entry.path,
          area,
        );
        await activateGitDiffSession(session);
        setStatusMessage(
          `Opened ${session.originalLabel} ↔ ${session.modifiedLabel} for ${entry.path}`,
        );
      } finally {
        setGitActionBusy(null);
      }
    },
    [activateGitDiffSession],
  );

  const revealGitFile = useCallback(async (relativePath: string) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;
    try {
      await window.latexdo.revealGitFile(currentProject, relativePath);
      setStatusMessage(`Revealed ${pathForDisplay(relativePath)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Could not reveal ${pathForDisplay(relativePath)}: ${message}`);
    }
  }, []);

  const copyGitPath = useCallback(async (relativePath: string) => {
    await navigator.clipboard?.writeText(relativePath);
    setStatusMessage(`Copied ${pathForDisplay(relativePath)}`);
  }, []);

  const openGitFileHistory = useCallback(async (relativePath: string) => {
    const currentProject = projectIdRef.current;
    if (!currentProject) return;
    gitFileHistoryPathRef.current = relativePath;
    setGitFileHistoryPath(relativePath);
    const history = await window.latexdo.getGitHistory(currentProject, relativePath);
    setGitFileHistory(history);
  }, []);

  const applyLatexToolbarCommand = useCallback((command: LatexToolbarCommand) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const document = documentsRef.current.find((d) => d.path === activePathRef.current);
    if (
      !editor ||
      !model ||
      !document ||
      !editorModelMatchesPath(editor, document.path) ||
      languageFor(document.name) !== "latex"
    ) {
      setStatusMessage("Open a TeX file to use formatting controls.");
      return;
    }

    const selection = editor.getSelection();
    if (!selection) return;

    if (command === "formatTable") {
      const position = editor.getPosition() ?? selection.getStartPosition();
      const result = formatLatexTableAtOffset(
        model.getValue(),
        model.getOffsetAt(position),
      );
      if (!result) {
        setStatusMessage("Place the cursor inside a tabular, array, or longtable.");
        return;
      }

      const start = model.getPositionAt(result.startOffset);
      const end = model.getPositionAt(result.endOffset);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      );
      editor.executeEdits("latex-table-format", [
        {
          range,
          text: result.text,
          forceMoveMarkers: true,
        },
      ]);
      editor.setSelection(range);
      editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
      editor.focus();
      setStatusMessage("Formatted LaTeX table columns.");
      return;
    }

    const selectedText = model.getValueInRange(selection);
    const hasSelection = !selection.isEmpty() && selectedText.length > 0;

    const replaceSelection = (
      text: string,
      selectStartOffset: number | null,
      selectEndOffset: number | null,
      status: string,
    ) => {
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      editor.executeEdits("latex-toolbar", [
        {
          range: selection,
          text,
          forceMoveMarkers: true,
        },
      ]);

      if (selectStartOffset !== null && selectEndOffset !== null) {
        const start = model.getPositionAt(startOffset + selectStartOffset);
        const end = model.getPositionAt(startOffset + selectEndOffset);
        editor.setSelection(
          new monaco.Selection(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column,
          ),
        );
      } else {
        const end = model.getPositionAt(startOffset + text.length);
        editor.setPosition(end);
      }

      editor.focus();
      setStatusMessage(status);
    };

    const wrapInline = (
      before: string,
      after: string,
      fallback: string,
      status: string,
    ) => {
      const inner = hasSelection ? selectedText : fallback;
      replaceSelection(
        `${before}${inner}${after}`,
        before.length,
        before.length + inner.length,
        status,
      );
    };

    const wrapBlock = (
      before: string,
      after: string,
      fallback: string,
      status: string,
    ) => {
      const inner = hasSelection ? selectedText : fallback;
      replaceSelection(
        `${before}${inner}${after}`,
        before.length,
        before.length + inner.length,
        status,
      );
    };

    const insertList = (environment: "itemize" | "enumerate") => {
      const fallback = "Item";
      const lines = hasSelection
        ? selectedText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [fallback];
      const body = lines.map((line) => `\t\\item ${line}`).join("\n");
      const text = `\\begin{${environment}}\n${body}\n\\end{${environment}}\n`;
      const firstItemOffset = `\\begin{${environment}}\n\t\\item `.length;
      replaceSelection(
        text,
        hasSelection ? null : firstItemOffset,
        hasSelection ? null : firstItemOffset + fallback.length,
        `Inserted ${environment} list.`,
      );
    };

    switch (command) {
      case "bold":
        wrapInline("\\textbf{", "}", "bold text", "Inserted bold text.");
        break;
      case "italic":
        wrapInline("\\emph{", "}", "emphasized text", "Inserted italic text.");
        break;
      case "underline":
        wrapInline("\\underline{", "}", "underlined text", "Inserted underline.");
        break;
      case "math":
        wrapInline("$", "$", "x", "Inserted inline math.");
        break;
      case "section":
        wrapInline("\\section{", "}\n", "Section title", "Inserted section.");
        break;
      case "subsection":
        wrapInline("\\subsection{", "}\n", "Subsection title", "Inserted subsection.");
        break;
      case "equation":
        wrapBlock(
          "\\begin{equation}\n",
          "\n\\end{equation}\n",
          "E = mc^2",
          "Inserted equation block.",
        );
        break;
      case "itemize":
        insertList("itemize");
        break;
      case "enumerate":
        insertList("enumerate");
        break;
      case "cite":
        wrapInline("\\cite{", "}", "key", "Inserted citation command.");
        break;
      case "ref":
        wrapInline("\\ref{", "}", "label", "Inserted reference command.");
        break;
      case "href":
        if (hasSelection) {
          replaceSelection(
            `\\href{url}{${selectedText}}`,
            "\\href{".length,
            "\\href{url".length,
            "Inserted link command.",
          );
        } else {
          wrapInline("\\href{url}{", "}", "link text", "Inserted link command.");
        }
        break;
    }
  }, []);

  const handleAddReviewChat = useCallback(() => {
    const editor = editorRef.current;
    const document = documentsRef.current.find((d) => d.path === activePathRef.current);
    if (!editor || !document || !editorModelMatchesPath(editor, document.path)) {
      setStatusMessage("Open a document before starting a review thread.");
      return;
    }

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      setStatusMessage("Select text before starting a review thread.");
      return;
    }

    const model = editor.getModel();
    if (!model) {
      setStatusMessage("Could not read the active editor selection.");
      return;
    }

    const selectedText = model.getValueInRange(selection);
    if (!selectedText.trim()) {
      setStatusMessage("Select some text to add a review comment.");
      return;
    }

    const newChat: ReviewChat = {
      id: Date.now().toString(),
      filePath: document.relativePath,
      selection: {
        startLine: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLine: selection.endLineNumber,
        endColumn: selection.endColumn,
        text: selectedText,
      },
      comments: [],
    };

    setReviewChats((prev) => {
      const next = [...prev, newChat];
      void saveReviewData(next, rebuttalItems);
      return next;
    });
    setStatusMessage("Started review conversation in sidebar.");
  }, [rebuttalItems, saveReviewData]);

  const handleAddRebuttalToSource = useCallback(() => {
    const editor = editorRef.current;
    const document = documentsRef.current.find((d) => d.path === activePathRef.current);
    if (!editor || !document || !editorModelMatchesPath(editor, document.path)) return;

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return;

    const model = editor.getModel();
    if (!model) return;

    const selectedText = model.getValueInRange(selection);
    if (!selectedText.trim()) {
      setStatusMessage("Select text to modify for rebuttal.");
      return;
    }

    const revisedText = selectedText; // User edits the fourth argument in place.
    const reviewerComment = "Reviewer comment here...";
    const authorAnswer = "Author answer here...";
    const wrappedText = `\\rebuttal{${selectedText}}{${reviewerComment}}{${authorAnswer}}{${revisedText}}`;

    editor.executeEdits("rebuttal-mode", [
      {
        range: selection,
        text: wrappedText,
        forceMoveMarkers: true,
      },
    ]);

    const newItem: RebuttalItem = {
      id: Date.now().toString(),
      originalText: selectedText,
      revisedText,
      insertedInTex: true,
      reviewerComment,
      authorComment: authorAnswer,
      modificationMade: revisedText,
    };

    setRebuttalItems((prev) => {
      const next = [...prev, newItem];
      void saveReviewData(reviewChats, next);
      return next;
    });
    setStatusMessage("Added rebuttal modification to source.");
  }, [reviewChats, saveReviewData]);

  const handleGenerateRebuttalLetter = useCallback(async () => {
    const currentProject = projectIdRef.current;
    if (!currentProject) {
      setStatusMessage("No project open.");
      return;
    }

    try {
      const s = settings;
      const rebuttalSettings: RebuttalGeneratorSettings = {
        manuscriptId: s.rebuttalManuscriptId,
        manuscriptTitle: s.rebuttalManuscriptTitle,
        fontSize: s.rebuttalFontSize,
        paperSize: s.rebuttalPaperSize,
        fontFamily: s.rebuttalFontFamily,
        includeDiff: s.rebuttalIncludeDiff,
        diffOldFile: s.rebuttalDiffOldFile,
        diffNewFile: s.rebuttalDiffNewFile,
        diffOutput: s.rebuttalDiffOutput,
        summaryText: s.rebuttalSummary,
        useOnehalfSpacing: s.rebuttalSpacing,
        colorPrimary: s.rebuttalColorPrimary,
        colorAccent: s.rebuttalColorAccent,
      };

      const tex = generateRebuttalLetter(rebuttalItems, rebuttalSettings);
      if (!tex || tex.length < 50) {
        setStatusMessage("Generated response is empty — check items and settings.");
        return;
      }
      const outName = "rebuttal-letter.tex";
      await window.latexdo.writeFile(currentProject, outName, tex);
      await refreshProject(currentProject);
      setDocuments((current) => {
        const nextDocuments = current.map((document) =>
          normalizeRelativePath(document.relativePath) === outName
            ? { ...document, content: tex, savedContent: tex }
            : document,
        );
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
      const entry = flattenEntries(projectEntriesRef.current).find(
        (candidate) =>
          candidate.type === "file" &&
          normalizeRelativePath(candidate.relativePath) === outName,
      );
      if (entry) {
        await openDocument(entry);
        setStatusMessage(`Generated ${outName} — compiling…`);
        await compileEntry(entry);
      } else {
        setStatusMessage(`Generated response file ${outName} — open to compile.`);
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setStatusMessage(`Failed: ${err}`);
    }
  }, [compileEntry, openDocument, rebuttalItems, refreshProject, settings]);

  const handleAddReviewComment = useCallback(
    (chatId: string, text: string) => {
      setReviewChats((prev) => {
        const next = prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              comments: [
                ...chat.comments,
                {
                  id: Date.now().toString(),
                  author: mode === "reviewer" ? "Reviewer" : "Author",
                  text,
                  timestamp: Date.now(),
                },
              ],
            };
          }
          return chat;
        });
        void saveReviewData(next, rebuttalItems);
        return next;
      });
    },
    [mode, rebuttalItems, saveReviewData],
  );

  const handleDeleteReviewChat = useCallback(
    (chatId: string) => {
      if (!window.confirm("Delete this review chat?")) return;
      setReviewChats((prev) => {
        const next = prev.filter((c) => c.id !== chatId);
        void saveReviewData(next, rebuttalItems);
        return next;
      });
    },
    [rebuttalItems, saveReviewData],
  );

  const handleInsertReviewChatIntoTex = useCallback(
    async (chat: ReviewChat) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("No project open.");
        return;
      }
      if (chat.insertedInTex) {
        setStatusMessage("This review thread is already in the TeX source.");
        return;
      }
      const comments = chat.comments.filter((comment) => comment.text.trim());
      if (comments.length === 0) {
        setStatusMessage(
          "Write at least one message before inserting the thread into TeX.",
        );
        return;
      }

      const normalizedPath = normalizeRelativePath(chat.filePath);
      const openDoc = documentsRef.current.find(
        (document) => normalizeRelativePath(document.relativePath) === normalizedPath,
      );
      let content: string;
      try {
        content =
          openDoc?.content ??
          (await window.latexdo.readFile(currentProject, chat.filePath));
      } catch {
        setStatusMessage("Could not read the file for this review thread.");
        return;
      }

      const selectionText = chat.selection.text;
      // Prefer the recorded selection range; fall back to searching for the text.
      const lines = content.split("\n");
      let start = -1;
      if (chat.selection.startLine >= 1 && chat.selection.startLine <= lines.length) {
        let offset = 0;
        for (let line = 1; line < chat.selection.startLine; line += 1) {
          offset += lines[line - 1].length + 1;
        }
        const candidate = offset + chat.selection.startColumn - 1;
        if (
          content.slice(candidate, candidate + selectionText.length) === selectionText
        ) {
          start = candidate;
        }
      }
      if (start === -1) {
        start = content.indexOf(selectionText);
      }
      if (start === -1) {
        setStatusMessage(
          "Could not find the reviewed text in the file — it may have been edited.",
        );
        return;
      }

      const commentLatex = comments
        .map(
          (comment) =>
            `\\textbf{${escapeLatexText(comment.author)}:} ${escapeLatexText(comment.text)}`,
        )
        .join(" \\par ");
      const nextContent =
        content.slice(0, start) +
        `\\reviewercomment{${selectionText}}{${commentLatex}}` +
        content.slice(start + selectionText.length);

      if (openDoc) {
        setDocuments((current) => {
          const nextDocuments = current.map((document) =>
            document.path === openDoc.path
              ? { ...document, content: nextContent }
              : document,
          );
          documentsRef.current = nextDocuments;
          return nextDocuments;
        });
      } else {
        await window.latexdo.writeFile(currentProject, chat.filePath, nextContent);
        void compile();
      }

      setReviewChats((prev) => {
        const next = prev.map((existing) =>
          existing.id === chat.id ? { ...existing, insertedInTex: true } : existing,
        );
        void saveReviewData(next, rebuttalItems);
        return next;
      });
      setStatusMessage(
        "Inserted review thread into the TeX source — it will render on the next compile.",
      );
    },
    [compile, rebuttalItems, saveReviewData],
  );

  const handleJumpToReviewSelection = useCallback(
    async (chat: ReviewChat) => {
      const entry = allProjectEntries.find((e) => e.relativePath === chat.filePath);
      if (!entry) return;

      await openDocument(entry);
      pendingSourceRef.current = {
        path: entry.path,
        line: chat.selection.startLine,
        column: chat.selection.startColumn,
        endLine: chat.selection.endLine,
        endColumn: chat.selection.endColumn,
      };
      requestAnimationFrame(() => revealPendingSource());
    },
    [allProjectEntries, openDocument, revealPendingSource],
  );

  const handleAddRebuttalItem = useCallback(() => {
    const newItem: RebuttalItem = {
      id: Date.now().toString(),
      originalText: "",
      revisedText: "",
      insertedInTex: false,
      reviewerComment: "",
      authorComment: "",
      modificationMade: "",
    };
    setRebuttalItems((prev) => {
      const next = [...prev, newItem];
      void saveReviewData(reviewChats, next);
      return next;
    });
  }, [reviewChats, saveReviewData]);

  const handleUpdateRebuttalItem = useCallback(
    (id: string, updates: Partial<RebuttalItem>) => {
      setRebuttalItems((prev) => {
        const next = prev.map((item) =>
          item.id === id ? { ...item, ...updates } : item,
        );
        void saveReviewData(reviewChats, next);
        return next;
      });
    },
    [reviewChats, saveReviewData],
  );

  const handleDeleteRebuttalItem = useCallback(
    (id: string) => {
      if (!window.confirm("Delete this rebuttal item?")) return;
      setRebuttalItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        void saveReviewData(reviewChats, next);
        return next;
      });
    },
    [reviewChats, saveReviewData],
  );

  const handleRestoreHistorySnapshot = useCallback(
    async (snapshot: DocumentHistorySnapshot) => {
      const snapshotContent = await resolveHistorySnapshotContent(snapshot);
      if (snapshotContent === null) {
        setStatusMessage(`Could not load history content for ${snapshot.filePath}.`);
        return;
      }

      const entry = allProjectEntries.find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) ===
            normalizeRelativePath(snapshot.filePath),
      );
      if (!entry) {
        setStatusMessage(`${snapshot.filePath} is no longer in this project.`);
        return;
      }

      const currentProject = projectIdRef.current;
      const currentDocument = documentsRef.current.find(
        (document) =>
          normalizeRelativePath(document.relativePath) ===
          normalizeRelativePath(snapshot.filePath),
      );
      if (currentDocument && currentDocument.content !== snapshotContent) {
        addHistorySnapshot(buildHistorySnapshot(currentDocument, "restore"));
      }

      const savedContent = currentProject
        ? await window.latexdo
            .readFile(currentProject, entry.relativePath)
            .catch(() => snapshotContent)
        : snapshotContent;

      setWelcomeOpen(false);
      setActivePath(entry.path);
      activePathRef.current = entry.path;
      setDocuments((current) => {
        const exists = current.some((document) => document.path === entry.path);
        const nextDocuments = exists
          ? current.map((document) =>
              document.path === entry.path
                ? { ...document, content: snapshotContent, savedContent }
                : document,
            )
          : [
              ...current,
              {
                path: entry.path,
                relativePath: entry.relativePath,
                name: entry.name,
                content: snapshotContent,
                savedContent,
              },
            ];
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
      setStatusMessage(
        `Restored ${snapshot.filePath} from history. Save to write it to disk.`,
      );
    },
    [addHistorySnapshot, allProjectEntries, resolveHistorySnapshotContent],
  );

  const handleDeleteHistorySnapshot = useCallback(
    (snapshotId: string) => {
      updateDocumentHistory((current) =>
        current.filter((snapshot) => snapshot.id !== snapshotId),
      );
    },
    [updateDocumentHistory],
  );

  const handleInsertNotationCode = useCallback((code: string) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const document = documentsRef.current.find(
      (item) => item.path === activePathRef.current,
    );
    if (
      !editor ||
      !model ||
      !document ||
      !editorModelMatchesPath(editor, document.path) ||
      !document.name.endsWith(".tex")
    ) {
      setStatusMessage("Open a .tex document before inserting math.");
      return;
    }

    const selection = editor.getSelection();
    const selectedText =
      selection && !selection.isEmpty() ? model.getValueInRange(selection).trim() : "";
    const isInlineSnippet = code === "$x$";
    const insertText = selectedText
      ? code.replace("x = y", selectedText).replace("$x$", `$${selectedText}$`)
      : code;
    const position = editor.getPosition();
    const lineNumber = position?.lineNumber ?? model.getLineCount();
    const column = position?.column ?? model.getLineLength(lineNumber) + 1;
    editor.executeEdits("notation-manager", [
      {
        range:
          selection && !selection.isEmpty()
            ? selection
            : new monaco.Range(lineNumber, column, lineNumber, column),
        text: isInlineSnippet ? insertText : `\n${insertText}\n`,
        forceMoveMarkers: true,
      },
    ]);
    editor.focus();
    setStatusMessage("Inserted notation snippet.");
  }, []);

  const handleInsertCitationCode = useCallback(
    (key: string, command: CitationInsertCommand) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (
        !editor ||
        !model ||
        !document ||
        !editorModelMatchesPath(editor, document.path) ||
        !document.name.endsWith(".tex")
      ) {
        setStatusMessage("Open a .tex document before inserting a citation.");
        return;
      }

      const citation = `\\${command}{${key}}`;
      const selection = editor.getSelection();
      const selectedText =
        selection && !selection.isEmpty() ? model.getValueInRange(selection) : "";
      const position = editor.getPosition();
      const lineNumber = position?.lineNumber ?? model.getLineCount();
      const column = position?.column ?? model.getLineLength(lineNumber) + 1;
      editor.executeEdits("citation-manager", [
        {
          range:
            selection && !selection.isEmpty()
              ? selection
              : new monaco.Range(lineNumber, column, lineNumber, column),
          text: selectedText ? `${selectedText} ${citation}` : citation,
          forceMoveMarkers: true,
        },
      ]);
      editor.focus();
      setStatusMessage(`Inserted ${citation}`);
    },
    [],
  );

  const handleAppendBibEntry = useCallback(
    async (targetFile: string, bibtex: string) => {
      const currentProject = projectIdRef.current;
      if (!currentProject) {
        setStatusMessage("Open a project before editing BibTeX.");
        return;
      }

      const normalizedTarget = normalizeRelativePath(targetFile);
      const entry = flattenEntries(projectEntriesRef.current).find(
        (item) =>
          item.type === "file" &&
          normalizeRelativePath(item.relativePath) === normalizedTarget,
      );
      if (!entry) {
        setStatusMessage(`Could not find ${targetFile}`);
        return;
      }

      try {
        const openDocumentState = documentsRef.current.find(
          (document) =>
            normalizeRelativePath(document.relativePath) === normalizedTarget,
        );
        const currentContent =
          openDocumentState?.content ??
          (await window.latexdo.readFile(currentProject, entry.relativePath));
        const nextContent = `${currentContent.replace(/\s*$/, "")}\n\n${bibtex}\n`;

        await window.latexdo.writeFile(currentProject, entry.relativePath, nextContent);

        if (openDocumentState) {
          setDocuments((current) => {
            const nextDocuments = current.map((document) =>
              document.path === openDocumentState.path
                ? { ...document, content: nextContent, savedContent: nextContent }
                : document,
            );
            documentsRef.current = nextDocuments;
            return nextDocuments;
          });
        }

        setCitationProjectFiles((current) => {
          const found = current.some(
            (file) => normalizeRelativePath(file.path) === normalizedTarget,
          );
          if (found) {
            return current.map((file) =>
              normalizeRelativePath(file.path) === normalizedTarget
                ? { ...file, content: nextContent }
                : file,
            );
          }
          return [...current, { path: normalizedTarget, content: nextContent }];
        });

        await refreshProject(currentProject);
        setStatusMessage(`Added BibTeX stub to ${pathForDisplay(entry.relativePath)}`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not update BibTeX file",
        );
      }
    },
    [refreshProject],
  );

  useEffect(() => {
    if (historyAutoCaptureTimerRef.current !== null) {
      window.clearTimeout(historyAutoCaptureTimerRef.current);
      historyAutoCaptureTimerRef.current = null;
    }
    if (!projectId || !activeTextDocument?.path || showWelcome || showBlankWorkspace) {
      return;
    }

    historyAutoCaptureTimerRef.current = window.setTimeout(() => {
      historyAutoCaptureTimerRef.current = null;
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (
        !document ||
        !isTextDocument(document) ||
        !document.content.trim() ||
        document.content === document.savedContent
      ) {
        return;
      }
      addHistorySnapshot(buildHistorySnapshot(document, "auto"));
    }, historyAutoCaptureDelayMs);

    return () => {
      if (historyAutoCaptureTimerRef.current !== null) {
        window.clearTimeout(historyAutoCaptureTimerRef.current);
        historyAutoCaptureTimerRef.current = null;
      }
    };
  }, [
    activeTextDocument?.content,
    activeTextDocument?.path,
    addHistorySnapshot,
    projectId,
    showBlankWorkspace,
    showWelcome,
  ]);

  const MIN_SOURCE_WIDTH = 280;
  const MIN_PREVIEW_WIDTH = 360;
  const SPLIT_HANDLE_WIDTH = 6;
  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = editorPreviewRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onPointerMove = (moveEvent: PointerEvent) => {
      const totalWidth = rect.width;
      const maxSourceWidth = totalWidth - MIN_PREVIEW_WIDTH - SPLIT_HANDLE_WIDTH;
      const sourceWidth = clamp(
        moveEvent.clientX - rect.left,
        MIN_SOURCE_WIDTH,
        Math.max(MIN_SOURCE_WIDTH, maxSourceWidth),
      );
      const nextPercent = (sourceWidth / totalWidth) * 100;
      setSplitPercent(nextPercent);
    };
    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  };

  useEffect(() => {
    if (!previewShown) return;
    const container = editorPreviewRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const totalWidth = entry.contentRect.width;
      const maxSourceWidth = totalWidth - MIN_PREVIEW_WIDTH - SPLIT_HANDLE_WIDTH;
      if (maxSourceWidth <= MIN_SOURCE_WIDTH) {
        setSplitPercent(50);
        return;
      }
      const currentSourceWidth = (splitPercent / 100) * totalWidth;
      if (currentSourceWidth > maxSourceWidth) {
        setSplitPercent((maxSourceWidth / totalWidth) * 100);
      }
      if (currentSourceWidth < MIN_SOURCE_WIDTH) {
        setSplitPercent((MIN_SOURCE_WIDTH / totalWidth) * 100);
      }
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, [previewShown, splitPercent]);

  const startPanelResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelHeight;
    const handleMove = (moveEvent: PointerEvent) => {
      const mainArea = document.querySelector(".main-area")!;
      const maxHeight = mainArea.clientHeight - 100;
      const delta = startY - moveEvent.clientY;
      setPanelHeight(Math.max(80, Math.min(maxHeight, startHeight + delta)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const toggleGitChangeGroup = useCallback((groupId: string) => {
    setCollapsedGitGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const renderGitChangeRow = (entry: GitChangeEntry, area: GitChangeArea) => {
    const code = gitStatusCode(entry, area);
    const displayPath = entry.path;
    const directory = fileDirectory(entry.path);
    const statusLabel = gitStatusLabel(code);
    const isSelected =
      gitDiffSession?.relativePath === entry.path &&
      (area === "staged"
        ? gitDiffSession.modifiedRef.kind === "index"
        : gitDiffSession.modifiedRef.kind === "working-tree");

    return (
      <div
        key={`${entry.path}:${entry.indexStatus}:${entry.worktreeStatus}:${area}`}
        className={`scm-change-row ${isSelected ? "active" : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          setGitContextMenu({
            entry,
            area,
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <span className={`scm-status-badge ${gitStatusClass(code)}`}>{code}</span>
        <button
          type="button"
          className="scm-change-name"
          aria-label={`Open ${area === "staged" ? "staged" : "working tree"} diff for ${displayPath}`}
          title={`${statusLabel}: ${displayPath}`}
          onClick={() => {
            if (gitRowClickTimerRef.current !== null) {
              window.clearTimeout(gitRowClickTimerRef.current);
            }
            gitRowClickTimerRef.current = window.setTimeout(() => {
              gitRowClickTimerRef.current = null;
              void openGitDiffEditor(entry, area);
            }, 180);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            if (gitRowClickTimerRef.current !== null) {
              window.clearTimeout(gitRowClickTimerRef.current);
              gitRowClickTimerRef.current = null;
            }
            void openGitFile(entry.path);
          }}
        >
          <strong>{fileName(displayPath)}</strong>
          <span>{directory}</span>
        </button>

        <span
          className="scm-change-actions"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="scm-icon-action"
            onClick={() => void openGitFile(entry.path)}
            title="Open file"
            aria-label={`Open file ${displayPath}`}
          >
            <ExternalLink size={13} />
          </button>
          {area === "staged" ? (
            <button
              type="button"
              className="scm-icon-action"
              onClick={() => void unstageGitEntry(entry.path)}
              disabled={gitActionBusy === `unstage:${entry.path}`}
              title="Unstage changes"
              aria-label={`Unstage ${displayPath}`}
            >
              <Minus size={13} />
            </button>
          ) : (
            <>
              <button
                type="button"
                className="scm-icon-action"
                onClick={() => void stageGitEntry(entry.path)}
                disabled={gitActionBusy === `stage:${entry.path}`}
                title="Stage changes"
                aria-label={`Stage ${displayPath}`}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                className="scm-icon-action danger"
                onClick={() => void discardGitEntry(entry.path)}
                disabled={gitActionBusy === `discard:${entry.path}`}
                title="Discard changes"
                aria-label={`Discard ${displayPath}`}
              >
                <X size={13} />
              </button>
            </>
          )}
        </span>
      </div>
    );
  };

  const renderGitChangeGroup = (group: GitChangeGroup, area: GitChangeArea) => {
    const collapsed = collapsedGitGroups.has(group.id);
    const areaLabel = area === "staged" ? "staged changes" : "changes";

    return (
      <div className="scm-change-group" key={group.id}>
        <button
          type="button"
          className="scm-change-group-header"
          aria-expanded={!collapsed}
          aria-controls={group.domId}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${areaLabel} group ${group.label}`}
          title={group.label}
          onClick={() => toggleGitChangeGroup(group.id)}
        >
          <ChevronDown
            size={13}
            className={`scm-change-group-chevron${collapsed ? " collapsed" : ""}`}
            aria-hidden="true"
          />
          <span className="scm-change-group-title">{group.label}</span>
          <span className="scm-change-group-count">{group.entries.length}</span>
          <span className="scm-change-group-statuses" aria-hidden="true">
            {group.statusCounts.map((status) => (
              <span
                key={status.code}
                className="scm-change-group-status"
                title={`${status.count} ${status.label.toLowerCase()}`}
              >
                <span className={`scm-status-badge ${status.className}`}>
                  {status.code}
                </span>
                <span>{status.count}</span>
              </span>
            ))}
          </span>
        </button>
        <div id={group.domId} className="scm-change-group-files" hidden={collapsed}>
          {group.entries.map((entry) => renderGitChangeRow(entry, area))}
        </div>
      </div>
    );
  };

  const availableUpdateVersion = updateInfo?.updateAvailable
    ? updateInfo.latestVersion
    : null;
  const updateBannerVisible = Boolean(
    availableUpdateVersion && availableUpdateVersion !== dismissedUpdateVersion,
  );
  const updatePublishedLabel = formatUpdateDate(updateInfo?.publishedAt);
  const updateCheckedLabel = formatUpdateDate(updateInfo?.checkedAt);
  const updateLocationLabel = formatUpdateLocation(updateInfo?.releaseUrl);
  const currentBuildVersion =
    updateProgress?.currentVersion ?? updateInfo?.currentVersion ?? "Unknown";
  const latestBuildVersion =
    updateProgress?.latestVersion ?? updateInfo?.latestVersion ?? null;
  const updateHasResult = Boolean(updateInfo || updateProgress);
  const updateHasAvailableBuild = Boolean(
    updateInfo?.updateAvailable && latestBuildVersion,
  );
  const updateBuildSummary = updateHasAvailableBuild
    ? `Current build ${currentBuildVersion}. Available build ${latestBuildVersion}.`
    : updateHasResult && !updateInfo?.error && currentBuildVersion !== "Unknown"
      ? `Current build ${currentBuildVersion}. You are up to date.`
      : `Current build ${currentBuildVersion}.`;
  const updateActionText =
    updateInfo?.updateAvailable && updateInfo.automaticInstallAvailable === false
      ? "Open update"
      : updateInfo?.updateAvailable
        ? "Install update"
        : "Update manually";
  const updateProgressLabel = updateProgress
    ? formatUpdateProgress(updateProgress)
    : null;
  const updateProgressPercent =
    updateProgress?.percent === null || updateProgress?.percent === undefined
      ? null
      : Math.max(0, Math.min(100, updateProgress.percent));
  const updateProgressActive = Boolean(
    updateProgress &&
    updateProgress.status !== "done" &&
    (updatingNow || updateProgress.status !== "checking"),
  );

  return (
    <div className="app-shell" data-theme={settings.colorTheme}>
      {(!aiConfig.setupComplete || aiWizardOpen) && (
        <SetupWizard
          initialConfig={aiConfig}
          isDesktop={aiIsDesktop}
          onApplyTheme={(theme) =>
            setSettings((current) => ({ ...current, colorTheme: theme }))
          }
          onComplete={completeAiSetup}
        />
      )}
      {profileOpen && (
        <ProfileDialog
          profile={aiConfig.profile}
          onChange={(profile) => setAiConfig((c) => ({ ...c, profile }))}
          onClose={() => setProfileOpen(false)}
          onOpenExternal={(url) =>
            (
              window as { latexdo?: { openExternal?: (u: string) => void } }
            ).latexdo?.openExternal?.(url) ?? window.open(url, "_blank", "noopener")
          }
        />
      )}
      <header className="titlebar">
        <div className="titlebar-drag">
          <AppIcon className="app-mark" />
          <span className="title-project">{projectName}</span>
          <span className="title-separator">—</span>
          <span>LatexDo</span>
        </div>
        <div className="title-actions">
          <button
            type="button"
            className={`title-history-button title-share-button ${
              collaborationState.enabled ? "active" : ""
            }`}
            onClick={() => void createCollaborationLink()}
            disabled={shareButtonDisabled}
            title={shareButtonTitle}
            aria-label={shareButtonTitle}
          >
            <Link size={15} />
            <span>{shareButtonLabel}</span>
          </button>
          <button
            type="button"
            className={`title-history-button ${
              sidebarVisible && activeSidebar === "history" ? "active" : ""
            }`}
            onClick={() => openSidebar("history")}
            title="Open history"
            aria-label="Open history"
            aria-pressed={sidebarVisible && activeSidebar === "history"}
          >
            <History size={15} />
            <span>History</span>
            {documentHistory.length ? (
              <span className="title-history-count">{documentHistory.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={`icon-button ${sidebarVisible ? "active" : ""}`}
            onClick={toggleSidebar}
            title="Toggle sidebar (Cmd/Ctrl+B)"
            aria-label="Toggle sidebar"
            aria-pressed={sidebarVisible}
          >
            {sidebarVisible ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
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
                sidebarVisible && activeSidebar === "search" ? "active" : ""
              }`}
              onClick={() => openSidebar("search")}
              title="Project search"
            >
              <Search size={21} />
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
              className={`activity-button ${
                sidebarVisible && activeSidebar === "history" ? "active" : ""
              }`}
              onClick={() => openSidebar("history")}
              title="History"
            >
              <History size={21} />
            </button>
            <button
              className={`activity-button ${knowledgeGraphOpen ? "active" : ""}`}
              onClick={() => setKnowledgeGraphOpen((open) => !open)}
              title="Knowledge graph"
            >
              <Waypoints size={21} />
            </button>
            <button
              className={`activity-button ${
                sidebarVisible && activeSidebar === "ai" ? "active" : ""
              }`}
              onClick={() => openSidebar("ai")}
              title="AI assistant"
            >
              <Sparkles size={21} />
            </button>
            <button
              className={`activity-button ${tikzCanvasOpen ? "active" : ""}`}
              onClick={() => setTikzCanvasOpen((open) => !open)}
              title="Draw"
            >
              <Pencil size={21} />
            </button>
            {extensionToolAvailability.tableGenerator ? (
              <button
                className={`activity-button ${tableCanvasOpen ? "active" : ""}`}
                onClick={() => setTableCanvasOpen((open) => !open)}
                title="Table Generator"
              >
                <Box size={21} />
              </button>
            ) : null}
            {extensionToolAvailability.tikzConverter ? (
              <button
                className={`activity-button ${tikzConverterOpen ? "active" : ""}`}
                onClick={() => setTikzConverterOpen((open) => !open)}
                title="Figure → TikZ Converter"
              >
                <ImageUp size={21} />
              </button>
            ) : null}
            {extensionToolAvailability.notationManager ? (
              <button
                className={`activity-button ${notationManagerOpen ? "active" : ""}`}
                onClick={() => setNotationManagerOpen((open) => !open)}
                title="Notation Manager"
              >
                <Variable size={21} />
              </button>
            ) : null}
            {extensionToolAvailability.projectBibliography ? (
              <button
                className={`activity-button ${citationManagerOpen ? "active" : ""}`}
                onClick={() => setCitationManagerOpen((open) => !open)}
                title="Citation Manager"
              >
                <BookOpenText size={21} />
              </button>
            ) : null}
            <button
              className={`activity-button ${
                settingsOpen && settingsTab === "extensions" ? "active" : ""
              }`}
              onClick={() => {
                setSettingsTab("extensions");
                setSettingsOpen(true);
              }}
              title="Extension Store"
            >
              <Puzzle size={21} />
            </button>
          </div>
          <div>
            <button
              type="button"
              className={`activity-button ${profileOpen ? "active" : ""}`}
              onClick={() => setProfileOpen(true)}
              title="Researcher profile"
              aria-label="Open researcher profile"
              aria-pressed={profileOpen}
            >
              <User size={21} />
            </button>
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
          activeSidebar === "ai" ? (
            <aside className="sidebar" data-view="ai">
              <AiSidebar
                config={aiConfig}
                ctx={agentContext}
                isDesktop={aiIsDesktop}
                onOpenSettings={() => setAiWizardOpen(true)}
                onUpdateConfig={setAiConfig}
              />
            </aside>
          ) : (
            <aside
              className={`sidebar ${activeSidebar === "sourceControl" ? "source-control-sidebar" : ""}`}
              data-view={activeSidebar}
            >
              <div className="sidebar-header">
                <span>
                  {activeSidebar === "explorer"
                    ? "EXPLORER"
                    : activeSidebar === "sourceControl"
                      ? "SOURCE CONTROL"
                      : activeSidebar === "history"
                        ? "HISTORY"
                        : "SEARCH"}
                </span>
                <div>
                  {activeSidebar === "explorer" ? (
                    <>
                      <button
                        className="small-icon"
                        onClick={openProject}
                        title="Open project"
                      >
                        <FolderOpen size={14} />
                      </button>
                      <button
                        className="small-icon"
                        onClick={() => openCreateDialog("file")}
                        title="New file"
                        disabled={!hasVisibleProject}
                      >
                        <FilePlus2 size={15} />
                      </button>
                      <button
                        className="small-icon"
                        onClick={() => openCreateDialog("folder")}
                        title="New folder"
                        disabled={!hasVisibleProject}
                      >
                        <FolderPlus size={15} />
                      </button>
                      <button
                        className="small-icon"
                        onClick={() => void importDocx()}
                        title="Import DOCX"
                        disabled={docxImporting}
                      >
                        <FileUp size={15} />
                      </button>
                      <button
                        className="small-icon"
                        onClick={() => void importMarkdown()}
                        title="Import Markdown"
                        disabled={markdownImporting}
                      >
                        <Code2 size={15} />
                      </button>
                      <button
                        className="small-icon"
                        onClick={() => void refreshProject()}
                        title="Refresh"
                        disabled={!hasVisibleProject}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </>
                  ) : activeSidebar === "search" ? (
                    <button
                      className="small-icon"
                      onClick={() => {
                        setProjectSearchRefreshNonce((value) => value + 1);
                      }}
                      title="Rescan project search index"
                      disabled={!hasVisibleProject || projectSearchLoading}
                    >
                      <RefreshCw size={14} />
                    </button>
                  ) : activeSidebar === "sourceControl" ? (
                    <button
                      className="small-icon"
                      onClick={() => void refreshGitData()}
                      title="Refresh source control"
                    >
                      <RefreshCw size={14} />
                    </button>
                  ) : activeSidebar === "history" ? (
                    <button
                      className="small-icon"
                      onClick={() => captureActiveHistorySnapshot("manual")}
                      title="Capture current state"
                      disabled={!activeTextDocument}
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
              {activeSidebar === "explorer" ? (
                <>
                  <button className="project-heading" onClick={openProject}>
                    <ChevronDown size={13} />
                    <span>{projectName.toUpperCase()}</span>
                  </button>
                  <div className="file-tree">
                    {!hasVisibleProject ? (
                      <div className="sidebar-empty-state">
                        No project open. Create a project or open an existing folder.
                      </div>
                    ) : mode === "author" ? (
                      <FileTree
                        entries={projectEntries}
                        activePath={activePath}
                        onOpen={openDocument}
                        onCompileFile={(entry) => void compileEntry(entry)}
                        onSetRootFile={(entry) => {
                          setRootFile(entry.relativePath);
                          rootFileRef.current = entry.relativePath;
                          setStatusMessage(
                            `Main file set to ${pathForDisplay(entry.relativePath)}`,
                          );
                        }}
                        onMoveEntry={(sourcePath, destination) =>
                          void moveEntry(sourcePath, destination)
                        }
                        onImportExternalFiles={(files, destination) =>
                          void importExternalFiles(files, destination)
                        }
                        onChooseImportFilesInDirectory={chooseImportFiles}
                        onCreateFileInDirectory={(entry) =>
                          openCreateDialogInDirectory("file", entry)
                        }
                        onCreateFolderInDirectory={(entry) =>
                          openCreateDialogInDirectory("folder", entry)
                        }
                        onCopyRelativePath={(entry) => void copyRelativePath(entry)}
                        onInsertFileReference={insertImageReference}
                        onRevealFile={(entry) => void revealGitFile(entry.relativePath)}
                      />
                    ) : mode === "reviewer" ? (
                      <ReviewSidebar
                        chats={reviewChats}
                        onAddChat={handleAddReviewChat}
                        onAddComment={handleAddReviewComment}
                        onDeleteChat={handleDeleteReviewChat}
                        onJumpToSelection={handleJumpToReviewSelection}
                        onInsertIntoTex={(chat) =>
                          void handleInsertReviewChatIntoTex(chat)
                        }
                      />
                    ) : (
                      <RebuttalSidebar
                        items={rebuttalItems}
                        onAddItem={handleAddRebuttalItem}
                        onAddRebuttalToSource={handleAddRebuttalToSource}
                        onUpdateItem={handleUpdateRebuttalItem}
                        onDeleteItem={handleDeleteRebuttalItem}
                        onGenerateLetter={handleGenerateRebuttalLetter}
                      />
                    )}
                  </div>
                </>
              ) : activeSidebar === "search" ? (
                <div className="sidebar-panel">
                  {!hasVisibleProject ? (
                    <div className="sidebar-empty-state">
                      No project open. Open a folder to search across project files.
                    </div>
                  ) : (
                    <ProjectSearchPanel
                      files={projectSearchFiles}
                      loading={projectSearchLoading}
                      error={projectSearchError}
                      activePath={activeDocument?.relativePath}
                      onOpenMatch={(match) => {
                        void handleOpenProjectSearchMatch(match);
                      }}
                      onRefresh={() => {
                        setProjectSearchRefreshNonce((value) => value + 1);
                      }}
                    />
                  )}
                </div>
              ) : activeSidebar === "sourceControl" ? (
                <div className="sidebar-panel source-control-panel">
                  <div className="scm-head">
                    <div className="scm-branch">
                      <GitBranch size={14} />
                      <span>{gitStatus?.branch || "No repository"}</span>
                    </div>
                    <span className="scm-change-count">
                      {gitLoading
                        ? "Refreshing"
                        : gitStatus?.isRepo
                          ? `${modifiedFiles} changed`
                          : "Unavailable"}
                    </span>
                  </div>
                  {gitStatus?.isRepo ? (
                    <div className="scm-commit-box">
                      <textarea
                        value={gitCommitMessage}
                        onChange={(event) => setGitCommitMessage(event.target.value)}
                        placeholder="Commit message"
                      />
                      <button
                        className="scm-commit-action"
                        onClick={() => void commitGitChanges()}
                        disabled={
                          gitActionBusy === "commit" || !gitCommitMessage.trim()
                        }
                      >
                        <Check size={13} />
                        <span>
                          {gitActionBusy === "commit" ? "Committing..." : "Commit"}
                        </span>
                        <ChevronDown size={13} className="scm-commit-chevron" />
                      </button>
                    </div>
                  ) : null}
                  <div className="sidebar-list source-control-list">
                    {gitStatus?.isRepo ? (
                      <>
                        {gitStatus.entries.length ? (
                          <>
                            <div className="scm-section-header">
                              <span>
                                Staged Changes <b>{stagedGitEntries.length}</b>
                              </span>
                              <button
                                type="button"
                                className="scm-icon-action"
                                onClick={() => void unstageAllGitEntries()}
                                disabled={
                                  !stagedGitEntries.length ||
                                  gitActionBusy === "unstage-all"
                                }
                                title="Unstage all"
                                aria-label="Unstage all changes"
                              >
                                <Minus size={13} />
                              </button>
                            </div>
                            {stagedGitEntries.length ? (
                              stagedGitGroups.map((group) =>
                                renderGitChangeGroup(group, "staged"),
                              )
                            ) : (
                              <div className="sidebar-empty-state compact">
                                No staged changes.
                              </div>
                            )}
                            <div className="scm-section-header">
                              <span>
                                Changes <b>{unstagedGitEntries.length}</b>
                              </span>
                              <div className="scm-section-actions">
                                <button
                                  type="button"
                                  className="scm-icon-action"
                                  onClick={() => void stageAllGitEntries()}
                                  disabled={
                                    !unstagedGitEntries.length ||
                                    gitActionBusy === "stage-all"
                                  }
                                  title="Stage all"
                                  aria-label="Stage all changes"
                                >
                                  <Plus size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="scm-icon-action danger"
                                  onClick={() => void discardAllGitEntries()}
                                  disabled={
                                    !unstagedGitEntries.length ||
                                    gitActionBusy === "discard-all"
                                  }
                                  title="Discard all unstaged changes"
                                  aria-label="Discard all unstaged changes"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                            {unstagedGitEntries.length ? (
                              unstagedGitGroups.map((group) =>
                                renderGitChangeGroup(group, "changes"),
                              )
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
                        <div className="scm-section-header">
                          <span>Timeline</span>
                        </div>
                        <div className="scm-timeline">
                          <GitGraph
                            commits={gitRepositoryCommits}
                            selectedHash={selectedGitCommitHash}
                            loading={gitLoading && !gitRepoHistory}
                            onSelectCommit={(commit: GitGraphCommit) => {
                              void openGitCommitDetails(commit.hash);
                            }}
                            emptyMessage="No repository history available."
                          />
                        </div>
                        {gitFileHistoryPath ? (
                          <>
                            <div className="scm-section-header">
                              <span title={gitFileHistoryPath}>
                                File History ({fileName(gitFileHistoryPath)})
                              </span>
                            </div>
                            <div className="scm-file-history">
                              {gitFileCommits.length ? (
                                gitFileCommits.slice(0, 6).map((commit) => (
                                  <div
                                    key={`${commit.hash}:${gitFileHistoryPath}`}
                                    className="scm-file-history-row"
                                  >
                                    <strong>{commit.subject}</strong>
                                    <span>
                                      {commit.shortHash} · {commit.authorName} ·{" "}
                                      {formatGitDate(commit.authoredAt)}
                                    </span>
                                    <div className="scm-file-history-actions">
                                      <button
                                        className="sidebar-mini-action subtle"
                                        onClick={() =>
                                          void openGitCommitDetails(commit.hash)
                                        }
                                      >
                                        Details
                                      </button>
                                      <button
                                        className="sidebar-mini-action subtle"
                                        onClick={() =>
                                          void openGitCommitRevisionDiff(
                                            commit.hash,
                                            gitFileHistoryPath,
                                          )
                                        }
                                        disabled={
                                          gitActionBusy ===
                                          `commit-diff:${commit.hash}:${gitFileHistoryPath}`
                                        }
                                      >
                                        {gitActionBusy ===
                                        `commit-diff:${commit.hash}:${gitFileHistoryPath}`
                                          ? "Opening…"
                                          : "Open Diff"}
                                      </button>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="sidebar-empty-state compact">
                                  No file history for {fileName(gitFileHistoryPath)}.
                                </div>
                              )}
                            </div>
                          </>
                        ) : null}
                        <div className="scm-section-header">
                          <span>Commit Details</span>
                        </div>
                        <div className="scm-commit-details">
                          {gitCommitDetails ? (
                            <>
                              <h3>
                                {gitCommitDetails.summary || gitCommitDetails.hash}
                              </h3>
                              {gitCommitDetails.body ? (
                                <p className="scm-commit-body">
                                  {gitCommitDetails.body}
                                </p>
                              ) : null}
                              <dl>
                                <dt>Commit</dt>
                                <dd title={gitCommitDetails.hash}>
                                  {gitCommitDetails.hash}
                                </dd>
                                <dt>Author</dt>
                                <dd>
                                  {gitCommitDetails.authorName} &lt;
                                  {gitCommitDetails.authorEmail}&gt;
                                </dd>
                                <dt>Authored</dt>
                                <dd>{formatGitDate(gitCommitDetails.authoredAt)}</dd>
                                <dt>Committed</dt>
                                <dd>{formatGitDate(gitCommitDetails.committedAt)}</dd>
                                <dt>Parents</dt>
                                <dd title={gitCommitDetails.parents.join(" ")}>
                                  {gitCommitDetails.parents.length
                                    ? gitCommitDetails.parents
                                        .map((parent) => parent.slice(0, 8))
                                        .join(", ")
                                    : "Root commit"}
                                </dd>
                              </dl>
                              {gitCommitDetails.refs.length ? (
                                <div className="scm-detail-refs">
                                  {gitCommitDetails.refs.map((ref) => (
                                    <span
                                      key={`${ref.kind}:${ref.name}`}
                                      className={ref.kind}
                                    >
                                      {ref.name}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              {gitCommitDetails.parents.length > 1 ? (
                                <label className="scm-parent-selector">
                                  <span>Compare with parent</span>
                                  <select
                                    value={gitCommitParentHash}
                                    onChange={(event) =>
                                      setGitCommitParentHash(event.target.value)
                                    }
                                  >
                                    {gitCommitDetails.parents.map((parent, index) => (
                                      <option key={parent} value={parent}>
                                        Parent {index + 1} · {parent.slice(0, 8)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : null}
                              <div
                                className="scm-detail-files"
                                aria-label="Changed files"
                              >
                                {gitCommitDetails.changedFiles.map((file) => {
                                  const code = gitDiffStatusCode(file.status);
                                  return (
                                    <button
                                      key={`${file.oldPath ?? ""}:${file.path}`}
                                      type="button"
                                      onClick={() =>
                                        void openGitCommitRevisionDiff(
                                          gitCommitDetails.hash,
                                          file.path,
                                          gitCommitParentHash,
                                        )
                                      }
                                      title={`Open ${file.path} diff`}
                                    >
                                      <span
                                        className={`scm-status-badge ${gitStatusClass(code)}`}
                                      >
                                        {code}
                                      </span>
                                      <span>
                                        <strong>{fileName(file.path)}</strong>
                                        <small>
                                          {file.oldPath
                                            ? `${file.oldPath} → ${file.path}`
                                            : fileDirectory(file.path)}
                                        </small>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
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
                  {gitContextMenu ? (
                    <div
                      className="scm-context-menu"
                      role="menu"
                      aria-label={`Actions for ${gitContextMenu.entry.path}`}
                      style={{
                        left: Math.min(gitContextMenu.x, window.innerWidth - 210),
                        top: Math.min(gitContextMenu.y, window.innerHeight - 260),
                      }}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const { entry, area } = gitContextMenu;
                          setGitContextMenu(null);
                          void openGitDiffEditor(entry, area);
                        }}
                      >
                        Open Diff
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const path = gitContextMenu.entry.path;
                          setGitContextMenu(null);
                          void openGitFile(path);
                        }}
                      >
                        Open File
                      </button>
                      {gitContextMenu.area === "staged" ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            const path = gitContextMenu.entry.path;
                            setGitContextMenu(null);
                            void unstageGitEntry(path);
                          }}
                        >
                          Unstage Changes
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              const path = gitContextMenu.entry.path;
                              setGitContextMenu(null);
                              void stageGitEntry(path);
                            }}
                          >
                            Stage Changes
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => {
                              const path = gitContextMenu.entry.path;
                              setGitContextMenu(null);
                              void discardGitEntry(path);
                            }}
                          >
                            Discard Changes
                          </button>
                        </>
                      )}
                      <span className="scm-context-menu-separator" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const path = gitContextMenu.entry.path;
                          setGitContextMenu(null);
                          void revealGitFile(path);
                        }}
                      >
                        Reveal in File Manager
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const path = gitContextMenu.entry.path;
                          setGitContextMenu(null);
                          void copyGitPath(path);
                        }}
                      >
                        <Copy size={13} /> Copy Path
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const path = gitContextMenu.entry.path;
                          setGitContextMenu(null);
                          void openGitFileHistory(path);
                        }}
                      >
                        Open File History
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : activeSidebar === "history" ? (
                <div className="sidebar-panel history-panel">
                  <HistorySidebar
                    activeFilePath={activeTextDocument?.relativePath}
                    activeFileContent={activeTextDocument?.content}
                    activeFileSnapshotCount={activeDocumentHistoryCount}
                    totalSnapshotCount={documentHistory.length}
                    snapshots={documentHistory}
                    onCaptureSnapshot={() => captureActiveHistorySnapshot("manual")}
                    onLoadSnapshotContent={hydrateHistorySnapshotContent}
                    onRestoreSnapshot={handleRestoreHistorySnapshot}
                    onDeleteSnapshot={handleDeleteHistorySnapshot}
                  />
                </div>
              ) : null}
            </aside>
          )
        ) : null}

        <main className="main-area">
          <div className="document-tabs">
            {welcomeOpen ? (
              <button
                className={`document-tab welcome-tab ${showWelcome ? "active" : ""}`}
                onClick={showWelcomePage}
              >
                <AppIcon className="welcome-tab-mark" />
                <span>Welcome</span>
                <span className="tab-close" onClick={closeWelcomePage}>
                  <X size={13} />
                </span>
              </button>
            ) : null}
            {gitDiffSession ? (
              <button
                className={`document-tab git-diff-tab ${!showWelcome && !activeDocument ? "active" : ""}`}
                onClick={() => {
                  setWelcomeOpen(false);
                  setActivePath("");
                  activePathRef.current = "";
                }}
              >
                <GitBranch size={14} className="tab-file-icon" />
                <span>{gitDiffTabLabel(gitDiffSession)}</span>
                <span
                  className="tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeGitDiffSession();
                  }}
                >
                  <X size={13} />
                </span>
              </button>
            ) : null}
            {documents.map((document) => {
              const dirty =
                isTextDocument(document) && document.content !== document.savedContent;
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
                  {document.kind === "asset" ? (
                    <FileImage size={14} className="tab-file-icon" />
                  ) : (
                    <Code2 size={14} className="tab-file-icon" />
                  )}
                  <span>{pathForDisplay(document.name)}</span>
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
            ref={editorPreviewRef}
            className={`editor-preview ${previewShown ? "with-preview" : "without-preview"}`}
            style={
              {
                "--source-width": previewShown ? `${splitPercent}%` : "100%",
              } as React.CSSProperties
            }
          >
            <section
              className={`source-pane ${showWelcome ? "welcome-only" : ""} ${showEmptyEditor ? "empty-only" : ""} ${gitDiffSession ? "git-diff-active" : ""}`}
            >
              {activeDocument &&
              !showWelcome &&
              !gitDiffSession &&
              activeDocumentIsAssetPreview ? (
                <div className="source-toolbar asset-source-toolbar">
                  <div className="asset-toolbar-file">
                    <span className="pane-label">
                      {assetPreviewTypeLabel(activeDocument.assetMimeType)}
                    </span>
                    <FileImage size={14} />
                    <span>{pathForDisplay(activeDocument.relativePath)}</span>
                    {formatAssetSize(activeDocument.assetSizeBytes) ? (
                      <small>{formatAssetSize(activeDocument.assetSizeBytes)}</small>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {activeDocument &&
              !showWelcome &&
              !gitDiffSession &&
              !activeDocumentIsAssetPreview ? (
                <div className="source-toolbar">
                  <div className="root-control">
                    <span className="control-label">ROOT</span>
                    <div className="select-wrap">
                      <select
                        value={rootFile}
                        onChange={(event) => setRootFile(event.target.value)}
                      >
                        {texFiles.map((entry) => (
                          <option key={entry.path} value={entry.relativePath}>
                            {pathForDisplay(entry.relativePath)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </div>

                  {activeDocumentIsLatex && documentOutline.length ? (
                    <div className="root-control outline-control">
                      <span className="control-label">NAV</span>
                      <div className="select-wrap">
                        <select
                          value=""
                          aria-label="Document outline"
                          onChange={(event) => {
                            const item = documentOutline.find(
                              (outlineItem) => outlineItem.id === event.target.value,
                            );
                            event.currentTarget.value = "";
                            if (item) {
                              revealOutlineLine(item.line, item.column);
                            }
                          }}
                        >
                          <option value="">Outline</option>
                          {documentOutline.map((item) => (
                            <option key={item.id} value={item.id}>
                              {`${"  ".repeat(Math.max(0, item.level - 2))}${item.detail} ${item.label}`}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={13} />
                      </div>
                    </div>
                  ) : null}

                  <div className="root-control">
                    <span className="control-label">MODE</span>
                    <div className="mode-selector-toolbar">
                      <button
                        className={`mode-button-mini ${mode === "author" ? "active" : ""}`}
                        onClick={() => setMode("author")}
                        title="Author Mode"
                      >
                        <User size={13} />
                        <span>Author</span>
                      </button>
                      <button
                        className={`mode-button-mini ${mode === "reviewer" ? "active" : ""}`}
                        onClick={() => setMode("reviewer")}
                        title="Reviewer Mode"
                      >
                        <MessageSquare size={13} />
                        <span>Reviewer</span>
                      </button>
                      <button
                        className={`mode-button-mini ${mode === "rebuttal" ? "active" : ""}`}
                        onClick={() => setMode("rebuttal")}
                        title="Rebuttal Mode"
                      >
                        <History size={13} />
                        <span>Rebuttal</span>
                      </button>
                    </div>
                  </div>

                  <div className="collaboration-control">
                    <button
                      type="button"
                      className={`collaboration-button ${collaborationState.enabled ? "active" : ""}`}
                      onClick={() => void createCollaborationLink()}
                      disabled={shareButtonDisabled}
                      title={shareButtonTitle}
                      aria-label={shareButtonTitle}
                    >
                      <Link size={14} />
                      <span>{shareButtonLabel}</span>
                    </button>
                  </div>

                  {activeDocumentIsLatex ? (
                    <div
                      className="tex-format-toolbar"
                      role="toolbar"
                      aria-label="LaTeX formatting"
                    >
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("bold")}
                        title={"Bold (\\textbf{})"}
                        aria-label="Bold"
                      >
                        <Bold size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("italic")}
                        title={"Italic (\\emph{})"}
                        aria-label="Italic"
                      >
                        <Italic size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("underline")}
                        title={"Underline (\\underline{})"}
                        aria-label="Underline"
                      >
                        <Underline size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("math")}
                        title="Inline math"
                        aria-label="Inline math"
                      >
                        <Sigma size={14} />
                      </button>

                      <span className="tex-format-divider" aria-hidden="true" />

                      <button
                        type="button"
                        className="tex-format-button"
                        onClick={() => applyLatexToolbarCommand("section")}
                        title={"Section (\\section{})"}
                      >
                        <Heading1 size={14} />
                        <span>Section</span>
                      </button>
                      <button
                        type="button"
                        className="tex-format-button"
                        onClick={() => applyLatexToolbarCommand("subsection")}
                        title={"Subsection (\\subsection{})"}
                      >
                        <Heading2 size={14} />
                        <span>Subsection</span>
                      </button>
                      <button
                        type="button"
                        className="tex-format-button"
                        onClick={() => applyLatexToolbarCommand("equation")}
                        title="Equation block"
                      >
                        <Sigma size={14} />
                        <span>Equation</span>
                      </button>

                      <span className="tex-format-divider" aria-hidden="true" />

                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("itemize")}
                        title="Bullet list"
                        aria-label="Bullet list"
                      >
                        <List size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("enumerate")}
                        title="Numbered list"
                        aria-label="Numbered list"
                      >
                        <ListOrdered size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button"
                        onClick={() => applyLatexToolbarCommand("cite")}
                        title={"Citation (\\cite{})"}
                      >
                        <BookOpenText size={14} />
                        <span>Cite</span>
                      </button>
                      <button
                        type="button"
                        className="tex-format-button"
                        onClick={() => applyLatexToolbarCommand("ref")}
                        title={"Reference (\\ref{})"}
                      >
                        <Link size={14} />
                        <span>Ref</span>
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("href")}
                        title={"Link (\\href{}{})"}
                        aria-label="Link"
                      >
                        <Link size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => void openLinkAtCursor()}
                        title="Open link at cursor"
                        aria-label="Open link at cursor"
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={() => applyLatexToolbarCommand("formatTable")}
                        title="Format LaTeX table columns"
                        aria-label="Format table"
                      >
                        <Table2 size={14} />
                      </button>
                      <button
                        type="button"
                        className="tex-format-button icon-only"
                        onClick={toggleBookmarkAtCurrentLine}
                        title="Toggle bookmark"
                        aria-label="Toggle bookmark"
                      >
                        <Bookmark size={14} />
                      </button>
                    </div>
                  ) : null}

                  <button
                    className={`compile-button ${compiling ? "compiling" : ""}`}
                    onClick={() => void compile()}
                    disabled={!rootFile && !activeDocumentIsAsymptote}
                    title={
                      compiling
                        ? "Start another background compile"
                        : activeDocumentIsAsymptote
                          ? "Compile Asymptote"
                          : "Compile"
                    }
                  >
                    {compiling ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                  </button>
                </div>
              ) : null}
              {showWelcome ? (
                <div className="welcome-page">
                  <div className="welcome-hero">
                    <AppIcon className="welcome-brand" />
                    <div>
                      <h1>LatexDo</h1>
                      <p>Start from a working LaTeX document. Compile locally.</p>
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
                      {hasVisibleProject ? (
                        <button
                          className="welcome-action"
                          onClick={() => openCreateDialog("file")}
                        >
                          <FilePlus2 size={18} />
                          <span>
                            <strong>New File</strong>
                            <small>
                              Add a .tex, .bib, or text file to this project
                            </small>
                          </span>
                        </button>
                      ) : null}
                      <button
                        className="welcome-action"
                        onClick={() => void importDocx()}
                        disabled={docxImporting}
                      >
                        <FileUp size={18} />
                        <span>
                          <strong>Import DOCX</strong>
                          <small>
                            Convert a Word document into LaTeX and extracted media
                          </small>
                        </span>
                      </button>
                      <button
                        className="welcome-action"
                        onClick={() => void importMarkdown()}
                        disabled={markdownImporting}
                      >
                        <Code2 size={18} />
                        <span>
                          <strong>Import Markdown</strong>
                          <small>Convert a Markdown file into LaTeX</small>
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
                    <section className="welcome-section welcome-template-section">
                      <h2>Template gallery</h2>
                      <div className="welcome-template-grid">
                        {availableWelcomeTemplates.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            className="welcome-template-card"
                            onClick={() => void createProjectFromTemplate(template)}
                            disabled={templateCreating !== null}
                          >
                            <span className="welcome-template-icon">
                              {renderTemplateIcon(template)}
                            </span>
                            <span className="welcome-template-copy">
                              <strong>{template.name}</strong>
                              <small>{template.summary}</small>
                              <em>
                                {templateCreating === template.id
                                  ? "Creating..."
                                  : template.files}
                              </em>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>

                  <div className="welcome-tip">
                    <Command size={14} />
                    <span>
                      Compile anytime with <kbd>⌘</kbd> <kbd>Enter</kbd>
                    </span>
                  </div>
                </div>
              ) : activeDocumentIsAssetPreview && activeDocument?.assetDataUrl ? (
                <div
                  className={`asset-preview-pane ${
                    activeDocument.assetMimeType === "application/pdf"
                      ? "asset-preview-pdf-pane"
                      : ""
                  }`}
                  aria-label={`${pathForDisplay(activeDocument.relativePath)} preview`}
                >
                  {activeDocument.assetMimeType === "application/pdf" &&
                  activeDocument.assetBytes ? (
                    <Suspense
                      fallback={
                        <div className="preview-empty" aria-label="Loading PDF">
                          <LoaderCircle className="spin" size={18} />
                        </div>
                      }
                    >
                      <PdfPreview
                        data={activeDocument.assetBytes}
                        scale={pdfScale}
                        rotation={pdfRotation}
                        target={null}
                      />
                    </Suspense>
                  ) : activeDocument.assetMimeType === "application/pdf" ? (
                    <div className="asset-preview-fallback">
                      PDF preview unavailable.
                    </div>
                  ) : (
                    <img
                      className="asset-preview-image"
                      src={activeDocument.assetDataUrl}
                      alt={`${pathForDisplay(activeDocument.relativePath)} preview`}
                      draggable={false}
                    />
                  )}
                </div>
              ) : activeDocument ? (
                <div
                  className="editor-drop-zone"
                  onDragOver={(event) => {
                    if (Array.from(event.dataTransfer.types).includes("Files")) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                    }
                  }}
                  onDropCapture={(event) => void handleEditorFileDrop(event)}
                >
                  {activeCollaborationReadOnlyMessage ? (
                    <div className="editor-readonly-banner" role="status">
                      <Lock size={13} />
                      <span>{activeCollaborationReadOnlyMessage}</span>
                    </div>
                  ) : null}
                  <Suspense
                    fallback={
                      <div className="editor-loading" role="status">
                        Loading editor...
                      </div>
                    }
                  >
                    <MonacoEditor
                      key={activeDocument.path}
                      path={activeDocument.path}
                      defaultValue={activeDocument.content}
                      defaultLanguage={languageFor(activeDocument.name)}
                      language={languageFor(activeDocument.name)}
                      theme={editorTheme}
                      beforeMount={configureMonaco}
                      onMount={handleEditorMount}
                      onChange={(value) =>
                        handleEditorChange(activeDocument.path, value)
                      }
                      options={{
                        readOnly: Boolean(activeCollaborationReadOnlyMessage),
                        readOnlyMessage: {
                          value:
                            activeCollaborationReadOnlyMessage ||
                            "This document is read-only.",
                        },
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
                        glyphMargin: true,
                        folding: true,
                        foldingStrategy: "auto",
                        showFoldingControls: "mouseover",
                        links: true,
                        multiCursorModifier: "alt",
                        multiCursorPaste: "spread",
                        columnSelection: false,
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        fixedOverflowWidgets: false,
                        acceptSuggestionOnCommitCharacter: false,
                        acceptSuggestionOnEnter: "off",
                        quickSuggestions: {
                          other: true,
                          comments: false,
                          strings: true,
                        },
                        snippetSuggestions: "top",
                        suggest: { showSnippets: true },
                      }}
                    />
                  </Suspense>
                </div>
              ) : gitDiffSession ? (
                <GitDiffWorkbench
                  session={gitDiffSession}
                  theme={editorTheme}
                  fontSize={settings.editorFontSize}
                  blameLines={gitBlameLines}
                  beforeMount={configureMonaco}
                  onOpenFile={(relativePath) => void openGitFile(relativePath)}
                  onClose={() => closeGitDiffSession()}
                />
              ) : (
                <div className="empty-editor">
                  <AppIcon className="empty-logo" />
                  <h2>
                    {showBlankWorkspace ? "No project is open" : "No editor is open"}
                  </h2>
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
                        onClick={() => void handlePdfPointToSource()}
                        disabled={!pdfData || !(pdfTarget ?? lastPdfLocation)}
                        title="Show PDF point in source"
                        aria-label="Show PDF point in source"
                      >
                        <ArrowLeftToLine size={15} />
                      </button>
                      <button
                        onClick={() => void handleEditorCursorToPdf()}
                        title="Show editor cursor in PDF"
                        aria-label="Show editor cursor in PDF"
                      >
                        <ArrowRightToLine size={15} />
                      </button>
                      <div className="preview-action-divider" aria-hidden="true" />
                      <button
                        onClick={() => setPdfScale((scale) => Math.max(60, scale - 10))}
                        title="Zoom out"
                      >
                        <ZoomOut size={15} />
                      </button>
                      <span>{pdfScale}%</span>
                      <button
                        onClick={() =>
                          setPdfScale((scale) => Math.min(180, scale + 10))
                        }
                        title="Zoom in"
                      >
                        <ZoomIn size={15} />
                      </button>
                      <button
                        onClick={() =>
                          setPdfRotation((rotation) => (rotation + 90) % 360)
                        }
                        title={`Rotate PDF (${pdfRotation} deg)`}
                        aria-label="Rotate PDF"
                      >
                        <RotateCw size={15} />
                      </button>
                      <button onClick={() => void downloadPdf()} title="Download PDF">
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                  <div
                    className="pdf-surface"
                    onWheel={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        setPdfScale((s) =>
                          Math.max(60, Math.min(180, s + (e.deltaY > 0 ? -10 : 10))),
                        );
                      }
                    }}
                  >
                    {pdfData ? (
                      <Suspense
                        fallback={
                          <div className="preview-empty" aria-label="Loading PDF">
                            <LoaderCircle className="spin" size={18} />
                          </div>
                        }
                      >
                        <PdfPreview
                          data={pdfData}
                          scale={pdfScale}
                          rotation={pdfRotation}
                          target={pdfTarget}
                          onNavigate={(location) => {
                            setPdfTarget(null);
                            setLastPdfLocation(location);
                            void handleBackwardSync(location);
                          }}
                        />
                      </Suspense>
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

          {knowledgeGraphOpen && (
            <div className="tikz-modal-overlay kg-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">Knowledge Graph</span>
                <button
                  className="tikz-modal-close"
                  onClick={() => setKnowledgeGraphOpen(false)}
                  aria-label="Close Knowledge Graph"
                  title="Close Knowledge Graph (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="tikz-modal-content kg-modal-content">
                <KnowledgeGraphView
                  graph={knowledgeGraph}
                  params={knowledgeGraphParams}
                  onParamsChange={setKnowledgeGraphParams}
                  entriesByKey={citationEntriesByKey}
                  onInsertCitation={(key) => {
                    insertCitationKey(key);
                    setKnowledgeGraphOpen(false);
                  }}
                  onRecommendForSelection={recommendCitationsForSelection}
                />
              </div>
            </div>
          )}

          {tikzCanvasOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">TikZ Drawing Canvas</span>
                <button
                  className="tikz-modal-close"
                  onClick={() => setTikzCanvasOpen(false)}
                  aria-label="Close TikZ Drawing Canvas"
                  title="Close TikZ Drawing Canvas (Esc)"
                >
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
                            range: new monaco.Range(
                              lineNumber,
                              column,
                              lineNumber,
                              column,
                            ),
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

          {extensionToolAvailability.tableGenerator && tableCanvasOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">Table Generator</span>
                <button
                  className="tikz-modal-close"
                  onClick={() => setTableCanvasOpen(false)}
                  aria-label="Close Table Generator"
                  title="Close Table Generator (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="tikz-modal-content">
                <TableCanvas
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
                            range: new monaco.Range(
                              lineNumber,
                              column,
                              lineNumber,
                              column,
                            ),
                            text: "\n" + code + "\n",
                          },
                        ]);
                      }
                    }
                    setTableCanvasOpen(false);
                  }}
                />
              </div>
            </div>
          )}

          {extensionToolAvailability.tikzConverter && tikzConverterOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">
                  <ImageUp size={16} />
                  <span>Figure → TikZ Converter</span>
                </span>
                <button
                  className="tikz-modal-close"
                  onClick={() => setTikzConverterOpen(false)}
                  aria-label="Close Figure to TikZ Converter"
                  title="Close Figure to TikZ Converter (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="tikz-modal-content">
                <FigureToTikzConverter
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
                            range: new monaco.Range(
                              lineNumber,
                              column,
                              lineNumber,
                              column,
                            ),
                            text: "\n" + code + "\n",
                          },
                        ]);
                      }
                    }
                    setTikzConverterOpen(false);
                  }}
                />
              </div>
            </div>
          )}

          {extensionToolAvailability.notationManager && notationManagerOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">
                  <Variable size={16} />
                  <span>Notation Manager</span>
                </span>
                <button
                  className="tikz-modal-close"
                  onClick={() => setNotationManagerOpen(false)}
                  aria-label="Close Notation Manager"
                  title="Close Notation Manager (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="tikz-modal-content">
                <NotationManager
                  content={activeDocument?.content ?? ""}
                  onInsertCode={(code) => {
                    handleInsertNotationCode(code);
                    setNotationManagerOpen(false);
                  }}
                />
              </div>
            </div>
          )}

          {extensionToolAvailability.projectBibliography && citationManagerOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">
                  <BookOpenText size={16} />
                  <span>Citation Manager</span>
                </span>
                <button
                  className="tikz-modal-close"
                  onClick={() => setCitationManagerOpen(false)}
                  aria-label="Close Citation Manager"
                  title="Close Citation Manager (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="tikz-modal-content">
                <CitationManager
                  analysis={citationAnalysis}
                  loading={citationLibraryLoading}
                  error={citationLibraryError}
                  activeDocumentPath={activeDocument?.relativePath}
                  onInsertCitation={handleInsertCitationCode}
                  onAppendBibEntry={handleAppendBibEntry}
                  onClose={() => setCitationManagerOpen(false)}
                />
              </div>
            </div>
          )}

          {panelVisible ? (
            <section className="bottom-panel" style={{ height: panelHeight }}>
              <div className="panel-resize-handle" onPointerDown={startPanelResize} />
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
                <button
                  className={activePanel === "checkAnalysis" ? "active" : ""}
                  onClick={() => openPanel("checkAnalysis")}
                >
                  <AlertCircle size={13} />
                  CHECK ANALYSIS
                  {assistantDiagnostics.length ? (
                    <span className="count-badge">{assistantDiagnostics.length}</span>
                  ) : null}
                </button>
                <button
                  className={activePanel === "structureReport" ? "active" : ""}
                  onClick={() => openPanel("structureReport")}
                >
                  <Wand size={13} />
                  STRUCTURE REPORT
                  {structureDiagnostics.length ? (
                    <span className="count-badge">{structureDiagnostics.length}</span>
                  ) : null}
                </button>
                <button
                  className={activePanel === "pdfReport" ? "active" : ""}
                  onClick={() => openPanel("pdfReport")}
                >
                  <FilePlus2 size={13} />
                  PDF COMPLIANCE
                  {pdfComplianceDiagnostics.length ? (
                    <span className="count-badge">
                      {pdfComplianceDiagnostics.length}
                    </span>
                  ) : null}
                </button>
                <div />
                <button className="panel-close" onClick={() => setPanelVisible(false)}>
                  <X size={15} />
                </button>
              </div>
              <div className="panel-content">
                <section
                  className={`panel-pane ${activePanel === "problems" ? "" : "hidden"}`}
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
                            <span>{diagnosticAccuracyLabel(primaryDiagnostic)}</span>
                          </div>
                          <div className="diagnostic-analysis-body">
                            <div>
                              <strong>{diagnosticHeadline(primaryDiagnostic)}</strong>
                              <p>
                                {primaryDiagnostic.detail ?? primaryDiagnostic.message}
                              </p>
                              {diagnosticExplicitProblem(primaryDiagnostic) ? (
                                <span className="diagnostic-explicit-problem">
                                  <strong>Problem:</strong>
                                  <code>
                                    {diagnosticExplicitProblem(primaryDiagnostic)}
                                  </code>
                                </span>
                              ) : null}
                              {primaryDiagnostic.compilerExcerpt ? (
                                <span className="diagnostic-compiler-excerpt">
                                  <strong>Compiler excerpt</strong>
                                  <code>{primaryDiagnostic.compilerExcerpt}</code>
                                </span>
                              ) : null}
                              {primaryDiagnostic.reportedLine &&
                              primaryDiagnostic.reportedLine !==
                                primaryDiagnostic.line ? (
                                <small>
                                  LaTeX stopped at line {primaryDiagnostic.reportedLine}
                                  , but source analysis traced the cause back to{" "}
                                  {diagnosticLocationLabel(primaryDiagnostic, rootFile)}
                                  .
                                </small>
                              ) : (
                                <small>
                                  The first actionable failure is at{" "}
                                  {diagnosticLocationLabel(primaryDiagnostic, rootFile)}
                                  .
                                </small>
                              )}
                            </div>
                            <div className="diagnostic-analysis-buttons">
                              <button
                                className="sidebar-mini-action"
                                onClick={() => void openDiagnostic(primaryDiagnostic)}
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
                        const location = diagnosticLocationLabel(diagnostic, rootFile);
                        const explicitProblem = diagnosticExplicitProblem(diagnostic);
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
                                {explicitProblem ? (
                                  <span className="diagnostic-explicit-problem">
                                    <strong>Problem:</strong>
                                    <code>{explicitProblem}</code>
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
                                {diagnostic.compilerExcerpt ? (
                                  <span className="diagnostic-compiler-excerpt">
                                    <strong>Compiler excerpt</strong>
                                    <code>{diagnostic.compilerExcerpt}</code>
                                  </span>
                                ) : null}
                                {diagnostic.suggestion ? (
                                  <span className="diagnostic-suggestion">
                                    <strong>How to fix:</strong> {diagnostic.suggestion}
                                  </span>
                                ) : null}
                                <span className="diagnostic-compiler-message">
                                  Compiler: {diagnostic.message}
                                </span>
                              </span>
                              <span className="diagnostic-location">{location}</span>
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
                                      void applyLatexDiagnosticFix(diagnostic, fix)
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
                    {compileResult?.output ||
                      "Compile the project to see build output."}
                  </pre>
                </section>
                {terminalStarted ? (
                  <section
                    className={`panel-pane panel-pane-terminal ${
                      activePanel === "terminal" ? "" : "hidden"
                    }`}
                  >
                    <Suspense
                      fallback={
                        <div className="panel-empty" aria-label="Loading terminal">
                          <LoaderCircle className="spin" size={16} />
                        </div>
                      }
                    >
                      <TerminalPanel
                        projectId={projectId}
                        workspacePath={projectPath}
                        active={activePanel === "terminal"}
                      />
                    </Suspense>
                  </section>
                ) : null}
                {activePanel === "checkAnalysis" ? (
                  <section className="panel-pane panel-pane-check-analysis">
                    {assistantDiagnostics.length ? (
                      <div className="check-analysis-list">
                        {(() => {
                          const grouped: Record<string, Diagnostic[]> = {};
                          for (const d of assistantDiagnostics) {
                            const source = d.source ?? "unknown";
                            if (!grouped[source]) grouped[source] = [];
                            grouped[source].push(d);
                          }
                          return Object.entries(grouped).map(([source, items]) => (
                            <div key={source} className="check-analysis-group">
                              <div className="check-analysis-group-header">
                                <span className="check-analysis-group-name">
                                  {source === "latex" ? "General" : source}
                                </span>
                                <span className="check-analysis-group-count">
                                  {items.length} issue{items.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                              {items.map((d, i) => (
                                <div
                                  key={i}
                                  className={`check-analysis-item check-analysis-item--${d.severity}`}
                                >
                                  <div className="check-analysis-item-icon">
                                    {d.severity === "error" ? "✗" : "!"}
                                  </div>
                                  <div className="check-analysis-item-body">
                                    <div className="check-analysis-item-message">
                                      {d.message}
                                    </div>
                                    {d.detail && (
                                      <div className="check-analysis-item-detail">
                                        {d.detail}
                                      </div>
                                    )}
                                    {d.suggestion && (
                                      <div className="check-analysis-item-suggestion">
                                        {d.suggestion}
                                      </div>
                                    )}
                                    {d.suggestion?.includes("fix") ||
                                    d.suggestion?.includes("Fix") ? (
                                      <div className="check-analysis-item-fix">
                                        <button
                                          className="check-analysis-apply-btn"
                                          onClick={() => {
                                            const editor = editorRef.current;
                                            if (!editor) return;
                                            editor.focus();
                                          }}
                                        >
                                          Apply fix
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ));
                        })()}
                      </div>
                    ) : (
                      <div className="check-analysis-empty">
                        <AlertCircle size={20} />
                        <span>
                          No check results yet. Open a .tex file to run automated
                          analysis.
                        </span>
                      </div>
                    )}
                  </section>
                ) : null}
                {activePanel === "structureReport" ? (
                  <section className="panel-pane panel-pane-check-analysis">
                    {structureDiagnostics.length ? (
                      <div className="check-analysis-list">
                        {(() => {
                          const groups: Record<
                            string,
                            { label: string; diagnostics: Diagnostic[] }
                          > = {};
                          for (const d of structureDiagnostics) {
                            let key = "other";
                            let label = "Other";
                            if (d.message.includes("Abstract")) {
                              key = "abstract";
                              label = "Abstract";
                            } else if (d.message.includes("Introduction")) {
                              key = "introduction";
                              label = "Introduction";
                            } else if (d.message.includes("Related Work")) {
                              key = "related";
                              label = "Related Work";
                            } else if (d.message.includes("Method")) {
                              key = "method";
                              label = "Method";
                            } else if (d.message.includes("Results")) {
                              key = "results";
                              label = "Results";
                            } else if (d.message.includes("Conclusion")) {
                              key = "conclusion";
                              label = "Conclusion";
                            }
                            if (!groups[key]) groups[key] = { label, diagnostics: [] };
                            groups[key].diagnostics.push(d);
                          }
                          return Object.entries(groups).map(([key, group]) => {
                            const passed = group.diagnostics.filter(
                              (d) =>
                                d.severity !== "error" &&
                                !d.detail?.includes("missing") &&
                                !d.detail?.includes("not found") &&
                                !d.detail?.includes("lacks") &&
                                !d.detail?.includes("too short") &&
                                !d.detail?.includes("no ") &&
                                !d.message.includes("not found"),
                            );
                            const failed = group.diagnostics.filter(
                              (d) => !passed.includes(d),
                            );
                            return (
                              <div key={key} className="check-analysis-group">
                                <div className="check-analysis-group-header">
                                  <span className="check-analysis-group-name">
                                    {group.label}
                                  </span>
                                  <span
                                    className={`check-analysis-group-count ${failed.length > 0 ? "has-issues" : "all-good"}`}
                                  >
                                    {failed.length > 0
                                      ? `${failed.length} issue${failed.length !== 1 ? "s" : ""}`
                                      : "✓ All checks passed"}
                                  </span>
                                </div>
                                {failed.map((d, i) => (
                                  <div
                                    key={i}
                                    className={`check-analysis-item check-analysis-item--warning`}
                                  >
                                    <div className="check-analysis-item-icon">!</div>
                                    <div className="check-analysis-item-body">
                                      <div className="check-analysis-item-message">
                                        {d.message}
                                      </div>
                                      {d.detail && (
                                        <div className="check-analysis-item-detail">
                                          {d.detail}
                                        </div>
                                      )}
                                      {d.suggestion && (
                                        <div className="check-analysis-item-suggestion">
                                          {d.suggestion}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {passed.length > 0 && (
                                  <div className="check-analysis-passed">
                                    {passed.map((d, i) => (
                                      <div
                                        key={i}
                                        className="check-analysis-passed-item"
                                      >
                                        <span className="check-analysis-passed-icon">
                                          ✓
                                        </span>
                                        <span>{d.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      <div className="check-analysis-empty">
                        <Wand size={20} />
                        <span>
                          No structure analysis yet. Open a .tex file to check paper
                          structure.
                        </span>
                      </div>
                    )}
                  </section>
                ) : null}
                {activePanel === "pdfReport" ? (
                  <section className="panel-pane panel-pane-check-analysis">
                    {pdfComplianceDiagnostics.length ? (
                      <div className="check-analysis-list">
                        {(() => {
                          const groups: Record<
                            string,
                            { label: string; diagnostics: Diagnostic[] }
                          > = {};
                          for (const d of pdfComplianceDiagnostics) {
                            let key = "other";
                            let label = "Other";
                            if (
                              d.message.includes("page") ||
                              d.message.includes("Page")
                            ) {
                              key = "pages";
                              label = "Page Count";
                            } else if (
                              d.message.includes("Figure") ||
                              d.message.includes("figure")
                            ) {
                              key = "figures";
                              label = "Figures";
                            } else if (
                              d.message.includes("Citation") ||
                              d.message.includes("citation") ||
                              d.message.includes("cite") ||
                              d.message.includes("Section.*citation")
                            ) {
                              key = "citations";
                              label = "Citations";
                            } else if (
                              d.message.includes("Type 3") ||
                              d.message.includes("font")
                            ) {
                              key = "fonts";
                              label = "Fonts";
                            } else if (d.message.includes("Abstract")) {
                              key = "abstract";
                              label = "Abstract";
                            }
                            if (!groups[key]) groups[key] = { label, diagnostics: [] };
                            groups[key].diagnostics.push(d);
                          }
                          return Object.entries(groups).map(([key, group]) => {
                            const passed = group.diagnostics.filter(
                              (d) =>
                                d.severity !== "error" &&
                                !d.detail?.includes("exceed") &&
                                !d.detail?.includes("never") &&
                                !d.detail?.includes("no ") &&
                                !d.detail?.includes("missing") &&
                                !d.message.includes("exceed") &&
                                !d.message.includes("never"),
                            );
                            const failed = group.diagnostics.filter(
                              (d) => !passed.includes(d),
                            );
                            return (
                              <div key={key} className="check-analysis-group">
                                <div className="check-analysis-group-header">
                                  <span className="check-analysis-group-name">
                                    {group.label}
                                  </span>
                                  <span
                                    className={`check-analysis-group-count ${failed.length > 0 ? "has-issues" : "all-good"}`}
                                  >
                                    {failed.length > 0
                                      ? `${failed.length} issue${failed.length !== 1 ? "s" : ""}`
                                      : "✓ Compliant"}
                                  </span>
                                </div>
                                {failed.map((d, i) => (
                                  <div
                                    key={i}
                                    className={`check-analysis-item ${d.severity === "error" ? "check-analysis-item--error" : "check-analysis-item--warning"}`}
                                  >
                                    <div className="check-analysis-item-icon">
                                      {d.severity === "error" ? "✗" : "!"}
                                    </div>
                                    <div className="check-analysis-item-body">
                                      <div className="check-analysis-item-message">
                                        {d.message}
                                      </div>
                                      {d.detail && (
                                        <div className="check-analysis-item-detail">
                                          {d.detail}
                                        </div>
                                      )}
                                      {d.suggestion && (
                                        <div className="check-analysis-item-suggestion">
                                          {d.suggestion}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {passed.length > 0 && (
                                  <div className="check-analysis-passed">
                                    {passed.map((d, i) => (
                                      <div
                                        key={i}
                                        className="check-analysis-passed-item"
                                      >
                                        <span className="check-analysis-passed-icon">
                                          ✓
                                        </span>
                                        <span>{d.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      <div className="check-analysis-empty">
                        <FilePlus2 size={20} />
                        <span>
                          No PDF compliance report yet. Compile your project to generate
                          a compliance report.
                        </span>
                      </div>
                    )}
                  </section>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      </div>

      {updateBannerVisible && availableUpdateVersion ? (
        <section className="update-banner" role="status" aria-live="polite">
          <div className="update-banner-main">
            <Download size={17} />
            <span>
              <strong>LatexDo {availableUpdateVersion} is available</strong>
              <small>
                {updateProgressActive && updateProgressLabel
                  ? updateProgressLabel
                  : updatePublishedLabel
                    ? `Published ${updatePublishedLabel}${
                        updateLocationLabel ? ` at ${updateLocationLabel}` : ""
                      }.`
                    : updateLocationLabel
                      ? `Available at ${updateLocationLabel}.`
                      : "Update now or open downloads from Settings."}
              </small>
              <small className="update-build-meta">{updateBuildSummary}</small>
              {updateProgressActive ? (
                <div
                  className={`update-progress-bar ${
                    updateProgressPercent === null ? "is-indeterminate" : ""
                  }`}
                  role="progressbar"
                  aria-label="Update download progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    updateProgressPercent === null
                      ? undefined
                      : Math.round(updateProgressPercent)
                  }
                >
                  <span
                    style={
                      updateProgressPercent === null
                        ? undefined
                        : { width: `${updateProgressPercent}%` }
                    }
                  />
                </div>
              ) : null}
            </span>
          </div>
          <div className="update-banner-actions">
            <button
              type="button"
              onClick={() => void updateNow()}
              disabled={updatingNow}
            >
              {updatingNow ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <Download size={13} />
              )}
              {updatingNow
                ? "Updating…"
                : updateInfo?.automaticInstallAvailable === false
                  ? "Open update"
                  : "Update now"}
            </button>
            <button
              type="button"
              className="icon-only"
              onClick={() => setDismissedUpdateVersion(availableUpdateVersion)}
              aria-label="Dismiss update notice"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </section>
      ) : null}

      <footer className="statusbar">
        <div>
          <span className="status-brand">
            <AppIcon className="status-brand-icon" />
            LatexDo
          </span>
          {updateInfo?.updateAvailable ? (
            <button
              onClick={() => void updateNow()}
              disabled={updatingNow}
              title={updateBuildSummary}
            >
              {updatingNow ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <Download size={13} />
              )}
              {updatingNow
                ? "Updating"
                : updateInfo.automaticInstallAvailable === false
                  ? `Open ${updateInfo.latestVersion}`
                  : `Update ${updateInfo.latestVersion}`}
            </button>
          ) : null}
          <button onClick={() => openPanel("problems")}>
            <CircleAlert size={13} /> {errors}
          </button>
          <button onClick={() => openPanel("problems")}>
            <AlertCircle size={13} /> {warnings}
          </button>
          {compiling ? (
            <>
              <span className="status-compile">
                <LoaderCircle size={13} className="spin" />
                {compileJobCount} compile job{compileJobCount === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="status-cancel-compile"
                onClick={() => void cancelCompile()}
                title="Cancel compile"
                aria-label="Cancel compile"
              >
                <X size={13} />
                Cancel
              </button>
            </>
          ) : null}
          {collaborationState.enabled ? (
            <button
              type="button"
              onClick={() => void createCollaborationLink()}
              title={
                activeCollaborators.length
                  ? activeCollaborators
                      .map((collaborator) =>
                        collaborator.currentFile
                          ? `${collaborator.name}: ${collaborator.currentFile}`
                          : collaborator.name,
                      )
                      .join("\n")
                  : "Collaboration link active"
              }
            >
              <User size={13} />
              {Math.max(collaboratorCount, 1)} live
            </button>
          ) : null}
          {activeTextDocument ? (
            <>
              <button
                type="button"
                onClick={toggleBookmarkAtCurrentLine}
                title="Toggle bookmark at cursor"
              >
                <Bookmark size={13} /> {activeBookmarkLines.length}
              </button>
              <button
                type="button"
                onClick={() => jumpToBookmark("previous")}
                disabled={!activeBookmarkLines.length}
                title="Previous bookmark"
              >
                <ArrowLeftToLine size={13} />
              </button>
              <button
                type="button"
                onClick={() => jumpToBookmark("next")}
                disabled={!activeBookmarkLines.length}
                title="Next bookmark"
              >
                <ArrowRightToLine size={13} />
              </button>
            </>
          ) : null}
          <span className="status-message">{statusMessage}</span>
        </div>
        <div>
          {activeDocumentIsAssetPreview && activeDocument ? (
            <>
              <span>{assetPreviewTypeLabel(activeDocument.assetMimeType)}</span>
              <span>{activeDocument.assetMimeType}</span>
              {formatAssetSize(activeDocument.assetSizeBytes) ? (
                <span>{formatAssetSize(activeDocument.assetSizeBytes)}</span>
              ) : null}
            </>
          ) : (
            <>
              <span>
                {activeTextDocument
                  ? activeDocumentIsAsymptote
                    ? "Asymptote"
                    : activeDocumentIsLatex
                      ? "LaTeX"
                      : "Plain Text"
                  : "Plain Text"}
              </span>
              <span>UTF-8</span>
              <span>Spaces: 2</span>
            </>
          )}
        </div>
      </footer>

      <ShareProjectDialog
        open={shareDialogOpen}
        state={collaborationState}
        copied={collaborationCopied}
        busy={collaborationBusy}
        joinToken={joinTokenDraft}
        joining={joinCollaborationBusy}
        joinError={joinCollaborationError}
        displayName={collaborationDisplayName}
        permissions={collaborationPermissions}
        isAdmin={isProjectAdmin}
        currentUserRole={currentUserRole}
        onCopy={(text) => {
          void (async () => {
            await copyToClipboard(text);
            setCollaborationCopied(true);
            window.setTimeout(() => setCollaborationCopied(false), 1800);
            setStatusMessage(
              text === collaborationState.shareUrl
                ? "Collaboration link copied"
                : "Collaboration token copied",
            );
          })();
        }}
        onJoinTokenChange={(value) => {
          setJoinTokenDraft(value);
          if (joinCollaborationError) {
            setJoinCollaborationError("");
          }
        }}
        onDisplayNameChange={handleCollaborationDisplayNameChange}
        onJoin={() => void joinCollaborationFromDialog()}
        onRegenerate={() => void regenerateCollaborationLink()}
        onClose={() => setShareDialogOpen(false)}
        onUpdatePermission={handleUpdatePermission}
        onRemoveCollaborator={handleRemoveCollaborator}
        onRefreshPermissions={async () => {
          const currentProject = projectIdRef.current;
          if (currentProject) {
            await loadCollaborationPermissions(currentProject);
          }
        }}
      />

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
                Add it inside <strong>{projectName}</strong>. Nested paths such as{" "}
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
              <button type="submit" className="dialog-submit" disabled={creating}>
                {creating ? "Creating…" : `Create ${createDialog}`}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="modal-backdrop settings-backdrop"
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
                <p>
                  One place for editor, compiler, spell checker, grammar, and updates.
                </p>
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

            <div className="settings-tabs">
              <button
                className={`settings-tab ${settingsTab === "editor" ? "active" : ""}`}
                onClick={() => setSettingsTab("editor")}
              >
                Editor
              </button>
              <button
                className={`settings-tab ${settingsTab === "ai" ? "active" : ""}`}
                onClick={() => setSettingsTab("ai")}
              >
                AI Assistant
              </button>
              <button
                className={`settings-tab ${settingsTab === "extensions" ? "active" : ""}`}
                onClick={() => setSettingsTab("extensions")}
              >
                Extensions
              </button>
              <button
                className={`settings-tab ${settingsTab === "language" ? "active" : ""}`}
                onClick={() => setSettingsTab("language")}
              >
                Language
              </button>
              <button
                className={`settings-tab ${settingsTab === "conference" ? "active" : ""}`}
                onClick={() => setSettingsTab("conference")}
              >
                Conference Checker
              </button>
              {extensionToolInstallation.projectBibliography ? (
                <button
                  className={`settings-tab ${settingsTab === "citation" ? "active" : ""}`}
                  onClick={() => setSettingsTab("citation")}
                >
                  Citation Assistant
                </button>
              ) : null}
              <button
                className={`settings-tab ${settingsTab === "structure" ? "active" : ""}`}
                onClick={() => setSettingsTab("structure")}
              >
                Structure Assistant
              </button>
              <button
                className={`settings-tab ${settingsTab === "reproducibility" ? "active" : ""}`}
                onClick={() => setSettingsTab("reproducibility")}
              >
                Reproducibility
              </button>
              <button
                className={`settings-tab ${settingsTab === "acronym" ? "active" : ""}`}
                onClick={() => setSettingsTab("acronym")}
              >
                Acronym Manager
              </button>
              <button
                className={`settings-tab ${settingsTab === "doctor" ? "active" : ""}`}
                onClick={() => setSettingsTab("doctor")}
              >
                Error Doctor
              </button>
              {extensionToolInstallation.tikzConverter ? (
                <button
                  className={`settings-tab ${settingsTab === "tikz" ? "active" : ""}`}
                  onClick={() => setSettingsTab("tikz")}
                >
                  TikZ Converter
                </button>
              ) : null}
              {extensionToolInstallation.notationManager ? (
                <button
                  className={`settings-tab ${settingsTab === "notation" ? "active" : ""}`}
                  onClick={() => setSettingsTab("notation")}
                >
                  Notation
                </button>
              ) : null}
              <button
                className={`settings-tab ${settingsTab === "pdf" ? "active" : ""}`}
                onClick={() => setSettingsTab("pdf")}
              >
                PDF Compliance
              </button>
              <button
                className={`settings-tab ${settingsTab === "application" ? "active" : ""}`}
                onClick={() => setSettingsTab("application")}
              >
                Updates
              </button>
            </div>

            <div className="settings-list">
              {settingsTab === "ai" ? (
                <div className="ai-settings-panel">
                  <div className="settings-section-heading">AI Assistant</div>
                  <p className="settings-hint">
                    {aiConfig.provider === "off"
                      ? "The AI assistant is turned off."
                      : `Provider: ${aiConfig.provider}${
                          aiConfig.provider === "local"
                            ? ` · ${aiConfig.modelId}${
                                aiConfig.modelDownloaded
                                  ? " (ready)"
                                  : " (not downloaded)"
                              }`
                            : aiConfig.provider === "cloud"
                              ? ` · ${aiConfig.cloud.vendor} / ${aiConfig.cloud.model}${
                                  aiConfig.cloud.apiKey ? "" : " (no API key)"
                                }`
                              : ` · ${aiConfig.ollamaModel}`
                        }`}
                  </p>
                  <p className="settings-hint">
                    Setup is optional — you can skip it and configure the assistant here
                    at any time, or re-run the guided setup to finish or change your
                    choices.
                  </p>
                  <div className="ai-settings-actions">
                    <button
                      className="ai-wizard-primary"
                      onClick={() => {
                        setSettingsOpen(false);
                        setAiWizardOpen(true);
                      }}
                    >
                      {aiConfig.setupComplete
                        ? "Re-run setup wizard"
                        : "Complete AI setup"}
                    </button>
                    {aiConfig.provider === "off" ? (
                      <button
                        className="ai-wizard-ghost"
                        onClick={() =>
                          setAiConfig((c) => ({
                            ...c,
                            provider: aiIsDesktop ? "local" : "cloud",
                          }))
                        }
                      >
                        Turn AI on
                      </button>
                    ) : (
                      <button
                        className="ai-wizard-ghost"
                        onClick={() => setAiConfig((c) => ({ ...c, provider: "off" }))}
                      >
                        Turn AI off
                      </button>
                    )}
                  </div>
                  <div className="settings-section-heading">Cloud provider</div>
                  <p className="settings-hint">
                    Connect Claude, ChatGPT, Gemini, Groq, DeepSeek, Mistral,
                    OpenRouter, or any OpenAI-compatible endpoint with your own key.
                    {aiConfig.provider !== "cloud" &&
                      " Switch to cloud below to use it as your active provider."}
                  </p>
                  <CloudProviderForm
                    cloud={aiConfig.cloud}
                    onChange={(cloud) => setAiConfig((c) => ({ ...c, cloud }))}
                    onOpenExternal={(url) =>
                      (
                        window as {
                          latexdo?: { openExternal?: (u: string) => void };
                        }
                      ).latexdo?.openExternal?.(url) ??
                      window.open(url, "_blank", "noopener")
                    }
                  />
                  {aiConfig.provider !== "cloud" && aiConfig.cloud.apiKey && (
                    <button
                      className="ai-wizard-ghost"
                      onClick={() => setAiConfig((c) => ({ ...c, provider: "cloud" }))}
                    >
                      Use this cloud provider
                    </button>
                  )}

                  <div className="settings-section-heading">Autonomy</div>
                  <p className="settings-hint">
                    Choose how much the agent does on its own. You can also flip this
                    any time from the toggle at the top of the AI panel.
                  </p>
                  <label className="ai-autonomy-option">
                    <input
                      type="radio"
                      name="ai-autonomy"
                      checked={!aiConfig.autoApproveEdits}
                      onChange={() =>
                        setAiConfig((c) => ({ ...c, autoApproveEdits: false }))
                      }
                    />
                    <span>
                      <strong>Ask me at each step</strong> — the agent pauses before
                      every change and waits for you to approve or decline it.
                    </span>
                  </label>
                  <label className="ai-autonomy-option">
                    <input
                      type="radio"
                      name="ai-autonomy"
                      checked={aiConfig.autoApproveEdits}
                      onChange={() =>
                        setAiConfig((c) => ({ ...c, autoApproveEdits: true }))
                      }
                    />
                    <span>
                      <strong>Fully autonomous</strong> — the agent reads, edits, and
                      compiles on its own without asking. All edits stay undoable.
                    </span>
                  </label>
                  {!aiIsDesktop && (
                    <p className="settings-hint">
                      This is the browser build — local models need the desktop app.
                      Choose a cloud provider in the wizard to use AI here.
                    </p>
                  )}
                </div>
              ) : null}
              {settingsTab === "editor" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Editor and compiler</strong>
                    <span>Configure how LaTeX source is edited and built.</span>
                  </div>

                  <div className="settings-row settings-row-stack">
                    <span>
                      <strong>Theme</strong>
                      <small>
                        Readable high-contrast palettes for the whole app and editor.
                      </small>
                    </span>
                    <div
                      className="theme-grid"
                      role="radiogroup"
                      aria-label="Application theme"
                    >
                      {colorThemeOptions.map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          className={`theme-choice ${settings.colorTheme === theme.id ? "active" : ""}`}
                          onClick={() =>
                            setSettings((current) => ({
                              ...current,
                              colorTheme: theme.id,
                            }))
                          }
                          role="radio"
                          aria-checked={settings.colorTheme === theme.id}
                        >
                          <span className="theme-choice-top">
                            <span>
                              <strong>{theme.name}</strong>
                              <small>{theme.description}</small>
                            </span>
                            <span className="theme-swatches" aria-hidden="true">
                              {theme.swatches.map((color) => (
                                <span key={color} style={{ background: color }} />
                              ))}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

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
                      <strong>Inline Git blame</strong>
                      <small>
                        Show who last changed the current line, with commit details on
                        hover.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.inlineBlame}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          inlineBlame: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Show raw LaTeX source</strong>
                      <small>
                        When off, LaTeX commands are faded so only document text is
                        visible.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.showRawLatex}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          showRawLatex: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <div className="settings-section-heading">
                    <strong>Project tree</strong>
                    <span>
                      Control which folders are scanned when opening projects.
                    </span>
                  </div>

                  <div className="settings-row settings-row-stack">
                    <span>
                      <strong>Ignored folders and files</strong>
                      <small>
                        One name per line. Names apply anywhere in the project tree.
                      </small>
                    </span>
                    <textarea
                      className="settings-textarea project-tree-ignore-input"
                      value={settings.projectTreeIgnoredNames.join("\n")}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          projectTreeIgnoredNames: parseProjectTreeIgnoredNamesText(
                            event.target.value,
                          ),
                        }))
                      }
                      spellCheck={false}
                      aria-label="Ignored project tree names"
                    />
                  </div>

                  <div className="settings-row settings-row-stack">
                    <span>
                      <strong>Tree limits</strong>
                      <small>
                        Caps prevent huge folders from blocking project listing.
                      </small>
                    </span>
                    <div className="project-tree-limit-grid">
                      <label>
                        <span>Max depth</span>
                        <input
                          type="number"
                          className="settings-number-input"
                          min={minProjectTreeDepth}
                          max={maxProjectTreeDepth}
                          value={settings.projectTreeMaxDepth}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              projectTreeMaxDepth: boundedInteger(
                                Number(event.target.value),
                                defaultSettings.projectTreeMaxDepth,
                                minProjectTreeDepth,
                                maxProjectTreeDepth,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Max entries</span>
                        <input
                          type="number"
                          className="settings-number-input settings-wide-number-input"
                          min={minProjectTreeEntries}
                          max={maxProjectTreeEntries}
                          step={100}
                          value={settings.projectTreeMaxEntries}
                          onChange={(event) =>
                            setSettings((current) => ({
                              ...current,
                              projectTreeMaxEntries: boundedInteger(
                                Number(event.target.value),
                                defaultSettings.projectTreeMaxEntries,
                                minProjectTreeEntries,
                                maxProjectTreeEntries,
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                </>
              ) : null}

              {settingsTab === "extensions" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Extension Store</strong>
                  </div>

                  <div className="extension-store-toolbar">
                    <label className="extension-store-search">
                      <Search size={14} />
                      <input
                        type="search"
                        value={extensionQuery}
                        onChange={(event) => setExtensionQuery(event.target.value)}
                        placeholder="Search extensions"
                        spellCheck={false}
                      />
                    </label>
                    <select
                      value={extensionCategoryFilter}
                      onChange={(event) =>
                        setExtensionCategoryFilter(
                          event.target.value as ExtensionCategory | "all",
                        )
                      }
                      aria-label="Filter extensions by category"
                    >
                      <option value="all">All categories</option>
                      {extensionCategories.map((category) => (
                        <option key={category} value={category}>
                          {categoryLabel(category)}
                        </option>
                      ))}
                    </select>
                    <div className="extension-store-actions">
                      <button
                        type="button"
                        className="dialog-cancel"
                        onClick={() => void refreshExtensionCatalog()}
                        disabled={extensionCatalogLoading}
                      >
                        <RefreshCw
                          size={13}
                          className={extensionCatalogLoading ? "spin" : ""}
                        />
                        {extensionCatalogLoading ? "Refreshing" : "Refresh"}
                      </button>
                      <button
                        type="button"
                        className="dialog-submit"
                        onClick={() =>
                          void window.latexdo.openExternalUrl(extensionStoreSiteUrl)
                        }
                      >
                        <ExternalLink size={13} />
                        Open store
                      </button>
                      <button
                        type="button"
                        className="dialog-cancel"
                        onClick={() =>
                          void window.latexdo.openExternalUrl(
                            new URL("builder/", extensionStoreSiteUrl).toString(),
                          )
                        }
                      >
                        <Plus size={13} />
                        Build extension
                      </button>
                    </div>
                  </div>

                  <div className="extension-store-status">
                    <span>
                      <strong>{installedExtensions.length}</strong> installed
                    </span>
                    <span>
                      <strong>{extensionCatalog.extensions.length}</strong> available
                    </span>
                    <span>
                      {extensionCatalogSource === "remote"
                        ? "Live catalog"
                        : "Bundled catalog"}
                    </span>
                    <span>
                      Updated{" "}
                      {new Date(extensionCatalog.updatedAt).toLocaleDateString(
                        undefined,
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </span>
                  </div>

                  {extensionCatalogError ? (
                    <div className="extension-store-alert">
                      <AlertCircle size={14} />
                      <span>{extensionCatalogError}</span>
                    </div>
                  ) : null}

                  <div className="extension-store-grid">
                    {filteredExtensions.length ? (
                      filteredExtensions.map((extension) => {
                        const installed = installedExtensionIdSet.has(extension.id);
                        const summary = contributionSummary(extension);
                        return (
                          <article
                            key={extension.id}
                            className={`extension-card ${installed ? "installed" : ""}`}
                          >
                            <div className="extension-card-top">
                              <div className="extension-icon">
                                <Puzzle size={18} />
                              </div>
                              <div>
                                <strong>{extension.name}</strong>
                                <small>
                                  {extension.author} · v{extension.version}
                                </small>
                              </div>
                              <span>{categoryLabel(extension.category)}</span>
                            </div>
                            <p>{extension.description}</p>
                            <div className="extension-tags">
                              {extension.tags.map((tag) => (
                                <span key={`${extension.id}:${tag}`}>{tag}</span>
                              ))}
                            </div>
                            <div className="extension-summary">
                              {summary.length ? summary.join(" · ") : "Manifest pack"}
                            </div>
                            <div className="extension-card-actions">
                              {extension.homepage ? (
                                <button
                                  type="button"
                                  className="dialog-cancel"
                                  onClick={() =>
                                    void window.latexdo.openExternalUrl(
                                      extension.homepage!,
                                    )
                                  }
                                >
                                  <ExternalLink size={13} />
                                  Details
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={
                                  installed ? "dialog-cancel" : "dialog-submit"
                                }
                                onClick={() =>
                                  installed
                                    ? uninstallExtension(extension)
                                    : installExtension(extension)
                                }
                              >
                                {installed ? <X size={13} /> : <Download size={13} />}
                                {installed ? "Uninstall" : "Install"}
                              </button>
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="extension-store-empty">
                        <Puzzle size={18} />
                        <span>No extensions match the current filter.</span>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {settingsTab === "language" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Language assistance</strong>
                    <span>Spelling, custom vocabulary, grammar, and style.</span>
                  </div>

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
                        Language selection is controlled by the system spell checker on
                        macOS.
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
                              <label
                                key={language}
                                className="spellchecker-language-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    spellCheckerSettings?.languages.includes(
                                      language,
                                    ) ?? false
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
                        Add project-specific terms, package names, and citation keys so
                        they stop showing as misspellings.
                      </small>
                    </span>
                    <form
                      className="spellchecker-word-form"
                      onSubmit={addSpellCheckerWord}
                    >
                      <input
                        type="text"
                        value={spellCheckerWordDraft}
                        onChange={(event) =>
                          setSpellCheckerWordDraft(event.target.value)
                        }
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
                        Run LanguageTool-compatible proofreading on natural-language
                        text while ignoring LaTeX commands, math, and citations.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={proofreadingSettings?.enabled ?? true}
                      onChange={(event) => {
                        if (!proofreadingSettings) return;
                        void saveProofreadingSettings(
                          { ...proofreadingSettings, enabled: event.target.checked },
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
                        Use the public LanguageTool API by default, or point LatexDo to
                        your own compatible server.
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
                            if (!proofreadingSettings) return;
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
                            !activeTextDocument ||
                            !supportsProofreading(activeTextDocument.name)
                          }
                        >
                          {proofreadingLoading ? "Checking..." : "Proofread now"}
                        </button>
                      </div>
                      <div className="spellchecker-note compact">
                        {!proofreadingSettings?.enabled
                          ? "Proofreading is disabled. Enable grammar and style checking to run suggestions."
                          : proofreadingResult?.error
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
                </>
              ) : null}

              {settingsTab === "conference" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Conference / Journal Submission Checker</strong>
                    <span>
                      Validate your manuscript against conference and journal submission
                      guidelines.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable conference checker</strong>
                      <small>Run submission-format checks on your LaTeX source.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.conferenceCheckerEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          conferenceCheckerEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Select template</strong>
                      <small>Choose the target venue template.</small>
                    </span>
                    <select
                      value={
                        settings.conferenceTemplate === "custom"
                          ? "custom"
                          : settings.conferenceTemplate
                      }
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          conferenceTemplate: event.target.value,
                        }))
                      }
                    >
                      <option value="ieee">IEEE</option>
                      <option value="acm">ACM</option>
                      <option value="springer">Springer</option>
                      <option value="elsevier">Elsevier</option>
                      <option value="neurips">NeurIPS</option>
                      <option value="cvpr">CVPR</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>

                  {settings.conferenceTemplate === "custom" ? (
                    <div className="settings-row settings-row-stack">
                      <span>
                        <strong>Custom template</strong>
                        <small>Describe your template or paste document class.</small>
                      </span>
                      <input
                        type="text"
                        value={settings.conferenceChecker_customTemplate}
                        onChange={(event) =>
                          setSettings((c) => ({
                            ...c,
                            conferenceChecker_customTemplate: event.target.value,
                          }))
                        }
                        placeholder="e.g., \\documentclass[twocolumn]{article}"
                      />
                    </div>
                  ) : null}

                  <div
                    className="settings-section-heading"
                    style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}
                  >
                    <strong>Checks to perform</strong>
                  </div>

                  {[
                    ["checkMargins", "Margins", "Check for incorrect margin settings."],
                    [
                      "checkFontSize",
                      "Font size",
                      "Warn if font size does not match template requirements.",
                    ],
                    [
                      "checkAbstractLength",
                      "Abstract length",
                      "Flag abstracts that exceed the word limit.",
                    ],
                    [
                      "checkKeywords",
                      "Missing keywords",
                      "Ensure the document has keywords defined.",
                    ],
                    [
                      "checkFigureReferences",
                      "Figure references",
                      "Find figures that are not referenced in the text.",
                    ],
                    [
                      "checkTableReferences",
                      "Table references",
                      "Find tables that are not referenced in the text.",
                    ],
                    [
                      "checkBibliographyStyle",
                      "Bibliography style",
                      "Verify bibliography style matches the template.",
                    ],
                    [
                      "checkPageLimit",
                      "Page limit",
                      "Rough check for going over the page limit.",
                    ],
                    [
                      "checkAuthorInfo",
                      "Author information",
                      "Check for missing author name, affiliation, or email.",
                    ],
                    [
                      "checkAnonymousReview",
                      "Anonymous review",
                      "Detect potential author-identifying information for double-blind submissions.",
                    ],
                    [
                      "checkFigureResolution",
                      "Figure resolution",
                      "Check included image formats and warn about low-resolution formats.",
                    ],
                    [
                      "checkEmbeddedFonts",
                      "Embedded fonts",
                      "Basic check for font usage that may cause PDF issues.",
                    ],
                    [
                      "checkCompiler",
                      "Compiler selection",
                      "Check if selected compiler is appropriate for used packages.",
                    ],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={getSetting(key, settings)}
                        onChange={(event) =>
                          setSettings((c) => ({ ...c, [key]: event.target.checked }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "citation" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Smart Citation Assistant</strong>
                    <span>
                      Detect missing citations, unused references, broken links, and
                      more.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable citation assistant</strong>
                      <small>Run citation-related checks on your LaTeX source.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.citationAssistantEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          citationAssistantEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  {[
                    [
                      "detectMissingCitations",
                      "Detect missing citations",
                      "Find paragraphs that make technical claims but have no citations.",
                    ],
                    [
                      "detectUnusedEntries",
                      "Detect unused entries",
                      "Check for BibTeX entries that are never cited.",
                    ],
                    [
                      "detectDuplicateReferences",
                      "Detect duplicate references",
                      "Find the same paper cited under different keys.",
                    ],
                    [
                      "detectBrokenLinks",
                      "Detect broken links",
                      "Check for malformed DOI, arXiv, and URL links.",
                    ],
                    [
                      "suggestCitationKeys",
                      "Suggest citation keys",
                      "Auto-suggest citations for sentences with factual claims.",
                    ],
                    [
                      "importMetadataSources",
                      "Import from metadata sources",
                      "Enable DOI/arXiv metadata import.",
                    ],
                    [
                      "warnOldCitations",
                      "Warn about old citations",
                      "Flag citations older than 5 years and suggest newer surveys.",
                    ],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={getSetting(key, settings)}
                        onChange={(event) =>
                          setSettings((c) => ({ ...c, [key]: event.target.checked }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "structure" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Research Structure Assistant</strong>
                    <span>
                      Check whether your paper's structure meets academic writing
                      standards.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable structure assistant</strong>
                      <small>Run structure quality checks on your LaTeX source.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.structureAssistantEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          structureAssistantEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  {[
                    [
                      "checkAbstractStructure",
                      "Abstract structure",
                      "Check if abstract includes problem, method, result, and contribution.",
                    ],
                    [
                      "checkIntroductionStructure",
                      "Introduction structure",
                      "Check if introduction has motivation, gap, and contribution.",
                    ],
                    [
                      "checkRelatedWorkLength",
                      "Related work length",
                      "Warn if the related work section is too short.",
                    ],
                    [
                      "checkMethodReproducibility",
                      "Method reproducibility",
                      "Check for reproducibility details in the method section.",
                    ],
                    [
                      "checkResultsDiscussion",
                      "Results discussion",
                      "Ensure results are accompanied by discussion and analysis.",
                    ],
                    [
                      "checkConclusionClaims",
                      "Conclusion claims",
                      "Warn if conclusion introduces new claims not supported earlier.",
                    ],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={getSetting(key, settings)}
                        onChange={(event) =>
                          setSettings((c) => ({ ...c, [key]: event.target.checked }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "reproducibility" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Reproducibility Checklist</strong>
                    <span>
                      Check that your paper includes all information needed for
                      reproducibility.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable reproducibility checks</strong>
                      <small>
                        Run checks for code, data, and experiment reproducibility
                        details.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.reproducibilityEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          reproducibilityEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  {[
                    [
                      "checkCodeLink",
                      "Code availability",
                      "Ensure a link to source code is provided (e.g., GitHub, Zenodo).",
                    ],
                    [
                      "checkDatasetLink",
                      "Dataset availability",
                      "Check that datasets are linked or their availability is mentioned.",
                    ],
                    [
                      "checkLicenseMentioned",
                      "License information",
                      "Verify the license for code/data is stated.",
                    ],
                    [
                      "checkHyperparameters",
                      "Hyperparameters",
                      "Confirm hyperparameters are listed for ML experiments.",
                    ],
                    [
                      "checkHardwareDetails",
                      "Hardware details",
                      "Check that GPU/CPU and computing resources are described.",
                    ],
                    [
                      "checkRandomSeeds",
                      "Random seeds",
                      "Ensure random seeds are mentioned for reproducibility.",
                    ],
                    [
                      "checkEvaluationMetrics",
                      "Evaluation metrics",
                      "Check that metrics are defined and computation is described.",
                    ],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={getSetting(key, settings)}
                        onChange={(event) =>
                          setSettings((c) => ({ ...c, [key]: event.target.checked }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "acronym" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Acronym & Glossary Manager</strong>
                    <span>
                      Automatically detect acronym definitions, duplicates, and usage
                      issues.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable acronym manager</strong>
                      <small>
                        Run acronym consistency checks on your LaTeX source.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.acronymManagerEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          acronymManagerEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  {[
                    [
                      "checkUndefinedAcronym",
                      "Undefined acronyms",
                      "Warn when an acronym is used without prior definition.",
                    ],
                    [
                      "checkDuplicateDefinition",
                      "Duplicate definitions",
                      "Warn if the same acronym is defined multiple times.",
                    ],
                    [
                      "checkUnusedAcronym",
                      "Unused acronyms",
                      "Warn if an acronym is defined but never used again.",
                    ],
                    [
                      "checkConflictingDefinitions",
                      "Conflicting definitions",
                      "Warn if different full forms map to the same acronym.",
                    ],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={getSetting(key, settings)}
                        onChange={(event) =>
                          setSettings((c) => ({ ...c, [key]: event.target.checked }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "doctor" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>LaTeX Error Doctor</strong>
                    <span>
                      Smart error explanations with one-click fix suggestions.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable Error Doctor</strong>
                      <small>
                        Analyze compile output and provide intelligent error
                        explanations.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.errorDoctorEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          errorDoctorEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  {[
                    [
                      "explainErrors",
                      "Explain errors",
                      "Show human-readable explanations for LaTeX errors.",
                    ],
                    [
                      "suggestFixes",
                      "Suggest fixes",
                      "Provide actionable fix suggestions for common errors.",
                    ],
                    [
                      "autoFixCommon",
                      "Auto-fix common errors",
                      "Automatically apply one-click fixes for simple errors (e.g., underscore escaping).",
                    ],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={getSetting(key, settings)}
                        onChange={(event) =>
                          setSettings((c) => ({ ...c, [key]: event.target.checked }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "tikz" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Figure → TikZ Converter</strong>
                    <span>
                      Upload images and automatically generate editable TikZ code.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable TikZ converter</strong>
                      <small>
                        Show the Figure → TikZ converter button in the activity bar.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.tikzConverterEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          tikzConverterEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Auto-open on image copy</strong>
                      <small>
                        Automatically open converter when an image is detected in
                        clipboard.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.tikzConverterAutoOpen}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          tikzConverterAutoOpen: event.target.checked,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}

              {settingsTab === "notation" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Notation Manager</strong>
                    <span>
                      Detect, define, and manage mathematical notation in your LaTeX
                      documents.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable notation manager</strong>
                      <small>
                        Show the Notation Manager button in the activity bar.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.notationManagerEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          notationManagerEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Detect notation</strong>
                      <small>
                        Scan documents for mathematical symbols and notation.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.detectNotation}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          detectNotation: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Detect notation conflicts</strong>
                      <small>
                        Flag symbols that are visually or semantically similar.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.detectNotationConflicts}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          detectNotationConflicts: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Detect undefined notation</strong>
                      <small>
                        Warn when a symbol is used without a preceding definition.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.detectUndefinedNotation}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          detectUndefinedNotation: event.target.checked,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}

              {settingsTab === "pdf" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>PDF Compliance Report</strong>
                    <span>
                      Check compiled PDF against conference guidelines and best
                      practices.
                    </span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable PDF compliance checks</strong>
                      <small>Run compliance checks after each compilation.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.pdfComplianceEnabled}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          pdfComplianceEnabled: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <div className="settings-section-subheading">Page count</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check page count</strong>
                      <small>Warn if the PDF exceeds the page limit.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.checkPageCount}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          checkPageCount: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Maximum pages</strong>
                      <small>Conference page limit.</small>
                    </span>
                    <input
                      type="number"
                      className="settings-number-input"
                      min={1}
                      max={100}
                      value={settings.maxPages}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          maxPages: parseInt(event.target.value, 10) || 8,
                        }))
                      }
                    />
                  </label>

                  <div className="settings-section-subheading">Figures</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check unreferenced figures</strong>
                      <small>Detect figures that have no \\ref{} in text.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.checkUnreferencedFigures}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          checkUnreferencedFigures: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <div className="settings-section-subheading">Citations</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check uncited citations</strong>
                      <small>Detect bibliography entries never cited in text.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.checkUncitedCitations}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          checkUncitedCitations: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check sections with no citations</strong>
                      <small>Flag sections that lack any citations.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.checkSectionsWithNoCitations}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          checkSectionsWithNoCitations: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <div className="settings-section-subheading">Fonts</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check for Type 3 fonts</strong>
                      <small>Warn if the PDF uses bitmap fonts.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.checkType3Fonts}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          checkType3Fonts: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <div className="settings-section-subheading">Abstract</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check abstract word count</strong>
                      <small>Warn if abstract exceeds the recommended limit.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.checkAbstractWordCount}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          checkAbstractWordCount: event.target.checked,
                        }))
                      }
                    />
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Max abstract words</strong>
                      <small>Recommended abstract word limit.</small>
                    </span>
                    <input
                      type="number"
                      className="settings-number-input"
                      min={50}
                      max={500}
                      value={settings.maxAbstractWords}
                      onChange={(event) =>
                        setSettings((c) => ({
                          ...c,
                          maxAbstractWords: parseInt(event.target.value, 10) || 250,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}

              {settingsTab === "application" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Updates</strong>
                    <span>Check, download, install, and restart LatexDo releases.</span>
                  </div>

                  <div className="settings-row update-row">
                    <span>
                      <strong>Application updates</strong>
                      <small>
                        {updateProgressActive && updateProgressLabel
                          ? updateProgressLabel
                          : updatingNow
                            ? "Preparing the updater and installer…"
                            : checkingUpdates
                              ? "Checking for the latest release…"
                              : updateInfo?.error
                                ? updateInfo.error
                                : updateInfo?.updateAvailable
                                  ? `Version ${updateInfo.latestVersion} is available. Current build ${updateInfo.currentVersion}.`
                                  : updateInfo
                                    ? `You are up to date. Current build ${updateInfo.currentVersion}.`
                                    : "No manual check has been run in this session."}
                      </small>
                      <small className="settings-update-meta">
                        {updateBuildSummary}
                      </small>
                      {updateLocationLabel ? (
                        <small className="settings-update-meta">
                          Updates at {updateLocationLabel}.
                        </small>
                      ) : null}
                      {updateCheckedLabel || updatePublishedLabel ? (
                        <small className="settings-update-meta">
                          {updateCheckedLabel
                            ? `Last checked ${updateCheckedLabel}`
                            : `Published ${updatePublishedLabel}`}
                        </small>
                      ) : null}
                      {updateProgressActive ? (
                        <div
                          className={`update-progress-bar settings-update-progress ${
                            updateProgressPercent === null ? "is-indeterminate" : ""
                          }`}
                          role="progressbar"
                          aria-label="Update download progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={
                            updateProgressPercent === null
                              ? undefined
                              : Math.round(updateProgressPercent)
                          }
                        >
                          <span
                            style={
                              updateProgressPercent === null
                                ? undefined
                                : { width: `${updateProgressPercent}%` }
                            }
                          />
                        </div>
                      ) : null}
                    </span>
                    <div className="settings-update-actions">
                      <button
                        type="button"
                        className="dialog-cancel"
                        onClick={() => void checkForUpdates()}
                        disabled={checkingUpdates || updatingNow}
                      >
                        {checkingUpdates ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <RefreshCw size={13} />
                        )}
                        {checkingUpdates ? "Checking…" : "Check for updates"}
                      </button>
                      <button
                        type="button"
                        className="dialog-submit"
                        onClick={() => void updateNow()}
                        disabled={checkingUpdates || updatingNow}
                      >
                        {updatingNow ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <Download size={13} />
                        )}
                        {updatingNow ? "Updating…" : updateActionText}
                      </button>
                      <button
                        type="button"
                        className="dialog-cancel"
                        onClick={() =>
                          void window.latexdo.openReleasesPage(
                            updateInfo?.releaseUrl ?? undefined,
                          )
                        }
                      >
                        <ExternalLink size={13} />
                        Open downloads
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
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
