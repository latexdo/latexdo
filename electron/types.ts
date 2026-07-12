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

export interface CreateProjectOptions {
  folderName?: string;
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

export interface DocxImportResult {
  sourcePath: string;
  relativePath: string;
  assetDirectory: string;
  mediaFiles: string[];
  converter: "pandoc" | "built-in";
  warnings: string[];
  project?: OpenProject;
}

export interface MarkdownImportResult {
  sourcePath: string;
  relativePath: string;
  converter: "pandoc" | "built-in";
  warnings: string[];
  project?: OpenProject;
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

export interface CompileRequest {
  projectId: ProjectId;
  rootFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
}

export interface AsymptoteCompileRequest {
  projectId: ProjectId;
  relativePath: string;
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
  publishedAt?: string | null;
  channel?: string | null;
  manifestUrl?: string | null;
  checkedAt?: string | null;
  error?: string;
}

export interface UpdateInstallResult extends UpdateCheckResult {
  installerPath: string | null;
  opened: boolean;
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
