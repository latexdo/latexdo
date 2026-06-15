export interface ProjectEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  children?: ProjectEntry[];
}

export interface OpenDocument {
  path: string;
  relativePath: string;
  name: string;
  content: string;
  savedContent: string;
}

export interface DiagnosticContextLine {
  line: number;
  text: string;
  focus: boolean;
}

export interface DiagnosticFix {
  title: string;
  expectedText: string;
  replacement: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  confidence: number;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning";
  message: string;
  detail?: string;
  suggestion?: string;
  sourceLine?: string;
  source?: "latex" | "proofread";
  code?: string;
  replacements?: string[];
  title?: string;
  locationAccuracy?: "exact" | "inferred" | "line";
  highlightText?: string;
  sourceContext?: DiagnosticContextLine[];
  reportedLine?: number;
  reportedColumn?: number;
  originReason?: string;
  locationConfidence?: number;
  fixes?: DiagnosticFix[];
  isPrimary?: boolean;
  isCascade?: boolean;
  cascadeReason?: string;
  priority?: number;
}

export interface CompileResult {
  ok: boolean;
  pdfPath?: string;
  durationMs: number;
  output: string;
  diagnostics: Diagnostic[];
  error?: string;
}

export interface SyncTexSourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface SyncTexPdfLocation {
  page: number;
  x: number;
  y: number;
  h: number;
  v: number;
  width: number;
  height: number;
  word?: string;
}

export interface GitStatusEntry {
  path: string;
  indexStatus: string;
  workingTreeStatus: string;
}

export interface GitStatusSummary {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  error?: string;
}

export interface GitDiffPreview {
  path: string;
  diff: string;
}

export interface GitDiffEditorInput {
  path: string;
  original: string;
  modified: string;
}

export interface GitCommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitHistorySummary {
  scope: "repo" | "file";
  target: string | null;
  commits: GitCommitEntry[];
}

export interface GitCommitDetails {
  hash: string;
  summary: string;
  body: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  error?: string;
}

export interface SpellCheckerSettings {
  enabled: boolean;
  languages: string[];
  customWords: string[];
  availableLanguages: string[];
  usesSystemLanguage: boolean;
}

export interface ProofreadingSettings {
  enabled: boolean;
  serverUrl: string;
  language: string;
  picky: boolean;
  motherTongue: string;
}

export interface ProofreadingResult {
  diagnostics: Diagnostic[];
  output: string;
  checkedTextLength: number;
  error?: string;
}

export type Engine = "pdflatex" | "xelatex" | "lualatex";

export type EditorMode = "author" | "rebuttal" | "reviewer";

export interface ReviewChatComment {
  id: string;
  author: string;
  text: string;
  timestamp: number;
}

export interface ReviewChat {
  id: string;
  filePath: string;
  selection: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    text: string;
  };
  comments: ReviewChatComment[];
}

export interface RebuttalItem {
  id: string;
  reviewerComment: string;
  authorComment: string;
  modificationMade: string;
}

export type ConferenceTemplate = "ieee" | "acm" | "springer" | "elsevier" | "neurips" | "cvpr" | "custom";

export interface ConferenceCheckerSettings {
  enabled: boolean;
  template: ConferenceTemplate;
  customTemplate: string;
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
}

export interface CitationAssistantSettings {
  enabled: boolean;
  detectMissingCitations: boolean;
  detectUnusedEntries: boolean;
  detectDuplicateReferences: boolean;
  detectBrokenLinks: boolean;
  suggestCitationKeys: boolean;
  importMetadataSources: boolean;
  warnOldCitations: boolean;
}

export interface StructureAssistantSettings {
  enabled: boolean;
  checkAbstractStructure: boolean;
  checkIntroductionStructure: boolean;
  checkRelatedWorkLength: boolean;
  checkMethodReproducibility: boolean;
  checkResultsDiscussion: boolean;
  checkConclusionClaims: boolean;
}

export interface ReproducibilitySettings {
  enabled: boolean;
  checkCodeLink: boolean;
  checkDatasetLink: boolean;
  checkLicenseMentioned: boolean;
  checkHyperparameters: boolean;
  checkHardwareDetails: boolean;
  checkRandomSeeds: boolean;
  checkEvaluationMetrics: boolean;
}

export interface AcronymManagerSettings {
  enabled: boolean;
  checkUndefinedAcronym: boolean;
  checkDuplicateDefinition: boolean;
  checkUnusedAcronym: boolean;
  checkConflictingDefinitions: boolean;
}

export interface ErrorDoctorSettings {
  enabled: boolean;
  explainErrors: boolean;
  suggestFixes: boolean;
  autoFixCommon: boolean;
}

export interface TikzConverterSettings {
  enabled: boolean;
  autoOpen: boolean;
}

export interface ErrorFix {
  errorRegex: RegExp;
  title: string;
  explanation: string;
  getFixes: (match: RegExpExecArray, lines: string[]) => { find: string; replace: string; line: number; }[];
}
