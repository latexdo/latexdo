export interface ProjectEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  children?: ProjectEntry[];
  limited?: boolean;
}

export interface ProjectListOptions {
  ignoredNames?: string[];
  maxDepth?: number;
  maxEntries?: number;
}

export type ProjectId = string;

export interface OpenProject {
  id: ProjectId;
  rootPath: string;
  name: string;
}

export type CollaboratorRole = "admin" | "editor" | "viewer";

export interface CollaboratorPresence {
  clientId: string;
  name: string;
  currentFile: string | null;
  lastSeen: number;
  role?: CollaboratorRole;
}

export interface CollaborationState {
  enabled: boolean;
  token?: string;
  shareUrl?: string;
  projectId?: string;
  projectName?: string;
  users: CollaboratorPresence[];
  currentUserRole?: CollaboratorRole;
  isAdmin?: boolean;
}

export interface OpenDocument {
  path: string;
  relativePath: string;
  name: string;
  kind?: "text" | "asset";
  content: string;
  savedContent: string;
  assetMimeType?: string;
  assetDataUrl?: string;
  assetBytes?: Uint8Array;
  assetSizeBytes?: number;
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
  compilerExcerpt?: string;
  sourceLine?: string;
  source?:
    | "latex"
    | "proofread"
    | "structure-assistant"
    | "citation-assistant"
    | "pdf-compliance";
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

export type GitFileStatus =
  | "unmodified"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "untracked"
  | "conflicted";

export interface GitChangeEntry {
  path: string;
  originalPath?: string;
  indexStatus: GitFileStatus;
  worktreeStatus: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export type GitStatusEntry = GitChangeEntry;

export interface GitStatusSummary {
  isRepo: boolean;
  branch: string | null;
  repositoryRoot?: string;
  headHash?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  entries: GitStatusEntry[];
  error?: string;
}

export interface GitDiffPreview {
  path: string;
  diff: string;
}

export type GitRevisionRef =
  | { kind: "working-tree" }
  | { kind: "index" }
  | { kind: "commit"; hash: string }
  | { kind: "empty" };

export type GitDiffStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface GitDiffSession {
  id: string;
  relativePath: string;
  originalRef: GitRevisionRef;
  modifiedRef: GitRevisionRef;
  originalContent: string;
  modifiedContent: string;
  originalLabel: string;
  modifiedLabel: string;
  originalShortHash?: string;
  modifiedShortHash?: string;
  originalAuthor?: string;
  modifiedAuthor?: string;
  originalDate?: string;
  modifiedDate?: string;
  status: GitDiffStatus;
  oldPath?: string;
  language: string;
  binary?: boolean;
  tooLarge?: boolean;
  message?: string;
}

export type GitDiffEditorInput = GitDiffSession;

export interface GitDiscardResult {
  discarded: boolean;
  recoveryPatch?: string;
}

export interface GitRef {
  name: string;
  kind: "head" | "local-branch" | "remote-branch" | "tag";
  current: boolean;
}

export interface GitGraphSegment {
  fromLane: number;
  toLane: number;
  kind: "vertical" | "merge-left" | "merge-right";
}

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  refs: GitRef[];
  lane: number;
  segments: GitGraphSegment[];
  isHead: boolean;
}

export type GitCommitEntry = GitGraphCommit;

export interface GitHistorySummary {
  scope: "repo" | "file";
  target: string | null;
  commits: GitCommitEntry[];
}

export interface GitCommitDetails {
  hash: string;
  shortHash: string;
  summary: string;
  body: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  parents: string[];
  refs: GitRef[];
  changedFiles: GitCommitFile[];
}

export interface GitCommitFile {
  path: string;
  oldPath?: string;
  status: GitDiffStatus;
}

export interface GitBlameLine {
  line: number;
  hash: string;
  shortHash: string;
  author: string;
  authorTime: string;
  summary: string;
}

export interface GitChangedEvent {
  projectId: string;
  reason: "repository" | "working-tree";
}

export interface ImportedProjectEntry {
  sourcePath: string;
  relativePath: string;
  type: "file" | "directory";
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  automaticInstallAvailable?: boolean;
  publishedAt?: string | null;
  channel?: string | null;
  manifestUrl?: string | null;
  checkedAt?: string | null;
  error?: string;
}

export interface UpdateInstallResult extends UpdateCheckResult {
  installerPath: string | null;
  opened: boolean;
  restartScheduled?: boolean;
  manualDownload?: boolean;
}

export interface UpdateDownloadProgress {
  status:
    | "checking"
    | "downloading"
    | "verifying"
    | "opening"
    | "restarting"
    | "done"
    | "error";
  currentVersion: string;
  latestVersion: string | null;
  fileName: string | null;
  fileLabel: string | null;
  transferredBytes: number;
  totalBytes: number | null;
  percent: number | null;
  message?: string;
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

export interface ProofreadingRequestOptions {
  baseLine?: number;
  baseColumn?: number;
  originalTextLength?: number;
  truncated?: boolean;
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
  insertedInTex?: boolean;
}

export type DocumentHistorySource = "auto" | "manual" | "restore";

export interface DocumentHistorySnapshot {
  id: string;
  filePath: string;
  fileName: string;
  label: string;
  content?: string;
  contentPath?: string;
  contentHash?: string;
  contentSize?: number;
  preview?: string;
  timestamp: number;
  source: DocumentHistorySource;
}

export interface RebuttalItem {
  id: string;
  originalText?: string;
  revisedText?: string;
  insertedInTex?: boolean;
  reviewerComment: string;
  authorComment: string;
  modificationMade: string;
}

export type ConferenceTemplate =
  | "ieee"
  | "acm"
  | "springer"
  | "elsevier"
  | "neurips"
  | "cvpr"
  | "custom";

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
  getFixes: (
    match: RegExpExecArray,
    lines: string[],
  ) => { find: string; replace: string; line: number }[];
}

export interface NotationManagerSettings {
  enabled: boolean;
  detectSymbols: boolean;
  detectConflicts: boolean;
  detectUndefinedNotation: boolean;
}

export interface NotedSymbol {
  symbol: string;
  latex: string;
  firstUseLine: number;
  firstUseSection: string;
  defined: boolean;
  definitionLine: number | null;
  usageCount: number;
  environments: string[];
  similarSymbols: string[];
}

export interface RebuttalGeneratorSettings {
  manuscriptId: string;
  manuscriptTitle: string;
  fontSize: string;
  paperSize: string;
  fontFamily: string;
  includeDiff: boolean;
  diffOldFile: string;
  diffNewFile: string;
  diffOutput: string;
  summaryText: string;
  useOnehalfSpacing: boolean;
  colorPrimary: string;
  colorAccent: string;
}

export interface PdfComplianceSettings {
  enabled: boolean;
  checkPageCount: boolean;
  maxPages: number;
  checkUnreferencedFigures: boolean;
  checkUncitedCitations: boolean;
  checkSectionsWithNoCitations: boolean;
  checkType3Fonts: boolean;
  checkAbstractWordCount: boolean;
  maxAbstractWords: number;
}

export interface CollaboratorPermission {
  clientId: string;
  name: string;
  role: CollaboratorRole;
  isCurrent?: boolean;
}

export interface PermissionUpdate {
  clientId: string;
  role: CollaboratorRole;
}
