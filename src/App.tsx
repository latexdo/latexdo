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
  History,
  House,
  ImageUp,
  LoaderCircle,
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
  RefreshCw,
  Settings,
  TerminalSquare,
  User,
  Variable,
  Wand,
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
import appIconUrl from "../build/icon.svg";
import FileTree from "./FileTree";
import PdfPreview, { type PdfClickLocation } from "./PdfPreview";
import TikzCanvas from "./TikzCanvas";
import TableCanvas from "./TableCanvas";
import { FigureToTikzConverter } from "./components/FigureToTikzConverter";
import { TerminalPanel } from "./components/TerminalPanel";
import { ReviewSidebar } from "./components/ReviewSidebar";
import { RebuttalSidebar } from "./components/RebuttalSidebar";
import { HistorySidebar } from "./components/HistorySidebar";
import { generateRebuttalLetter } from "./rebuttalGenerator";
import {
  normalizeLatexDoReviewMarkup,
  usesLatexDoReviewMacros,
} from "./reviewMarkup";
import type { RebuttalGeneratorSettings } from "./types";
import { monaco } from "./monaco";
import type {
  CompileResult,
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
  GitCommitDetails,
  GitDiffEditorInput,
  GitDiffPreview,
  GitHistorySummary,
  GitStatusEntry,
  GitStatusSummary,
  OpenDocument,
  ProofreadingResult,
  ProofreadingSettings,
  ProjectEntry,
  RebuttalItem,
  ReviewChat,
  ReviewChatComment,
  SpellCheckerSettings,
  SyncTexPdfLocation,
  SyncTexSourceLocation,
  UpdateCheckResult,
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

type PanelKind = "problems" | "output" | "terminal" | "checkAnalysis" | "structureReport" | "pdfReport";
type SidebarView = "explorer" | "sourceControl" | "history";

interface GitDiffSession extends GitDiffEditorInput {
  label: string;
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

interface AppSettings {
  defaultEngine: Engine;
  editorFontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  showRawLatex: boolean;

  // Conference Checker
  conferenceCheckerEnabled: boolean;
  conferenceTemplate: string;
  conferenceChecker_customTemplate: string;
  checkMargins: boolean;
  checkFontSize: boolean;
  checkAbstractLength: boolean;
  checkKeywords: boolean;
  checkFigureReferences: boolean;
  checkTableReferences: boolean;
  checkBibliographyStyle: boolean;
  checkPageLimit: boolean;
  checkAuthorInfo: boolean;
  checkAnonymousReview: boolean;
  checkFigureResolution: boolean;
  checkEmbeddedFonts: boolean;
  checkCompiler: boolean;

  // Citation Assistant
  citationAssistantEnabled: boolean;
  detectMissingCitations: boolean;
  detectUnusedEntries: boolean;
  detectDuplicateReferences: boolean;
  detectBrokenLinks: boolean;
  suggestCitationKeys: boolean;
  importMetadataSources: boolean;
  warnOldCitations: boolean;

  // Structure Assistant
  structureAssistantEnabled: boolean;
  checkAbstractStructure: boolean;
  checkIntroductionStructure: boolean;
  checkRelatedWorkLength: boolean;
  checkMethodReproducibility: boolean;
  checkResultsDiscussion: boolean;
  checkConclusionClaims: boolean;

  // Reproducibility Checklist
  reproducibilityEnabled: boolean;
  checkCodeLink: boolean;
  checkDatasetLink: boolean;
  checkLicenseMentioned: boolean;
  checkHyperparameters: boolean;
  checkHardwareDetails: boolean;
  checkRandomSeeds: boolean;
  checkEvaluationMetrics: boolean;

  // Acronym Manager
  acronymManagerEnabled: boolean;
  checkUndefinedAcronym: boolean;
  checkDuplicateDefinition: boolean;
  checkUnusedAcronym: boolean;
  checkConflictingDefinitions: boolean;

  // Error Doctor
  errorDoctorEnabled: boolean;
  explainErrors: boolean;
  suggestFixes: boolean;
  autoFixCommon: boolean;

  // TikZ Converter
  tikzConverterEnabled: boolean;
  tikzConverterAutoOpen: boolean;

  // Notation Manager
  notationManagerEnabled: boolean;
  detectNotation: boolean;
  detectNotationConflicts: boolean;
  detectUndefinedNotation: boolean;

  // PDF Compliance
  pdfComplianceEnabled: boolean;
  checkPageCount: boolean;
  maxPages: number;
  checkUnreferencedFigures: boolean;
  checkUncitedCitations: boolean;
  checkSectionsWithNoCitations: boolean;
  checkType3Fonts: boolean;
  checkAbstractWordCount: boolean;
  maxAbstractWords: number;

  // Rebuttal Generator
  rebuttalManuscriptId: string;
  rebuttalManuscriptTitle: string;
  rebuttalFontSize: string;
  rebuttalPaperSize: string;
  rebuttalFontFamily: string;
  rebuttalIncludeDiff: boolean;
  rebuttalDiffOldFile: string;
  rebuttalDiffNewFile: string;
  rebuttalDiffOutput: string;
  rebuttalSummary: string;
  rebuttalSpacing: boolean;
  rebuttalColorPrimary: string;
  rebuttalColorAccent: string;
}

const settingsStorageKey = "latexdo.settings";
const defaultSettings: AppSettings = {
  defaultEngine: "pdflatex",
  editorFontSize: 13.5,
  wordWrap: true,
  minimap: true,
  showRawLatex: true,

  conferenceCheckerEnabled: true,
  conferenceTemplate: "ieee",
  conferenceChecker_customTemplate: "",
  checkMargins: true,
  checkFontSize: true,
  checkAbstractLength: true,
  checkKeywords: true,
  checkFigureReferences: true,
  checkTableReferences: true,
  checkBibliographyStyle: true,
  checkPageLimit: true,
  checkAuthorInfo: true,
  checkAnonymousReview: true,
  checkFigureResolution: true,
  checkEmbeddedFonts: true,
  checkCompiler: true,

  citationAssistantEnabled: true,
  detectMissingCitations: true,
  detectUnusedEntries: true,
  detectDuplicateReferences: true,
  detectBrokenLinks: true,
  suggestCitationKeys: true,
  importMetadataSources: true,
  warnOldCitations: true,

  structureAssistantEnabled: true,
  checkAbstractStructure: true,
  checkIntroductionStructure: true,
  checkRelatedWorkLength: true,
  checkMethodReproducibility: true,
  checkResultsDiscussion: true,
  checkConclusionClaims: true,

  reproducibilityEnabled: true,
  checkCodeLink: true,
  checkDatasetLink: true,
  checkLicenseMentioned: true,
  checkHyperparameters: true,
  checkHardwareDetails: true,
  checkRandomSeeds: true,
  checkEvaluationMetrics: true,

  acronymManagerEnabled: true,
  checkUndefinedAcronym: true,
  checkDuplicateDefinition: true,
  checkUnusedAcronym: true,
  checkConflictingDefinitions: true,

  errorDoctorEnabled: true,
  explainErrors: true,
  suggestFixes: true,
  autoFixCommon: true,

  tikzConverterEnabled: true,
  tikzConverterAutoOpen: true,

  notationManagerEnabled: true,
  detectNotation: true,
  detectNotationConflicts: true,
  detectUndefinedNotation: true,

  pdfComplianceEnabled: true,
  checkPageCount: true,
  maxPages: 8,
  checkUnreferencedFigures: true,
  checkUncitedCitations: true,
  checkSectionsWithNoCitations: true,
  checkType3Fonts: true,
  checkAbstractWordCount: true,
  maxAbstractWords: 250,

  rebuttalManuscriptId: "COLA-D-26-00101",
  rebuttalManuscriptTitle: "Evaluating Package-Level Scoping Strategies for Repository-Level Code Completion in Pharo",
  rebuttalFontSize: "11pt",
  rebuttalPaperSize: "a4paper",
  rebuttalFontFamily: "newpx",
  rebuttalIncludeDiff: true,
  rebuttalDiffOldFile: "oldfile.tex",
  rebuttalDiffNewFile: "newfile.tex",
  rebuttalDiffOutput: "diff.tex",
  rebuttalSummary: "We revised the manuscript substantially in response to the reviewers' comments.",
  rebuttalSpacing: true,
  rebuttalColorPrimary: "1E1E1E",
  rebuttalColorAccent: "D9D9D9",
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
      showRawLatex:
        typeof saved.showRawLatex === "boolean"
          ? saved.showRawLatex
          : defaultSettings.showRawLatex,

      conferenceCheckerEnabled:
        typeof saved.conferenceCheckerEnabled === "boolean"
          ? saved.conferenceCheckerEnabled
          : defaultSettings.conferenceCheckerEnabled,
      conferenceTemplate:
        typeof saved.conferenceTemplate === "string"
          ? saved.conferenceTemplate
          : defaultSettings.conferenceTemplate,
      conferenceChecker_customTemplate:
        typeof saved.conferenceChecker_customTemplate === "string"
          ? saved.conferenceChecker_customTemplate
          : defaultSettings.conferenceChecker_customTemplate,
      checkMargins:
        typeof saved.checkMargins === "boolean"
          ? saved.checkMargins : defaultSettings.checkMargins,
      checkFontSize:
        typeof saved.checkFontSize === "boolean"
          ? saved.checkFontSize : defaultSettings.checkFontSize,
      checkAbstractLength:
        typeof saved.checkAbstractLength === "boolean"
          ? saved.checkAbstractLength : defaultSettings.checkAbstractLength,
      checkKeywords:
        typeof saved.checkKeywords === "boolean"
          ? saved.checkKeywords : defaultSettings.checkKeywords,
      checkFigureReferences:
        typeof saved.checkFigureReferences === "boolean"
          ? saved.checkFigureReferences : defaultSettings.checkFigureReferences,
      checkTableReferences:
        typeof saved.checkTableReferences === "boolean"
          ? saved.checkTableReferences : defaultSettings.checkTableReferences,
      checkBibliographyStyle:
        typeof saved.checkBibliographyStyle === "boolean"
          ? saved.checkBibliographyStyle : defaultSettings.checkBibliographyStyle,
      checkPageLimit:
        typeof saved.checkPageLimit === "boolean"
          ? saved.checkPageLimit : defaultSettings.checkPageLimit,
      checkAuthorInfo:
        typeof saved.checkAuthorInfo === "boolean"
          ? saved.checkAuthorInfo : defaultSettings.checkAuthorInfo,
      checkAnonymousReview:
        typeof saved.checkAnonymousReview === "boolean"
          ? saved.checkAnonymousReview : defaultSettings.checkAnonymousReview,
      checkFigureResolution:
        typeof saved.checkFigureResolution === "boolean"
          ? saved.checkFigureResolution : defaultSettings.checkFigureResolution,
      checkEmbeddedFonts:
        typeof saved.checkEmbeddedFonts === "boolean"
          ? saved.checkEmbeddedFonts : defaultSettings.checkEmbeddedFonts,
      checkCompiler:
        typeof saved.checkCompiler === "boolean"
          ? saved.checkCompiler : defaultSettings.checkCompiler,

      citationAssistantEnabled:
        typeof saved.citationAssistantEnabled === "boolean"
          ? saved.citationAssistantEnabled : defaultSettings.citationAssistantEnabled,
      detectMissingCitations:
        typeof saved.detectMissingCitations === "boolean"
          ? saved.detectMissingCitations : defaultSettings.detectMissingCitations,
      detectUnusedEntries:
        typeof saved.detectUnusedEntries === "boolean"
          ? saved.detectUnusedEntries : defaultSettings.detectUnusedEntries,
      detectDuplicateReferences:
        typeof saved.detectDuplicateReferences === "boolean"
          ? saved.detectDuplicateReferences : defaultSettings.detectDuplicateReferences,
      detectBrokenLinks:
        typeof saved.detectBrokenLinks === "boolean"
          ? saved.detectBrokenLinks : defaultSettings.detectBrokenLinks,
      suggestCitationKeys:
        typeof saved.suggestCitationKeys === "boolean"
          ? saved.suggestCitationKeys : defaultSettings.suggestCitationKeys,
      importMetadataSources:
        typeof saved.importMetadataSources === "boolean"
          ? saved.importMetadataSources : defaultSettings.importMetadataSources,
      warnOldCitations:
        typeof saved.warnOldCitations === "boolean"
          ? saved.warnOldCitations : defaultSettings.warnOldCitations,

      structureAssistantEnabled:
        typeof saved.structureAssistantEnabled === "boolean"
          ? saved.structureAssistantEnabled : defaultSettings.structureAssistantEnabled,
      checkAbstractStructure:
        typeof saved.checkAbstractStructure === "boolean"
          ? saved.checkAbstractStructure : defaultSettings.checkAbstractStructure,
      checkIntroductionStructure:
        typeof saved.checkIntroductionStructure === "boolean"
          ? saved.checkIntroductionStructure : defaultSettings.checkIntroductionStructure,
      checkRelatedWorkLength:
        typeof saved.checkRelatedWorkLength === "boolean"
          ? saved.checkRelatedWorkLength : defaultSettings.checkRelatedWorkLength,
      checkMethodReproducibility:
        typeof saved.checkMethodReproducibility === "boolean"
          ? saved.checkMethodReproducibility : defaultSettings.checkMethodReproducibility,
      checkResultsDiscussion:
        typeof saved.checkResultsDiscussion === "boolean"
          ? saved.checkResultsDiscussion : defaultSettings.checkResultsDiscussion,
      checkConclusionClaims:
        typeof saved.checkConclusionClaims === "boolean"
          ? saved.checkConclusionClaims : defaultSettings.checkConclusionClaims,

      reproducibilityEnabled:
        typeof saved.reproducibilityEnabled === "boolean"
          ? saved.reproducibilityEnabled : defaultSettings.reproducibilityEnabled,
      checkCodeLink:
        typeof saved.checkCodeLink === "boolean"
          ? saved.checkCodeLink : defaultSettings.checkCodeLink,
      checkDatasetLink:
        typeof saved.checkDatasetLink === "boolean"
          ? saved.checkDatasetLink : defaultSettings.checkDatasetLink,
      checkLicenseMentioned:
        typeof saved.checkLicenseMentioned === "boolean"
          ? saved.checkLicenseMentioned : defaultSettings.checkLicenseMentioned,
      checkHyperparameters:
        typeof saved.checkHyperparameters === "boolean"
          ? saved.checkHyperparameters : defaultSettings.checkHyperparameters,
      checkHardwareDetails:
        typeof saved.checkHardwareDetails === "boolean"
          ? saved.checkHardwareDetails : defaultSettings.checkHardwareDetails,
      checkRandomSeeds:
        typeof saved.checkRandomSeeds === "boolean"
          ? saved.checkRandomSeeds : defaultSettings.checkRandomSeeds,
      checkEvaluationMetrics:
        typeof saved.checkEvaluationMetrics === "boolean"
          ? saved.checkEvaluationMetrics : defaultSettings.checkEvaluationMetrics,

      acronymManagerEnabled:
        typeof saved.acronymManagerEnabled === "boolean"
          ? saved.acronymManagerEnabled : defaultSettings.acronymManagerEnabled,
      checkUndefinedAcronym:
        typeof saved.checkUndefinedAcronym === "boolean"
          ? saved.checkUndefinedAcronym : defaultSettings.checkUndefinedAcronym,
      checkDuplicateDefinition:
        typeof saved.checkDuplicateDefinition === "boolean"
          ? saved.checkDuplicateDefinition : defaultSettings.checkDuplicateDefinition,
      checkUnusedAcronym:
        typeof saved.checkUnusedAcronym === "boolean"
          ? saved.checkUnusedAcronym : defaultSettings.checkUnusedAcronym,
      checkConflictingDefinitions:
        typeof saved.checkConflictingDefinitions === "boolean"
          ? saved.checkConflictingDefinitions : defaultSettings.checkConflictingDefinitions,

      errorDoctorEnabled:
        typeof saved.errorDoctorEnabled === "boolean"
          ? saved.errorDoctorEnabled : defaultSettings.errorDoctorEnabled,
      explainErrors:
        typeof saved.explainErrors === "boolean"
          ? saved.explainErrors : defaultSettings.explainErrors,
      suggestFixes:
        typeof saved.suggestFixes === "boolean"
          ? saved.suggestFixes : defaultSettings.suggestFixes,
      autoFixCommon:
        typeof saved.autoFixCommon === "boolean"
          ? saved.autoFixCommon : defaultSettings.autoFixCommon,

      tikzConverterEnabled:
        typeof saved.tikzConverterEnabled === "boolean"
          ? saved.tikzConverterEnabled : defaultSettings.tikzConverterEnabled,
      tikzConverterAutoOpen:
        typeof saved.tikzConverterAutoOpen === "boolean"
          ? saved.tikzConverterAutoOpen : defaultSettings.tikzConverterAutoOpen,

      notationManagerEnabled:
        typeof saved.notationManagerEnabled === "boolean"
          ? saved.notationManagerEnabled : defaultSettings.notationManagerEnabled,
      detectNotation:
        typeof saved.detectNotation === "boolean"
          ? saved.detectNotation : defaultSettings.detectNotation,
      detectNotationConflicts:
        typeof saved.detectNotationConflicts === "boolean"
          ? saved.detectNotationConflicts : defaultSettings.detectNotationConflicts,
      detectUndefinedNotation:
        typeof saved.detectUndefinedNotation === "boolean"
          ? saved.detectUndefinedNotation : defaultSettings.detectUndefinedNotation,

      pdfComplianceEnabled:
        typeof saved.pdfComplianceEnabled === "boolean"
          ? saved.pdfComplianceEnabled : defaultSettings.pdfComplianceEnabled,
      checkPageCount:
        typeof saved.checkPageCount === "boolean"
          ? saved.checkPageCount : defaultSettings.checkPageCount,
      maxPages:
        typeof saved.maxPages === "number"
          ? saved.maxPages : defaultSettings.maxPages,
      checkUnreferencedFigures:
        typeof saved.checkUnreferencedFigures === "boolean"
          ? saved.checkUnreferencedFigures : defaultSettings.checkUnreferencedFigures,
      checkUncitedCitations:
        typeof saved.checkUncitedCitations === "boolean"
          ? saved.checkUncitedCitations : defaultSettings.checkUncitedCitations,
      checkSectionsWithNoCitations:
        typeof saved.checkSectionsWithNoCitations === "boolean"
          ? saved.checkSectionsWithNoCitations : defaultSettings.checkSectionsWithNoCitations,
      checkType3Fonts:
        typeof saved.checkType3Fonts === "boolean"
          ? saved.checkType3Fonts : defaultSettings.checkType3Fonts,
      checkAbstractWordCount:
        typeof saved.checkAbstractWordCount === "boolean"
          ? saved.checkAbstractWordCount : defaultSettings.checkAbstractWordCount,
      maxAbstractWords:
        typeof saved.maxAbstractWords === "number"
          ? saved.maxAbstractWords : defaultSettings.maxAbstractWords,

      rebuttalManuscriptId:
        typeof saved.rebuttalManuscriptId === "string"
          ? saved.rebuttalManuscriptId : defaultSettings.rebuttalManuscriptId,
      rebuttalManuscriptTitle:
        typeof saved.rebuttalManuscriptTitle === "string"
          ? saved.rebuttalManuscriptTitle : defaultSettings.rebuttalManuscriptTitle,
      rebuttalFontSize:
        typeof saved.rebuttalFontSize === "string"
          ? saved.rebuttalFontSize : defaultSettings.rebuttalFontSize,
      rebuttalPaperSize:
        typeof saved.rebuttalPaperSize === "string"
          ? saved.rebuttalPaperSize : defaultSettings.rebuttalPaperSize,
      rebuttalFontFamily:
        typeof saved.rebuttalFontFamily === "string"
          ? saved.rebuttalFontFamily : defaultSettings.rebuttalFontFamily,
      rebuttalIncludeDiff:
        typeof saved.rebuttalIncludeDiff === "boolean"
          ? saved.rebuttalIncludeDiff : defaultSettings.rebuttalIncludeDiff,
      rebuttalDiffOldFile:
        typeof saved.rebuttalDiffOldFile === "string"
          ? saved.rebuttalDiffOldFile : defaultSettings.rebuttalDiffOldFile,
      rebuttalDiffNewFile:
        typeof saved.rebuttalDiffNewFile === "string"
          ? saved.rebuttalDiffNewFile : defaultSettings.rebuttalDiffNewFile,
      rebuttalDiffOutput:
        typeof saved.rebuttalDiffOutput === "string"
          ? saved.rebuttalDiffOutput : defaultSettings.rebuttalDiffOutput,
      rebuttalSummary:
        typeof saved.rebuttalSummary === "string"
          ? saved.rebuttalSummary : defaultSettings.rebuttalSummary,
      rebuttalSpacing:
        typeof saved.rebuttalSpacing === "boolean"
          ? saved.rebuttalSpacing : defaultSettings.rebuttalSpacing,
      rebuttalColorPrimary:
        typeof saved.rebuttalColorPrimary === "string"
          ? saved.rebuttalColorPrimary : defaultSettings.rebuttalColorPrimary,
      rebuttalColorAccent:
        typeof saved.rebuttalColorAccent === "string"
          ? saved.rebuttalColorAccent : defaultSettings.rebuttalColorAccent,
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
  ["align", "\\begin{align}\n\t${1:a} &= ${2:b} \\\\\n\t&= ${0:c}\n\\end{align}"],
  ["cases", "\\begin{equation}\n\t${1:f(x)} = \\begin{cases}\n\t\t${2:0}, & ${3:x < 0} \\\\\n\t\t${4:1}, & ${0:x \\ge 0}\n\t\\end{cases}\n\\end{equation}"],
  ["matrix", "\\begin{bmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${0:d}\n\\end{bmatrix}"],
  ["frac", "\\frac{${1:numerator}}{${0:denominator}}"],
  ["sqrt", "\\sqrt{${0:x}}"],
  ["sum", "\\sum_{${1:i=1}}^{${2:n}} ${0:x_i}"],
  ["int", "\\int_{${1:a}}^{${2:b}} ${0:f(x)}\\,dx"],
  ["itemize", "\\begin{itemize}\n\t\\item ${0}\n\\end{itemize}"],
  ["enumerate", "\\begin{enumerate}\n\t\\item ${0}\n\\end{enumerate}"],
  ["cite", "\\cite{${1:key}}"],
  ["ref", "\\ref{${1:label}}"],
  ["label", "\\label{${1:label}}"],
  ["includegraphics", "\\includegraphics[width=${1:\\textwidth}]{${2:file}}"],
] as const;

const historyStorageRelativePath = ".latexdo/history.json";
const legacyReviewPlaceholderText = "Add your comment here...";
const maxHistorySnapshotsPerFile = 80;
const historyAutoCaptureDelayMs = 5000;

function fileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function gitDisplayPath(filePath: string): string {
  return filePath.includes(" -> ") ? filePath.split(" -> ").pop() ?? filePath : filePath;
}

function fileDirectory(filePath: string): string {
  const displayPath = gitDisplayPath(filePath);
  const parts = displayPath.split(/[/\\]/);
  parts.pop();
  return parts.join("/") || ".";
}

function gitStatusCode(entry: GitStatusEntry, area: "staged" | "changes"): string {
  const raw =
    area === "staged"
      ? entry.indexStatus || entry.workingTreeStatus
      : entry.workingTreeStatus || entry.indexStatus;
  if (entry.indexStatus === "?" || entry.workingTreeStatus === "?") return "U";
  if (entry.indexStatus === "U" || entry.workingTreeStatus === "U") return "!";
  return raw || "M";
}

function gitStatusLabel(code: string): string {
  switch (code) {
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Copied";
    case "U":
      return "Untracked";
    case "!":
      return "Conflict";
    case "M":
    default:
      return "Modified";
  }
}

function gitStatusClass(code: string): string {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "U":
      return "untracked";
    case "!":
      return "conflict";
    case "M":
    default:
      return "modified";
  }
}

function getSetting(key: string, settings: AppSettings): boolean {
  return (settings as unknown as Record<string, boolean>)[key] ?? true;
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

function historySnapshotId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function removeLegacyReviewPlaceholders(chats: ReviewChat[]): {
  chats: ReviewChat[];
  changed: boolean;
} {
  let changed = false;
  const cleaned = chats.map((chat) => {
    const comments = chat.comments.filter((comment) => {
      const keep =
        comment.text.trim() !== legacyReviewPlaceholderText ||
        comment.author !== "Reviewer";
      if (!keep) {
        changed = true;
      }
      return keep;
    });
    return comments.length === chat.comments.length ? chat : { ...chat, comments };
  });

  return { chats: cleaned, changed };
}

function buildHistorySnapshot(
  document: OpenDocument,
  source: DocumentHistorySnapshot["source"],
): DocumentHistorySnapshot {
  const timestamp = Date.now();
  const sourceLabel =
    source === "manual" ? "Manual" : source === "restore" ? "Restore point" : "Auto";
  return {
    id: historySnapshotId(),
    filePath: document.relativePath,
    fileName: document.name,
    label: `${sourceLabel} state`,
    content: document.content,
    timestamp,
    source,
  };
}

function normalizeHistorySnapshot(value: unknown): DocumentHistorySnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Partial<DocumentHistorySnapshot>;
  if (
    typeof item.id !== "string" ||
    typeof item.filePath !== "string" ||
    typeof item.content !== "string" ||
    typeof item.timestamp !== "number"
  ) {
    return null;
  }

  return {
    id: item.id,
    filePath: item.filePath,
    fileName: typeof item.fileName === "string" ? item.fileName : fileName(item.filePath),
    label: typeof item.label === "string" ? item.label : "History state",
    content: item.content,
    timestamp: item.timestamp,
    source:
      item.source === "manual" || item.source === "restore" || item.source === "auto"
        ? item.source
        : "auto",
  };
}

function pruneHistorySnapshots(
  snapshots: DocumentHistorySnapshot[],
): DocumentHistorySnapshot[] {
  const sorted = [...snapshots].sort((a, b) => b.timestamp - a.timestamp);
  const perFileCount = new Map<string, number>();
  const kept: DocumentHistorySnapshot[] = [];

  for (const snapshot of sorted) {
    const count = perFileCount.get(snapshot.filePath) ?? 0;
    if (count >= maxHistorySnapshotsPerFile) {
      continue;
    }
    perFileCount.set(snapshot.filePath, count + 1);
    kept.push(snapshot);
  }

  return kept;
}

export default function App() {
  const [projectPath, setProjectPath] = useState("");
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>([]);
  const [hideProjectEntries, setHideProjectEntries] = useState(true);
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
  const [settingsTab, setSettingsTab] = useState("editor");
  const [activeSidebar, setActiveSidebar] = useState<SidebarView>("explorer");
  const editorPreviewRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine>(settings.defaultEngine);
  const [rootFile, setRootFile] = useState("main.tex");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [tikzCanvasOpen, setTikzCanvasOpen] = useState(false);
  const [tableCanvasOpen, setTableCanvasOpen] = useState(false);
  const [tikzConverterOpen, setTikzConverterOpen] = useState(false);
  const [notationManagerOpen, setNotationManagerOpen] = useState(false);
  const [pdfComplianceDiagnostics, setPdfComplianceDiagnostics] = useState<Diagnostic[]>([]);
  const [panelVisible, setPanelVisible] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelKind>("problems");
  const [terminalStarted, setTerminalStarted] = useState(false);
  const [panelHeight, setPanelHeight] = useState(200);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [compileJobCount, setCompileJobCount] = useState(0);
  const compiling = compileJobCount > 0;
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
  const [documentHistory, setDocumentHistory] = useState<DocumentHistorySnapshot[]>([]);
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
  const [assistantDiagnostics, setAssistantDiagnostics] = useState<Diagnostic[]>([]);
  const [errorDoctorResult, setErrorDoctorResult] = useState<ErrorDoctorResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("Welcome to LatexDo");
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfTarget, setPdfTarget] = useState<SyncTexPdfLocation | null>(null);
  const [pdfScale, setPdfScale] = useState(100);
  const [splitPercent, setSplitPercent] = useState(52);
  const [mode, setMode] = useState<EditorMode>("author");
  const [reviewChats, setReviewChats] = useState<ReviewChat[]>([]);
  const [rebuttalItems, setRebuttalItems] = useState<RebuttalItem[]>([]);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorMouseDisposableRef = useRef<monaco.IDisposable | null>(null);
  const documentsRef = useRef<OpenDocument[]>([]);
  const documentHistoryRef = useRef<DocumentHistorySnapshot[]>([]);
  const projectEntriesRef = useRef<ProjectEntry[]>([]);
  const projectPathRef = useRef("");
  const hideProjectEntriesRef = useRef(true);
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
  const compileRunIdRef = useRef(0);
  const historySaveTimerRef = useRef<number | null>(null);
  const historyAutoCaptureTimerRef = useRef<number | null>(null);

  const activeDocument = documents.find(
    (document) => document.path === activePath,
  );
  const hasVisibleProject = Boolean(projectPath) && !hideProjectEntries;
  const showWelcome = welcomeOpen && !activePath;
  const showBlankWorkspace = hideProjectEntries && !welcomeOpen && !activePath;
  const previewShown = previewVisible && !showWelcome && !showBlankWorkspace;
  const projectName = hasVisibleProject ? fileName(projectPath) || "Project" : "No Folder";
  const diagnostics = useMemo(
    () => [
      ...(compileResult?.diagnostics ?? []),
      ...(proofreadingResult?.diagnostics ?? []),
      ...assistantDiagnostics,
      ...(errorDoctorResult?.diagnostics ?? []),
    ],
    [compileResult?.diagnostics, proofreadingResult?.diagnostics, assistantDiagnostics, errorDoctorResult?.diagnostics],
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
      hasVisibleProject &&
      allProjectEntries.some(
        (entry) =>
          entry.type === "file" &&
          normalizeRelativePath(entry.relativePath) ===
            normalizeRelativePath(rootFile),
      ),
    [allProjectEntries, hasVisibleProject, rootFile],
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
    documentHistoryRef.current = documentHistory;
  }, [documentHistory]);

  useEffect(() => {
    projectEntriesRef.current = projectEntries;
  }, [projectEntries]);

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

  const resolveProjectDataPath = useCallback((projectPath: string, relativePath: string) => {
    const separator = projectPath.includes("\\") ? "\\" : "/";
    const cleanProjectPath = projectPath.replace(/[\\/]+$/, "");
    const cleanRelativePath = relativePath.replaceAll("/", separator);
    return `${cleanProjectPath}${separator}${cleanRelativePath}`;
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
      (document) =>
        normalizeRelativePath(document.relativePath) === normalizedPath,
    );
  };

  const projectUsesLatexDoReviewMacros = async (
    currentProject: string,
  ): Promise<boolean> => {
    if (documentsRef.current.some((document) => usesLatexDoReviewMacros(document.content))) {
      return true;
    }

    const openDocumentPaths = new Set(
      documentsRef.current.map((document) => normalizeRelativePath(document.relativePath)),
    );
    const texEntries = flattenEntries(projectEntriesRef.current).filter(
      (entry) =>
        entry.type === "file" &&
        entry.name.endsWith(".tex") &&
        !openDocumentPaths.has(normalizeRelativePath(entry.relativePath)),
    );

    for (const entry of texEntries) {
      const content = await window.latexdo.readFile(currentProject, entry.path);
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
        openDocument?.content ?? (await window.latexdo.readFile(currentProject, entry.path));
      const normalizedContent = normalizeLatexDoReviewMarkup(content);

      if (normalizedContent !== content) {
        await window.latexdo.writeFile(currentProject, entry.path, normalizedContent);
        normalizedContents.set(normalizeRelativePath(entry.relativePath), normalizedContent);
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
        (await window.latexdo.readFile(currentProject, rootEntry.path));
      const rootContentWithMacros = ensurePreambleMacros(rootContent);
      if (
        rootContentWithMacros !== rootContent ||
        rootDocument?.content !== rootDocument?.savedContent
      ) {
        await window.latexdo.writeFile(currentProject, rootEntry.path, rootContentWithMacros);
        savedContents.set(normalizeRelativePath(rootEntry.relativePath), rootContentWithMacros);
      }
    }

    await Promise.all(
      dirtyDocuments
        .filter(
          (document) =>
            normalizeRelativePath(document.relativePath) !==
            normalizeRelativePath(rootRelativePath),
        )
        .map(async (document) => {
          const normalizedPath = normalizeRelativePath(document.relativePath);
          const content = savedContents.get(normalizedPath) ?? document.content;
          await window.latexdo.writeFile(currentProject, document.path, content);
          savedContents.set(normalizedPath, content);
        }),
    );

    if (!reviewMacrosNeeded && rootDocument && rootDocument.content !== rootDocument.savedContent) {
      const normalizedPath = normalizeRelativePath(rootDocument.relativePath);
      const content = savedContents.get(normalizedPath) ?? rootDocument.content;
      await window.latexdo.writeFile(currentProject, rootDocument.path, content);
      savedContents.set(normalizedPath, content);
    }

    if (savedContents.size > 0) {
      setDocuments((current) => {
        const nextDocuments = current.map((document) => {
          const savedContent = savedContents.get(normalizeRelativePath(document.relativePath));
          return savedContent === undefined
            ? document
            : { ...document, content: savedContent, savedContent };
        });
        documentsRef.current = nextDocuments;
        return nextDocuments;
      });
    }
  };

  const saveReviewData = useCallback(async (chats: ReviewChat[], items: RebuttalItem[]) => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    try {
      const data = JSON.stringify({ chats, items }, null, 2);
      const filePath = resolveProjectDataPath(currentProject, ".latexdo/review_data.json");
      await window.latexdo.writeFile(currentProject, filePath, data);
    } catch (e) {
      console.error("Failed to save review data", e);
    }
  }, [resolveProjectDataPath]);

  const loadReviewData = useCallback(async (path: string) => {
    try {
      const filePath = resolveProjectDataPath(path, ".latexdo/review_data.json");
      const exists = await window.latexdo.fileExists(path, filePath);
      if (!exists) {
        setReviewChats([]);
        setRebuttalItems([]);
        return;
      }
      const content = await window.latexdo.readFile(path, filePath);
      const { chats, items } = JSON.parse(content) as { chats: ReviewChat[], items: RebuttalItem[] };
      const nextItems = items || [];
      const normalizedChats = removeLegacyReviewPlaceholders(chats || []);
      setReviewChats(normalizedChats.chats);
      setRebuttalItems(nextItems);
      if (normalizedChats.changed) {
        void saveReviewData(normalizedChats.chats, nextItems);
      }
    } catch (e) {
      setReviewChats([]);
      setRebuttalItems([]);
    }
  }, [resolveProjectDataPath, saveReviewData]);

  const saveHistoryData = useCallback(async (snapshots: DocumentHistorySnapshot[]) => {
    const currentProject = projectPathRef.current;
    if (!currentProject) return;

    try {
      const data = JSON.stringify({ snapshots }, null, 2);
      const filePath = resolveProjectDataPath(currentProject, historyStorageRelativePath);
      await window.latexdo.writeFile(currentProject, filePath, data);
    } catch (e) {
      console.error("Failed to save document history", e);
    }
  }, [resolveProjectDataPath]);

  const scheduleHistorySave = useCallback((snapshots: DocumentHistorySnapshot[]) => {
    if (historySaveTimerRef.current !== null) {
      window.clearTimeout(historySaveTimerRef.current);
    }
    historySaveTimerRef.current = window.setTimeout(() => {
      historySaveTimerRef.current = null;
      void saveHistoryData(snapshots);
    }, 350);
  }, [saveHistoryData]);

  const updateDocumentHistory = useCallback(
    (
      updater: (
        snapshots: DocumentHistorySnapshot[],
      ) => DocumentHistorySnapshot[],
    ) => {
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
        const latestForFile = [...current]
          .filter((item) => item.filePath === snapshot.filePath)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        if (latestForFile?.content === snapshot.content) {
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
      const latestForFile = [...documentHistoryRef.current]
        .filter((item) => item.filePath === document.relativePath)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      const added = latestForFile?.content !== document.content;
      addHistorySnapshot(buildHistorySnapshot(document, source));
      if (source === "manual") {
        setStatusMessage(
          added
            ? `Captured history state for ${document.relativePath}`
            : `No changes to capture for ${document.relativePath}`,
        );
      }
    },
    [addHistorySnapshot],
  );

  const loadHistoryData = useCallback(async (path: string) => {
    try {
      const filePath = resolveProjectDataPath(path, historyStorageRelativePath);
      const exists = await window.latexdo.fileExists(path, filePath);
      if (!exists) {
        setDocumentHistory([]);
        documentHistoryRef.current = [];
        return;
      }
      const content = await window.latexdo.readFile(path, filePath);
      const parsed = JSON.parse(content) as {
        snapshots?: unknown[];
      } | unknown[];
      const rawSnapshots = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.snapshots)
          ? parsed.snapshots
          : [];
      const snapshots = pruneHistorySnapshots(
        rawSnapshots
          .map(normalizeHistorySnapshot)
          .filter((snapshot): snapshot is DocumentHistorySnapshot => Boolean(snapshot)),
      );
      setDocumentHistory(snapshots);
      documentHistoryRef.current = snapshots;
    } catch (e) {
      setDocumentHistory([]);
      documentHistoryRef.current = [];
    }
  }, [resolveProjectDataPath]);

  const generateRebuttalFile = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject || !rootFile) return;

    try {
      const rebuttalRoot = rootFile.replace(/\.tex$/, "-rebuttal.tex");
      const entry = allProjectEntries.find(e => e.relativePath === rootFile);
      if (!entry) return;

      let content = documentsRef.current.find(d => d.path === entry.path)?.content;
      if (content === undefined) {
        content = await window.latexdo.readFile(currentProject, entry.path);
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
      setDocumentHistory([]);
      documentHistoryRef.current = [];
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
      await loadReviewData(path);
      await loadHistoryData(path);
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
    [loadHistoryData, loadReviewData, openDocument],
  );

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
    if (!currentProject || hideProjectEntriesRef.current) {
      setStatusMessage("Create or open a project before compiling.");
      return null;
    }

    const compileRunId = compileRunIdRef.current + 1;
    compileRunIdRef.current = compileRunId;
    lastAutoCompileSignatureRef.current = buildAutoCompileSignature(
      documentsRef.current,
      currentProject,
      rootFileRef.current,
      engineRef.current,
    );
    setCompileJobCount((count) => count + 1);
    setStatusMessage(`Compiling ${rootFileRef.current} in the background…`);
    try {
      const dirtyDocuments = documentsRef.current.filter(
        (document) => document.content !== document.savedContent,
      );
      await saveDocumentsForCompile(currentProject, dirtyDocuments);

      const result = await window.latexdo.compile({
        projectPath: currentProject,
        rootFile: rootFileRef.current,
        engine: engineRef.current,
      });

      const isLatestCompile = compileRunId === compileRunIdRef.current;
      if (isLatestCompile) {
        setCompileResult(result);
      }

      if (result.ok && result.pdfPath) {
        const bytes = await window.latexdo.readPdf(
          currentProject,
          result.pdfPath,
        );
        if (isLatestCompile) {
          pdfPathRef.current = result.pdfPath;
          setPdfData(new Uint8Array(bytes));
          setPdfTarget(null);
          setPreviewVisible(true);
          setStatusMessage(`Built successfully in ${formatDuration(result.durationMs)}`);
        }
      } else {
        if (isLatestCompile) {
          pdfPathRef.current = "";
          setPdfTarget(null);
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
        setPanelVisible(true);
        setActivePanel("output");
        setStatusMessage(
          error instanceof Error ? error.message : "Compilation failed",
        );
      }
      return null;
    } finally {
      setCompileJobCount((count) => Math.max(0, count - 1));
    }
  }, []);

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
        all.push(...runConferenceChecks(content, settings as unknown as ConferenceCheckerSettings));
      }
      if (settings.citationAssistantEnabled) {
        all.push(...runCitationChecks(content, settings as unknown as CitationAssistantSettings));
      }
      if (settings.structureAssistantEnabled) {
        all.push(...runStructureChecks(content, settings as unknown as StructureAssistantSettings));
      }
      if (settings.reproducibilityEnabled) {
        all.push(...runReproducibilityChecks(content, settings as unknown as ReproducibilitySettings));
      }
      if (settings.acronymManagerEnabled) {
        all.push(...runAcronymChecks(content, settings as unknown as AcronymManagerSettings));
      }
      if (settings.notationManagerEnabled) {
        const result = runNotationChecks(content, settings as unknown as NotationManagerSettings);
        all.push(...result.diagnostics);
      }
      setAssistantDiagnostics(all);
    }, 500);
    return () => clearTimeout(timer);
  }, [activeDocument?.content, settings.conferenceCheckerEnabled, settings.citationAssistantEnabled, settings.structureAssistantEnabled,
    settings.reproducibilityEnabled, settings.acronymManagerEnabled,
    settings.checkMargins, settings.checkFontSize, settings.checkAbstractLength,
    settings.checkKeywords, settings.checkFigureReferences, settings.checkTableReferences,
    settings.checkBibliographyStyle, settings.checkPageLimit, settings.checkAuthorInfo,
    settings.checkAnonymousReview, settings.checkFigureResolution, settings.checkEmbeddedFonts,
    settings.checkCompiler, settings.detectMissingCitations, settings.detectUnusedEntries,
    settings.detectDuplicateReferences, settings.detectBrokenLinks, settings.suggestCitationKeys,
    settings.importMetadataSources, settings.warnOldCitations, settings.checkAbstractStructure,
    settings.checkIntroductionStructure, settings.checkRelatedWorkLength,
    settings.checkMethodReproducibility, settings.checkResultsDiscussion,
    settings.checkConclusionClaims, settings.conferenceTemplate, settings.conferenceChecker_customTemplate,
    settings.checkCodeLink, settings.checkDatasetLink, settings.checkLicenseMentioned,
    settings.checkHyperparameters, settings.checkHardwareDetails, settings.checkRandomSeeds,
    settings.checkEvaluationMetrics,     settings.checkUndefinedAcronym, settings.checkDuplicateDefinition,
    settings.checkUnusedAcronym, settings.checkConflictingDefinitions,
    settings.notationManagerEnabled, settings.detectNotation, settings.detectNotationConflicts,
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
  }, [compileResult?.output, settings.errorDoctorEnabled, settings.explainErrors, settings.suggestFixes, settings.autoFixCommon, activeDocument?.content]);

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
  }, [activeDocument?.content, compileResult?.output, settings.pdfComplianceEnabled, settings.checkPageCount, settings.maxPages, settings.checkUnreferencedFigures, settings.checkUncitedCitations, settings.checkSectionsWithNoCitations, settings.checkType3Fonts, settings.checkAbstractWordCount, settings.maxAbstractWords]);

  const moveEntry = useCallback(
    async (sourcePath: string, destination: ProjectEntry | null) => {
      const currentProject = projectPathRef.current;
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

      const sourceRelativePath = normalizeRelativePath(
        sourceEntry.relativePath,
      );
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
            (normalizeRelativePath(document.relativePath) ===
              sourceRelativePath ||
              normalizeRelativePath(document.relativePath).startsWith(
                sourcePrefix,
              )) &&
            document.content !== document.savedContent,
        );
        for (const document of dirtySourceDocuments) {
          await saveDocument(document);
        }

        const nextPath = await window.latexdo.moveEntry(
          currentProject,
          sourceEntry.relativePath,
          destinationRelativePath,
        );
        const nextRelativePath = normalizeRelativePath(destinationRelativePath);
        const nextPrefix = `${nextRelativePath}/`;
        const sourceAbsolutePath = normalizeRelativePath(sourceEntry.path);
        const absoluteSeparator = nextPath.includes("\\") ? "\\" : "/";
        const joinAbsolutePath = (base: string, suffix: string): string =>
          `${base.replace(/[\\/]+$/, "")}${absoluteSeparator}${suffix.replaceAll(
            "/",
            absoluteSeparator,
          )}`;

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

        const normalizedActivePath = normalizeRelativePath(
          activePathRef.current,
        );
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
        setTableCanvasOpen(false);
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

  const reviewDecorationsRef = useRef<string[]>([]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeDocument) return;

    const relevantChats = reviewChats.filter(chat => chat.filePath === activeDocument.relativePath);
    const decorations = relevantChats.map(chat => ({
      range: new monaco.Range(
        chat.selection.startLine,
        chat.selection.startColumn,
        chat.selection.endLine,
        chat.selection.endColumn
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

    reviewDecorationsRef.current = editor.deltaDecorations(reviewDecorationsRef.current, decorations);
  }, [activeDocument, reviewChats]);

  const latexDecorationsRef = useRef<string[]>([]);

  const updateLatexDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !activeDocument || !activeDocument.content) {
      return;
    }

    if (settings.showRawLatex) {
      latexDecorationsRef.current = editor.deltaDecorations(latexDecorationsRef.current, []);
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const ranges: monaco.editor.IModelDeltaDecoration[] = [];
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

    latexDecorationsRef.current = editor.deltaDecorations(latexDecorationsRef.current, ranges);
  }, [activeDocument, settings.showRawLatex]);

  useEffect(() => {
    updateLatexDecorations();
  }, [updateLatexDecorations]);

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
    if (!projectPath || hideProjectEntries) {
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
    if (panel === "terminal") {
      setTerminalStarted(true);
    }
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

  const handleAddReviewChat = useCallback(() => {
    const editor = editorRef.current;
    const document = documentsRef.current.find(d => d.path === activePathRef.current);
    if (!editor || !document) return;

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return;

    const model = editor.getModel();
    if (!model) return;

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

    setReviewChats(prev => {
      const next = [...prev, newChat];
      void saveReviewData(next, rebuttalItems);
      return next;
    });
    setStatusMessage("Started review conversation in sidebar.");
  }, [rebuttalItems, saveReviewData]);

  const handleAddRebuttalToSource = useCallback(() => {
    const editor = editorRef.current;
    const document = documentsRef.current.find(d => d.path === activePathRef.current);
    if (!editor || !document) return;

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

    editor.executeEdits("rebuttal-mode", [{
      range: selection,
      text: wrappedText,
      forceMoveMarkers: true
    }]);

    const newItem: RebuttalItem = {
      id: Date.now().toString(),
      originalText: selectedText,
      revisedText,
      reviewerComment,
      authorComment: authorAnswer,
      modificationMade: revisedText,
    };
    
    setRebuttalItems(prev => {
      const next = [...prev, newItem];
      void saveReviewData(reviewChats, next);
      return next;
    });
    setStatusMessage("Added rebuttal modification to source.");
  }, [reviewChats, saveReviewData]);

  const handleGenerateRebuttalLetter = useCallback(async () => {
    const currentProject = projectPathRef.current;
    if (!currentProject) { setStatusMessage("No project open."); return; }

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
        setStatusMessage("Generated rebuttal letter is empty — check items and settings.");
        return;
      }
      const outName = "rebuttal-letter.tex";
      await window.latexdo.writeFile(currentProject, outName, tex);
      setStatusMessage(`Generated ${outName} — open to compile.`);
      await refreshProject(currentProject);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setStatusMessage(`Failed: ${err}`);
    }
  }, [rebuttalItems, refreshProject, settings]);

  const handleAddReviewComment = useCallback((chatId: string, text: string) => {
    setReviewChats(prev => {
      const next = prev.map(chat => {
        if (chat.id === chatId) {
          return {
            ...chat,
            comments: [...chat.comments, {
              id: Date.now().toString(),
              author: mode === "reviewer" ? "Reviewer" : "Author",
              text,
              timestamp: Date.now(),
            }]
          };
        }
        return chat;
      });
      void saveReviewData(next, rebuttalItems);
      return next;
    });
  }, [mode, rebuttalItems, saveReviewData]);

  const handleDeleteReviewChat = useCallback((chatId: string) => {
    if (!window.confirm("Delete this review chat?")) return;
    setReviewChats(prev => {
      const next = prev.filter(c => c.id !== chatId);
      void saveReviewData(next, rebuttalItems);
      return next;
    });
  }, [rebuttalItems, saveReviewData]);

  const handleJumpToReviewSelection = useCallback(async (chat: ReviewChat) => {
    const entry = allProjectEntries.find(e => e.relativePath === chat.filePath);
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
  }, [allProjectEntries, openDocument, revealPendingSource]);

  const handleAddRebuttalItem = useCallback(() => {
    const newItem: RebuttalItem = {
      id: Date.now().toString(),
      originalText: "",
      revisedText: "",
      reviewerComment: "",
      authorComment: "",
      modificationMade: "",
    };
    setRebuttalItems(prev => {
      const next = [...prev, newItem];
      void saveReviewData(reviewChats, next);
      return next;
    });
  }, [reviewChats, saveReviewData]);

  const handleUpdateRebuttalItem = useCallback((id: string, updates: Partial<RebuttalItem>) => {
    setRebuttalItems(prev => {
      const next = prev.map(item => item.id === id ? { ...item, ...updates } : item);
      void saveReviewData(reviewChats, next);
      return next;
    });
  }, [reviewChats, saveReviewData]);

  const handleDeleteRebuttalItem = useCallback((id: string) => {
    if (!window.confirm("Delete this rebuttal item?")) return;
    setRebuttalItems(prev => {
      const next = prev.filter(item => item.id !== id);
      void saveReviewData(reviewChats, next);
      return next;
    });
  }, [reviewChats, saveReviewData]);

  const handleRestoreHistorySnapshot = useCallback(
    async (snapshot: DocumentHistorySnapshot) => {
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

      const currentProject = projectPathRef.current;
      const currentDocument = documentsRef.current.find(
        (document) =>
          normalizeRelativePath(document.relativePath) ===
          normalizeRelativePath(snapshot.filePath),
      );
      if (currentDocument && currentDocument.content !== snapshot.content) {
        addHistorySnapshot(buildHistorySnapshot(currentDocument, "restore"));
      }

      const savedContent = currentProject
        ? await window.latexdo.readFile(currentProject, entry.path).catch(() => snapshot.content)
        : snapshot.content;

      setGitDiffSession(null);
      setWelcomeOpen(false);
      setActivePath(entry.path);
      activePathRef.current = entry.path;
      setDocuments((current) => {
        const exists = current.some((document) => document.path === entry.path);
        const nextDocuments = exists
          ? current.map((document) =>
              document.path === entry.path
                ? { ...document, content: snapshot.content, savedContent }
                : document,
            )
          : [
              ...current,
              {
                path: entry.path,
                relativePath: entry.relativePath,
                name: entry.name,
                content: snapshot.content,
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
    [addHistorySnapshot, allProjectEntries],
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
    if (!editor || !model || !document || !document.name.endsWith(".tex")) {
      setStatusMessage("Open a .tex document before inserting math.");
      return;
    }

    const selection = editor.getSelection();
    const selectedText = selection && !selection.isEmpty()
      ? model.getValueInRange(selection).trim()
      : "";
    const isInlineSnippet = code === "$x$";
    const insertText = selectedText
      ? code.replace("x = y", selectedText).replace("$x$", `$${selectedText}$`)
      : code;
    const position = editor.getPosition();
    const lineNumber = position?.lineNumber ?? model.getLineCount();
    const column = position?.column ?? model.getLineLength(lineNumber) + 1;
    editor.executeEdits("notation-manager", [
      {
        range: selection && !selection.isEmpty()
          ? selection
          : new monaco.Range(lineNumber, column, lineNumber, column),
        text: isInlineSnippet ? insertText : `\n${insertText}\n`,
        forceMoveMarkers: true,
      },
    ]);
    editor.focus();
    setStatusMessage("Inserted notation snippet.");
  }, []);

  useEffect(() => {
    if (historyAutoCaptureTimerRef.current !== null) {
      window.clearTimeout(historyAutoCaptureTimerRef.current);
      historyAutoCaptureTimerRef.current = null;
    }
    if (!projectPath || !activeDocument || showWelcome || showBlankWorkspace) {
      return;
    }

    historyAutoCaptureTimerRef.current = window.setTimeout(() => {
      historyAutoCaptureTimerRef.current = null;
      const document = documentsRef.current.find(
        (item) => item.path === activePathRef.current,
      );
      if (!document || !document.content.trim()) {
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
    activeDocument?.content,
    activeDocument?.path,
    addHistorySnapshot,
    projectPath,
    showBlankWorkspace,
    showWelcome,
  ]);

  const startResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const handleMove = (moveEvent: PointerEvent) => {
      const workspace = document.querySelector(".editor-preview")!;
      const bounds = workspace.getBoundingClientRect();
      const percent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplitPercent(Math.min(80, Math.max(20, percent)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

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

  const renderGitChangeRow = (
    entry: GitStatusEntry,
    area: "staged" | "changes",
  ) => {
    const code = gitStatusCode(entry, area);
    const displayPath = gitDisplayPath(entry.path);
    const directory = fileDirectory(entry.path);
    const statusLabel = gitStatusLabel(code);
    const isPreviewed = gitDiffPreview?.path === entry.path;

    return (
      <div
        key={`${entry.path}:${entry.indexStatus}:${entry.workingTreeStatus}:${area}`}
        className={`scm-file-row ${isPreviewed ? "active" : ""}`}
      >
        <button
          type="button"
          className="scm-file-main"
          onClick={() => void previewGitDiff(entry.path)}
          title={`Preview ${displayPath}`}
        >
          <span className={`scm-status-badge ${gitStatusClass(code)}`}>
            {code}
          </span>
          <span className="scm-file-text">
            <strong>{fileName(displayPath)}</strong>
            <small>{directory}</small>
          </span>
        </button>

        <div className="scm-row-actions">
          <button
            type="button"
            className="scm-icon-action"
            onClick={() => void openGitDiffEditor(entry.path)}
            disabled={gitActionBusy === `editor-diff:${entry.path}`}
            title="Open diff"
            aria-label={`Open diff for ${displayPath}`}
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
        </div>
        <span className="scm-row-status">{statusLabel}</span>
      </div>
    );
  };

  return (
    <div className="app-shell">
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
              className={`activity-button ${
                sidebarVisible && activeSidebar === "history" ? "active" : ""
              }`}
              onClick={() => openSidebar("history")}
              title="History"
            >
              <History size={21} />
            </button>
            <button
              className={`activity-button ${tikzCanvasOpen ? "active" : ""}`}
              onClick={() => setTikzCanvasOpen((open) => !open)}
              title="Draw"
            >
              <Pencil size={21} />
            </button>
            <button
              className={`activity-button ${tableCanvasOpen ? "active" : ""}`}
              onClick={() => setTableCanvasOpen((open) => !open)}
              title="Table Generator"
            >
              <Box size={21} />
            </button>
            <button
              className={`activity-button ${tikzConverterOpen ? "active" : ""}`}
              onClick={() => setTikzConverterOpen((open) => !open)}
              title="Figure → TikZ Converter"
            >
              <ImageUp size={21} />
            </button>
            <button
              className={`activity-button ${notationManagerOpen ? "active" : ""}`}
              onClick={() => {
                if (settings.notationManagerEnabled) {
                  setNotationManagerOpen((open) => !open);
                }
              }}
              title="Notation Manager"
            >
              <Variable size={21} />
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
                  : activeSidebar === "sourceControl"
                    ? "SOURCE CONTROL"
                    : "HISTORY"}
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
                      onClick={() => void refreshProject()}
                      title="Refresh"
                      disabled={!hasVisibleProject}
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
                ) : activeSidebar === "history" ? (
                  <button
                    className="small-icon"
                    onClick={() => captureActiveHistorySnapshot("manual")}
                    title="Capture current state"
                    disabled={!activeDocument}
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
                  ) : mode === "reviewer" ? (
                    <ReviewSidebar
                      chats={reviewChats}
                      onAddChat={handleAddReviewChat}
                      onAddComment={handleAddReviewComment}
                      onDeleteChat={handleDeleteReviewChat}
                      onJumpToSelection={handleJumpToReviewSelection}
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
                      disabled={gitActionBusy === "commit" || !gitCommitMessage.trim()}
                    >
                      <Check size={13} />
                      <span>{gitActionBusy === "commit" ? "Committing..." : "Commit"}</span>
                    </button>
                  </div>
                ) : null}
                <div className="sidebar-list source-control-list">
                  {gitStatus?.isRepo ? (
                    <>
                      {gitStatus.entries.length ? (
                        <>
                          <div className="scm-section-header">
                            <span>Staged Changes <b>{stagedGitEntries.length}</b></span>
                            <button
                              type="button"
                              className="scm-icon-action"
                              onClick={() => void unstageAllGitEntries()}
                              disabled={!stagedGitEntries.length || gitActionBusy === "unstage-all"}
                              title="Unstage all"
                              aria-label="Unstage all changes"
                            >
                              <Minus size={13} />
                            </button>
                          </div>
                          {stagedGitEntries.length ? (
                            stagedGitEntries.map((entry) => renderGitChangeRow(entry, "staged"))
                          ) : (
                            <div className="sidebar-empty-state compact">
                              No staged changes.
                            </div>
                          )}
                          <div className="scm-section-header">
                            <span>Changes <b>{unstagedGitEntries.length}</b></span>
                            <div className="scm-section-actions">
                              <button
                                type="button"
                                className="scm-icon-action"
                                onClick={() => void stageAllGitEntries()}
                                disabled={!unstagedGitEntries.length || gitActionBusy === "stage-all"}
                                title="Stage all"
                                aria-label="Stage all changes"
                              >
                                <Plus size={13} />
                              </button>
                              <button
                                type="button"
                                className="scm-icon-action danger"
                                onClick={() => void discardAllGitEntries()}
                                disabled={!unstagedGitEntries.length || gitActionBusy === "discard-all"}
                                title="Discard all unstaged changes"
                                aria-label="Discard all unstaged changes"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>
                          {unstagedGitEntries.length ? (
                            unstagedGitEntries.map((entry) => renderGitChangeRow(entry, "changes"))
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
                        <span>Diff Preview</span>
                      </div>
                      <div className="sidebar-diff-preview scm-diff-preview">
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
                      <div className="scm-section-header">
                        <span>Timeline</span>
                      </div>
                      <div className="scm-history-list">
                        {gitRepoHistory?.commits.length ? (
                          gitRepoHistory.commits.slice(0, 5).map((commit) => (
                            <button
                              key={commit.hash}
                              className="scm-history-row"
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
            ) : activeSidebar === "history" ? (
              <div className="sidebar-panel history-panel">
                <HistorySidebar
                  activeFilePath={activeDocument?.relativePath}
                  snapshots={documentHistory}
                  onCaptureSnapshot={() => captureActiveHistorySnapshot("manual")}
                  onRestoreSnapshot={handleRestoreHistorySnapshot}
                  onDeleteSnapshot={handleDeleteHistorySnapshot}
                />
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
                <AppIcon className="welcome-tab-mark" />
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

                  <div className="toolbar-spacer" />

                  <div className="root-control">
                    <span className="control-label">COMPILER</span>
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
                  </div>

                  <button
                    className={`compile-button ${compiling ? "compiling" : ""}`}
                    onClick={() => void compile()}
                    disabled={!rootFile}
                    title={compiling ? "Start another background compile" : "Compile"}
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
                      {hasVisibleProject ? (
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
                      ) : null}
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
                    glyphMargin: true,
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
                  <AppIcon className="empty-logo" />
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

          {tableCanvasOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">Table Generator</span>
                <button className="tikz-modal-close" onClick={() => setTableCanvasOpen(false)}>
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
                            range: new monaco.Range(lineNumber, column, lineNumber, column),
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

          {tikzConverterOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">
                  <ImageUp size={16} />
                  <span>Figure → TikZ Converter</span>
                </span>
                <button className="tikz-modal-close" onClick={() => setTikzConverterOpen(false)}>
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
                            range: new monaco.Range(lineNumber, column, lineNumber, column),
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

          {notationManagerOpen && (
            <div className="tikz-modal-overlay">
              <div className="tikz-modal-header">
                <span className="tikz-modal-title">
                  <Variable size={16} />
                  <span>Notation Manager</span>
                </span>
                <button className="tikz-modal-close" onClick={() => setNotationManagerOpen(false)}>
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

          {panelVisible ? (
            <section className="bottom-panel" style={{ height: panelHeight }}>
              <div
                className="panel-resize-handle"
                onPointerDown={startPanelResize}
              />
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
                    <span className="count-badge">{pdfComplianceDiagnostics.length}</span>
                  ) : null}
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
                {terminalStarted ? (
                  <section
                    className={`panel-pane panel-pane-terminal ${
                      activePanel === "terminal" ? "" : "hidden"
                    }`}
                  >
                    <TerminalPanel
                      cwd={projectPath}
                      active={activePanel === "terminal"}
                    />
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
                                <div key={i} className={`check-analysis-item check-analysis-item--${d.severity}`}>
                                  <div className="check-analysis-item-icon">
                                    {d.severity === "error" ? "✗" : "!"}
                                  </div>
                                  <div className="check-analysis-item-body">
                                    <div className="check-analysis-item-message">{d.message}</div>
                                    {d.detail && <div className="check-analysis-item-detail">{d.detail}</div>}
                                    {d.suggestion && <div className="check-analysis-item-suggestion">{d.suggestion}</div>}
                                    {d.suggestion?.includes("fix") || d.suggestion?.includes("Fix") ? (
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
                        <span>No check results yet. Open a .tex file to run automated analysis.</span>
                      </div>
                    )}
                  </section>
                ) : null}
                {activePanel === "structureReport" ? (
                  <section className="panel-pane panel-pane-check-analysis">
                    {structureDiagnostics.length ? (
                      <div className="check-analysis-list">
                        {(() => {
                          const groups: Record<string, { label: string; diagnostics: Diagnostic[] }> = {};
                          for (const d of structureDiagnostics) {
                            let key = "other";
                            let label = "Other";
                            if (d.message.includes("Abstract")) { key = "abstract"; label = "Abstract"; }
                            else if (d.message.includes("Introduction")) { key = "introduction"; label = "Introduction"; }
                            else if (d.message.includes("Related Work")) { key = "related"; label = "Related Work"; }
                            else if (d.message.includes("Method")) { key = "method"; label = "Method"; }
                            else if (d.message.includes("Results")) { key = "results"; label = "Results"; }
                            else if (d.message.includes("Conclusion")) { key = "conclusion"; label = "Conclusion"; }
                            if (!groups[key]) groups[key] = { label, diagnostics: [] };
                            groups[key].diagnostics.push(d);
                          }
                          return Object.entries(groups).map(([key, group]) => {
                            const passed = group.diagnostics.filter((d) => d.severity !== "error" && !d.detail?.includes("missing") && !d.detail?.includes("not found") && !d.detail?.includes("lacks") && !d.detail?.includes("too short") && !d.detail?.includes("no ") && !d.message.includes("not found"));
                            const failed = group.diagnostics.filter((d) => !passed.includes(d));
                            return (
                              <div key={key} className="check-analysis-group">
                                <div className="check-analysis-group-header">
                                  <span className="check-analysis-group-name">{group.label}</span>
                                  <span className={`check-analysis-group-count ${failed.length > 0 ? "has-issues" : "all-good"}`}>
                                    {failed.length > 0 ? `${failed.length} issue${failed.length !== 1 ? "s" : ""}` : "✓ All checks passed"}
                                  </span>
                                </div>
                                {failed.map((d, i) => (
                                  <div key={i} className={`check-analysis-item check-analysis-item--warning`}>
                                    <div className="check-analysis-item-icon">!</div>
                                    <div className="check-analysis-item-body">
                                      <div className="check-analysis-item-message">{d.message}</div>
                                      {d.detail && <div className="check-analysis-item-detail">{d.detail}</div>}
                                      {d.suggestion && <div className="check-analysis-item-suggestion">{d.suggestion}</div>}
                                    </div>
                                  </div>
                                ))}
                                {passed.length > 0 && (
                                  <div className="check-analysis-passed">
                                    {passed.map((d, i) => (
                                      <div key={i} className="check-analysis-passed-item">
                                        <span className="check-analysis-passed-icon">✓</span>
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
                        <span>No structure analysis yet. Open a .tex file to check paper structure.</span>
                      </div>
                    )}
                  </section>
                ) : null}
                {activePanel === "pdfReport" ? (
                  <section className="panel-pane panel-pane-check-analysis">
                    {pdfComplianceDiagnostics.length ? (
                      <div className="check-analysis-list">
                        {(() => {
                          const groups: Record<string, { label: string; diagnostics: Diagnostic[] }> = {};
                          for (const d of pdfComplianceDiagnostics) {
                            let key = "other";
                            let label = "Other";
                            if (d.message.includes("page") || d.message.includes("Page")) { key = "pages"; label = "Page Count"; }
                            else if (d.message.includes("Figure") || d.message.includes("figure")) { key = "figures"; label = "Figures"; }
                            else if (d.message.includes("Citation") || d.message.includes("citation") || d.message.includes("cite") || d.message.includes("Section.*citation")) { key = "citations"; label = "Citations"; }
                            else if (d.message.includes("Type 3") || d.message.includes("font")) { key = "fonts"; label = "Fonts"; }
                            else if (d.message.includes("Abstract")) { key = "abstract"; label = "Abstract"; }
                            if (!groups[key]) groups[key] = { label, diagnostics: [] };
                            groups[key].diagnostics.push(d);
                          }
                          return Object.entries(groups).map(([key, group]) => {
                            const passed = group.diagnostics.filter((d) => d.severity !== "error" && !d.detail?.includes("exceed") && !d.detail?.includes("never") && !d.detail?.includes("no ") && !d.detail?.includes("missing") && !d.message.includes("exceed") && !d.message.includes("never"));
                            const failed = group.diagnostics.filter((d) => !passed.includes(d));
                            return (
                              <div key={key} className="check-analysis-group">
                                <div className="check-analysis-group-header">
                                  <span className="check-analysis-group-name">{group.label}</span>
                                  <span className={`check-analysis-group-count ${failed.length > 0 ? "has-issues" : "all-good"}`}>
                                    {failed.length > 0 ? `${failed.length} issue${failed.length !== 1 ? "s" : ""}` : "✓ Compliant"}
                                  </span>
                                </div>
                                {failed.map((d, i) => (
                                  <div key={i} className={`check-analysis-item ${d.severity === "error" ? "check-analysis-item--error" : "check-analysis-item--warning"}`}>
                                    <div className="check-analysis-item-icon">{d.severity === "error" ? "✗" : "!"}</div>
                                    <div className="check-analysis-item-body">
                                      <div className="check-analysis-item-message">{d.message}</div>
                                      {d.detail && <div className="check-analysis-item-detail">{d.detail}</div>}
                                      {d.suggestion && <div className="check-analysis-item-suggestion">{d.suggestion}</div>}
                                    </div>
                                  </div>
                                ))}
                                {passed.length > 0 && (
                                  <div className="check-analysis-passed">
                                    {passed.map((d, i) => (
                                      <div key={i} className="check-analysis-passed-item">
                                        <span className="check-analysis-passed-icon">✓</span>
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
                        <span>No PDF compliance report yet. Compile your project to generate a compliance report.</span>
                      </div>
                    )}
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
            <AppIcon className="status-brand-icon" />
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
          {compiling ? (
            <span className="status-compile">
              <LoaderCircle size={13} className="spin" />
              {compileJobCount} compile job{compileJobCount === 1 ? "" : "s"}
            </span>
          ) : null}
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

            <div className="settings-tabs">
              <button className={`settings-tab ${settingsTab === "editor" ? "active" : ""}`} onClick={() => setSettingsTab("editor")}>Editor</button>
              <button className={`settings-tab ${settingsTab === "language" ? "active" : ""}`} onClick={() => setSettingsTab("language")}>Language</button>
              <button className={`settings-tab ${settingsTab === "conference" ? "active" : ""}`} onClick={() => setSettingsTab("conference")}>Conference Checker</button>
              <button className={`settings-tab ${settingsTab === "citation" ? "active" : ""}`} onClick={() => setSettingsTab("citation")}>Citation Assistant</button>
              <button className={`settings-tab ${settingsTab === "structure" ? "active" : ""}`} onClick={() => setSettingsTab("structure")}>Structure Assistant</button>
              <button className={`settings-tab ${settingsTab === "reproducibility" ? "active" : ""}`} onClick={() => setSettingsTab("reproducibility")}>Reproducibility</button>
              <button className={`settings-tab ${settingsTab === "acronym" ? "active" : ""}`} onClick={() => setSettingsTab("acronym")}>Acronym Manager</button>
              <button className={`settings-tab ${settingsTab === "doctor" ? "active" : ""}`} onClick={() => setSettingsTab("doctor")}>Error Doctor</button>
              <button className={`settings-tab ${settingsTab === "tikz" ? "active" : ""}`} onClick={() => setSettingsTab("tikz")}>TikZ Converter</button>
              <button className={`settings-tab ${settingsTab === "notation" ? "active" : ""}`} onClick={() => setSettingsTab("notation")}>Notation</button>
              <button className={`settings-tab ${settingsTab === "pdf" ? "active" : ""}`} onClick={() => setSettingsTab("pdf")}>PDF Compliance</button>
              <button className={`settings-tab ${settingsTab === "application" ? "active" : ""}`} onClick={() => setSettingsTab("application")}>Application</button>
            </div>

            <div className="settings-list">
              {settingsTab === "editor" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Editor and compiler</strong>
                    <span>Configure how LaTeX source is edited and built.</span>
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
                      <strong>Show raw LaTeX source</strong>
                      <small>When off, LaTeX commands are faded so only document text is visible.</small>
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
                      <small>Show misspellings directly in editable inputs across the app.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={spellCheckerSettings?.enabled ?? true}
                      onChange={(event) => toggleSpellCheckerEnabled(event.target.checked)}
                      disabled={spellCheckerLoading || !spellCheckerSettings}
                    />
                  </label>

                  <div className="settings-row settings-row-stack">
                    <span>
                      <strong>Spell checker languages</strong>
                      <small>{spellCheckerSettings?.usesSystemLanguage ? "macOS uses the native spell checker and automatically detects language." : "Choose one or more dictionaries for Windows and Linux spell checking."}</small>
                    </span>
                    {spellCheckerSettings?.usesSystemLanguage ? (
                      <div className="spellchecker-note">Language selection is controlled by the system spell checker on macOS.</div>
                    ) : (
                      <div className="spellchecker-language-panel">
                        <input type="text" value={spellCheckerLanguageQuery} onChange={(event) => setSpellCheckerLanguageQuery(event.target.value)} placeholder="Filter languages" spellCheck={false} disabled={spellCheckerLoading || !spellCheckerSettings} />
                        <div className="spellchecker-language-list">
                          {filteredSpellCheckerLanguages.length ? (
                            filteredSpellCheckerLanguages.map((language) => (
                              <label key={language} className="spellchecker-language-option">
                                <input type="checkbox" checked={spellCheckerSettings?.languages.includes(language) ?? false} onChange={() => toggleSpellCheckerLanguage(language)} disabled={spellCheckerLoading || !spellCheckerSettings} />
                                <span>{language}</span>
                              </label>
                            ))
                          ) : (
                            <div className="spellchecker-note compact">No language matches that filter.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="settings-row settings-row-stack">
                    <span>
                      <strong>Custom words</strong>
                      <small>Add project-specific terms, package names, and citation keys so they stop showing as misspellings.</small>
                    </span>
                    <form className="spellchecker-word-form" onSubmit={addSpellCheckerWord}>
                      <input type="text" value={spellCheckerWordDraft} onChange={(event) => setSpellCheckerWordDraft(event.target.value)} placeholder="Add a custom word" spellCheck={false} disabled={spellCheckerLoading || !spellCheckerSettings} />
                      <button type="submit" className="dialog-submit" disabled={spellCheckerLoading || !spellCheckerSettings}>Add word</button>
                    </form>
                    <div className="spellchecker-chip-list">{(spellCheckerSettings?.customWords ?? []).length ? ((spellCheckerSettings?.customWords ?? []).map((word) => (<span key={word} className="spellchecker-chip">{word}</span>))) : (<div className="spellchecker-note compact">No custom words added yet.</div>)}</div>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Grammar and style checking</strong>
                      <small>Run LanguageTool-compatible proofreading on natural-language text while ignoring LaTeX commands, math, and citations.</small>
                    </span>
                    <input type="checkbox" checked={proofreadingSettings?.enabled ?? true} onChange={(event) => { if (!proofreadingSettings) return; void saveProofreadingSettings({ ...proofreadingSettings, enabled: event.target.checked }, event.target.checked ? "Grammar checker enabled" : "Grammar checker disabled"); }} disabled={!proofreadingSettings} />
                  </label>

                  <div className="settings-row settings-row-stack">
                    <span>
                      <strong>Proofreading service</strong>
                      <small>Use the public LanguageTool API by default, or point LatexDo to your own compatible server.</small>
                    </span>
                    <div className="spellchecker-language-panel">
                      <input type="text" value={proofreadingSettings?.serverUrl ?? ""} onChange={(event) => { setProofreadingSettings((current) => current ? { ...current, serverUrl: event.target.value } : current); }} placeholder="https://api.languagetool.org/v2/check" spellCheck={false} disabled={!proofreadingSettings} />
                      <div className="spellchecker-grid">
                        <label className="spellchecker-field">
                          <span>Language</span>
                          <select value={proofreadingSettings?.language ?? "auto"} onChange={(event) => { setProofreadingSettings((current) => current ? { ...current, language: event.target.value } : current); }} disabled={!proofreadingSettings}>
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
                          <input type="text" value={proofreadingSettings?.motherTongue ?? ""} onChange={(event) => { setProofreadingSettings((current) => current ? { ...current, motherTongue: event.target.value } : current); }} placeholder="Optional, e.g. en" spellCheck={false} disabled={!proofreadingSettings} />
                        </label>
                      </div>
                      <label className="spellchecker-inline-toggle">
                        <input type="checkbox" checked={proofreadingSettings?.picky ?? false} onChange={(event) => { setProofreadingSettings((current) => current ? { ...current, picky: event.target.checked } : current); }} disabled={!proofreadingSettings} />
                        <span>Enable picky mode for stricter style suggestions</span>
                      </label>
                      <div className="settings-update-actions">
                        <button type="button" className="dialog-cancel" onClick={() => { if (!proofreadingSettings) return; void saveProofreadingSettings(proofreadingSettings, "Proofreading settings saved"); }} disabled={!proofreadingSettings}>Save grammar settings</button>
                        <button type="button" className="dialog-submit" onClick={() => void runProofreading()} disabled={!proofreadingSettings || !proofreadingSettings.enabled || proofreadingLoading || !activeDocument || !supportsProofreading(activeDocument.name)}>{proofreadingLoading ? "Checking..." : "Proofread now"}</button>
                      </div>
                      <div className="spellchecker-note compact">{proofreadingResult?.error ? proofreadingResult.error : proofreadingResult?.output ? proofreadingResult.output : "Suggestions appear inline in the editor and in the Problems panel."}</div>
                    </div>
                  </div>

                  {spellCheckerError ? (<div className="settings-row settings-row-stack settings-inline-error"><div className="dialog-error"><CircleAlert size={14} />{spellCheckerError}</div></div>) : null}
                  {proofreadingError ? (<div className="settings-row settings-row-stack settings-inline-error"><div className="dialog-error"><CircleAlert size={14} />{proofreadingError}</div></div>) : null}
                </>
              ) : null}

              {settingsTab === "conference" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Conference / Journal Submission Checker</strong>
                    <span>Validate your manuscript against conference and journal submission guidelines.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable conference checker</strong>
                      <small>Run submission-format checks on your LaTeX source.</small>
                    </span>
                    <input type="checkbox" checked={settings.conferenceCheckerEnabled} onChange={(event) => setSettings((c) => ({ ...c, conferenceCheckerEnabled: event.target.checked }))} />
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Select template</strong>
                      <small>Choose the target venue template.</small>
                    </span>
                    <select value={settings.conferenceTemplate === "custom" ? "custom" : settings.conferenceTemplate} onChange={(event) => setSettings((c) => ({ ...c, conferenceTemplate: event.target.value }))}>
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
                      <input type="text" value={settings.conferenceChecker_customTemplate} onChange={(event) => setSettings((c) => ({ ...c, conferenceChecker_customTemplate: event.target.value }))} placeholder="e.g., \\documentclass[twocolumn]{article}" />
                    </div>
                  ) : null}

                  <div className="settings-section-heading" style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}>
                    <strong>Checks to perform</strong>
                  </div>

                  {[
                    ["checkMargins", "Margins", "Check for incorrect margin settings."],
                    ["checkFontSize", "Font size", "Warn if font size does not match template requirements."],
                    ["checkAbstractLength", "Abstract length", "Flag abstracts that exceed the word limit."],
                    ["checkKeywords", "Missing keywords", "Ensure the document has keywords defined."],
                    ["checkFigureReferences", "Figure references", "Find figures that are not referenced in the text."],
                    ["checkTableReferences", "Table references", "Find tables that are not referenced in the text."],
                    ["checkBibliographyStyle", "Bibliography style", "Verify bibliography style matches the template."],
                    ["checkPageLimit", "Page limit", "Rough check for going over the page limit."],
                    ["checkAuthorInfo", "Author information", "Check for missing author name, affiliation, or email."],
                    ["checkAnonymousReview", "Anonymous review", "Detect potential author-identifying information for double-blind submissions."],
                    ["checkFigureResolution", "Figure resolution", "Check included image formats and warn about low-resolution formats."],
                    ["checkEmbeddedFonts", "Embedded fonts", "Basic check for font usage that may cause PDF issues."],
                    ["checkCompiler", "Compiler selection", "Check if selected compiler is appropriate for used packages."],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input type="checkbox" checked={getSetting(key, settings)} onChange={(event) => setSettings((c) => ({ ...c, [key]: event.target.checked }))} />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "citation" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Smart Citation Assistant</strong>
                    <span>Detect missing citations, unused references, broken links, and more.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable citation assistant</strong>
                      <small>Run citation-related checks on your LaTeX source.</small>
                    </span>
                    <input type="checkbox" checked={settings.citationAssistantEnabled} onChange={(event) => setSettings((c) => ({ ...c, citationAssistantEnabled: event.target.checked }))} />
                  </label>

                  {[
                    ["detectMissingCitations", "Detect missing citations", "Find paragraphs that make technical claims but have no citations."],
                    ["detectUnusedEntries", "Detect unused entries", "Check for BibTeX entries that are never cited."],
                    ["detectDuplicateReferences", "Detect duplicate references", "Find the same paper cited under different keys."],
                    ["detectBrokenLinks", "Detect broken links", "Check for malformed DOI, arXiv, and URL links."],
                    ["suggestCitationKeys", "Suggest citation keys", "Auto-suggest citations for sentences with factual claims."],
                    ["importMetadataSources", "Import from metadata sources", "Enable DOI/arXiv metadata import."],
                    ["warnOldCitations", "Warn about old citations", "Flag citations older than 5 years and suggest newer surveys."],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input type="checkbox" checked={getSetting(key, settings)} onChange={(event) => setSettings((c) => ({ ...c, [key]: event.target.checked }))} />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "structure" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Research Structure Assistant</strong>
                    <span>Check whether your paper's structure meets academic writing standards.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable structure assistant</strong>
                      <small>Run structure quality checks on your LaTeX source.</small>
                    </span>
                    <input type="checkbox" checked={settings.structureAssistantEnabled} onChange={(event) => setSettings((c) => ({ ...c, structureAssistantEnabled: event.target.checked }))} />
                  </label>

                  {[
                    ["checkAbstractStructure", "Abstract structure", "Check if abstract includes problem, method, result, and contribution."],
                    ["checkIntroductionStructure", "Introduction structure", "Check if introduction has motivation, gap, and contribution."],
                    ["checkRelatedWorkLength", "Related work length", "Warn if the related work section is too short."],
                    ["checkMethodReproducibility", "Method reproducibility", "Check for reproducibility details in the method section."],
                    ["checkResultsDiscussion", "Results discussion", "Ensure results are accompanied by discussion and analysis."],
                    ["checkConclusionClaims", "Conclusion claims", "Warn if conclusion introduces new claims not supported earlier."],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input type="checkbox" checked={getSetting(key, settings)} onChange={(event) => setSettings((c) => ({ ...c, [key]: event.target.checked }))} />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "reproducibility" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Reproducibility Checklist</strong>
                    <span>Check that your paper includes all information needed for reproducibility.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable reproducibility checks</strong>
                      <small>Run checks for code, data, and experiment reproducibility details.</small>
                    </span>
                    <input type="checkbox" checked={settings.reproducibilityEnabled} onChange={(event) => setSettings((c) => ({ ...c, reproducibilityEnabled: event.target.checked }))} />
                  </label>

                  {[
                    ["checkCodeLink", "Code availability", "Ensure a link to source code is provided (e.g., GitHub, Zenodo)."],
                    ["checkDatasetLink", "Dataset availability", "Check that datasets are linked or their availability is mentioned."],
                    ["checkLicenseMentioned", "License information", "Verify the license for code/data is stated."],
                    ["checkHyperparameters", "Hyperparameters", "Confirm hyperparameters are listed for ML experiments."],
                    ["checkHardwareDetails", "Hardware details", "Check that GPU/CPU and computing resources are described."],
                    ["checkRandomSeeds", "Random seeds", "Ensure random seeds are mentioned for reproducibility."],
                    ["checkEvaluationMetrics", "Evaluation metrics", "Check that metrics are defined and computation is described."],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input type="checkbox" checked={getSetting(key, settings)} onChange={(event) => setSettings((c) => ({ ...c, [key]: event.target.checked }))} />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "acronym" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Acronym & Glossary Manager</strong>
                    <span>Automatically detect acronym definitions, duplicates, and usage issues.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable acronym manager</strong>
                      <small>Run acronym consistency checks on your LaTeX source.</small>
                    </span>
                    <input type="checkbox" checked={settings.acronymManagerEnabled} onChange={(event) => setSettings((c) => ({ ...c, acronymManagerEnabled: event.target.checked }))} />
                  </label>

                  {[
                    ["checkUndefinedAcronym", "Undefined acronyms", "Warn when an acronym is used without prior definition."],
                    ["checkDuplicateDefinition", "Duplicate definitions", "Warn if the same acronym is defined multiple times."],
                    ["checkUnusedAcronym", "Unused acronyms", "Warn if an acronym is defined but never used again."],
                    ["checkConflictingDefinitions", "Conflicting definitions", "Warn if different full forms map to the same acronym."],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input type="checkbox" checked={getSetting(key, settings)} onChange={(event) => setSettings((c) => ({ ...c, [key]: event.target.checked }))} />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "doctor" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>LaTeX Error Doctor</strong>
                    <span>Smart error explanations with one-click fix suggestions.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable Error Doctor</strong>
                      <small>Analyze compile output and provide intelligent error explanations.</small>
                    </span>
                    <input type="checkbox" checked={settings.errorDoctorEnabled} onChange={(event) => setSettings((c) => ({ ...c, errorDoctorEnabled: event.target.checked }))} />
                  </label>

                  {[
                    ["explainErrors", "Explain errors", "Show human-readable explanations for LaTeX errors."],
                    ["suggestFixes", "Suggest fixes", "Provide actionable fix suggestions for common errors."],
                    ["autoFixCommon", "Auto-fix common errors", "Automatically apply one-click fixes for simple errors (e.g., underscore escaping)."],
                  ].map(([key, label, desc]) => (
                    <label key={key} className="settings-row settings-toggle">
                      <span>
                        <strong>{label}</strong>
                        <small>{desc}</small>
                      </span>
                      <input type="checkbox" checked={getSetting(key, settings)} onChange={(event) => setSettings((c) => ({ ...c, [key]: event.target.checked }))} />
                    </label>
                  ))}
                </>
              ) : null}

              {settingsTab === "tikz" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Figure → TikZ Converter</strong>
                    <span>Upload images and automatically generate editable TikZ code.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable TikZ converter</strong>
                      <small>Show the Figure → TikZ converter button in the activity bar.</small>
                    </span>
                    <input type="checkbox" checked={settings.tikzConverterEnabled} onChange={(event) => setSettings((c) => ({ ...c, tikzConverterEnabled: event.target.checked }))} />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Auto-open on image copy</strong>
                      <small>Automatically open converter when an image is detected in clipboard.</small>
                    </span>
                    <input type="checkbox" checked={settings.tikzConverterAutoOpen} onChange={(event) => setSettings((c) => ({ ...c, tikzConverterAutoOpen: event.target.checked }))} />
                  </label>
                </>
              ) : null}

              {settingsTab === "notation" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Notation Manager</strong>
                    <span>Detect, define, and manage mathematical notation in your LaTeX documents.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable notation manager</strong>
                      <small>Show the Notation Manager button in the activity bar.</small>
                    </span>
                    <input type="checkbox" checked={settings.notationManagerEnabled} onChange={(event) => setSettings((c) => ({ ...c, notationManagerEnabled: event.target.checked }))} />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Detect notation</strong>
                      <small>Scan documents for mathematical symbols and notation.</small>
                    </span>
                    <input type="checkbox" checked={settings.detectNotation} onChange={(event) => setSettings((c) => ({ ...c, detectNotation: event.target.checked }))} />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Detect notation conflicts</strong>
                      <small>Flag symbols that are visually or semantically similar.</small>
                    </span>
                    <input type="checkbox" checked={settings.detectNotationConflicts} onChange={(event) => setSettings((c) => ({ ...c, detectNotationConflicts: event.target.checked }))} />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Detect undefined notation</strong>
                      <small>Warn when a symbol is used without a preceding definition.</small>
                    </span>
                    <input type="checkbox" checked={settings.detectUndefinedNotation} onChange={(event) => setSettings((c) => ({ ...c, detectUndefinedNotation: event.target.checked }))} />
                  </label>
                </>
              ) : null}

              {settingsTab === "pdf" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>PDF Compliance Report</strong>
                    <span>Check compiled PDF against conference guidelines and best practices.</span>
                  </div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Enable PDF compliance checks</strong>
                      <small>Run compliance checks after each compilation.</small>
                    </span>
                    <input type="checkbox" checked={settings.pdfComplianceEnabled} onChange={(event) => setSettings((c) => ({ ...c, pdfComplianceEnabled: event.target.checked }))} />
                  </label>

                  <div className="settings-section-subheading">Page count</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check page count</strong>
                      <small>Warn if the PDF exceeds the page limit.</small>
                    </span>
                    <input type="checkbox" checked={settings.checkPageCount} onChange={(event) => setSettings((c) => ({ ...c, checkPageCount: event.target.checked }))} />
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Maximum pages</strong>
                      <small>Conference page limit.</small>
                    </span>
                    <input type="number" className="settings-number-input" min={1} max={100} value={settings.maxPages} onChange={(event) => setSettings((c) => ({ ...c, maxPages: parseInt(event.target.value, 10) || 8 }))} />
                  </label>

                  <div className="settings-section-subheading">Figures</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check unreferenced figures</strong>
                      <small>Detect figures that have no \\ref{} in text.</small>
                    </span>
                    <input type="checkbox" checked={settings.checkUnreferencedFigures} onChange={(event) => setSettings((c) => ({ ...c, checkUnreferencedFigures: event.target.checked }))} />
                  </label>

                  <div className="settings-section-subheading">Citations</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check uncited citations</strong>
                      <small>Detect bibliography entries never cited in text.</small>
                    </span>
                    <input type="checkbox" checked={settings.checkUncitedCitations} onChange={(event) => setSettings((c) => ({ ...c, checkUncitedCitations: event.target.checked }))} />
                  </label>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check sections with no citations</strong>
                      <small>Flag sections that lack any citations.</small>
                    </span>
                    <input type="checkbox" checked={settings.checkSectionsWithNoCitations} onChange={(event) => setSettings((c) => ({ ...c, checkSectionsWithNoCitations: event.target.checked }))} />
                  </label>

                  <div className="settings-section-subheading">Fonts</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check for Type 3 fonts</strong>
                      <small>Warn if the PDF uses bitmap fonts.</small>
                    </span>
                    <input type="checkbox" checked={settings.checkType3Fonts} onChange={(event) => setSettings((c) => ({ ...c, checkType3Fonts: event.target.checked }))} />
                  </label>

                  <div className="settings-section-subheading">Abstract</div>

                  <label className="settings-row settings-toggle">
                    <span>
                      <strong>Check abstract word count</strong>
                      <small>Warn if abstract exceeds the recommended limit.</small>
                    </span>
                    <input type="checkbox" checked={settings.checkAbstractWordCount} onChange={(event) => setSettings((c) => ({ ...c, checkAbstractWordCount: event.target.checked }))} />
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Max abstract words</strong>
                      <small>Recommended abstract word limit.</small>
                    </span>
                    <input type="number" className="settings-number-input" min={50} max={500} value={settings.maxAbstractWords} onChange={(event) => setSettings((c) => ({ ...c, maxAbstractWords: parseInt(event.target.value, 10) || 250 }))} />
                  </label>
                </>
              ) : null}

              {settingsTab === "application" ? (
                <>
                  <div className="settings-section-heading">
                    <strong>Application</strong>
                    <span>Version and release management.</span>
                  </div>

                  <div className="settings-row update-row">
                    <span>
                      <strong>App updates</strong>
                      <small>{checkingUpdates ? "Checking for the latest release…" : updateInfo?.updateAvailable ? `Version ${updateInfo.latestVersion} is available. You are on ${updateInfo.currentVersion}.` : updateInfo?.latestVersion ? `You are up to date on version ${updateInfo.currentVersion}.` : updateInfo?.error ? updateInfo.error : "Check GitHub releases for updates."}</small>
                    </span>
                    <div className="settings-update-actions">
                      <button type="button" className="dialog-cancel" onClick={() => void checkForUpdates()} disabled={checkingUpdates}>{checkingUpdates ? "Checking…" : "Check now"}</button>
                      <button type="button" className="dialog-submit" onClick={() => void window.latexdo.openReleasesPage()}>View releases</button>
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
