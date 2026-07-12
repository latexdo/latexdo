import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, watch, type FSWatcher } from "node:fs";
import {
  access,
  copyFile,
  cp,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileAsymptote, compileLatex } from "./compiler.js";
import { importDocxIntoProject } from "./docxImport.js";
import { importMarkdown } from "./markdownImport.js";
import { backwardSyncTex, forwardSyncTex } from "./synctex.js";
import { editableTextFileExtensions, readSafeTextFile } from "./textFile.js";
import type {
  Diagnostic,
  DocxImportResult,
  MarkdownImportResult,
  CompileRequest,
  AsymptoteCompileRequest,
  GitDiscardResult,
  GitRevisionRef,
  ImportedProjectEntry,
  OpenProject,
  ProofreadingResult,
  ProofreadingRequestOptions,
  ProofreadingSettings,
  ProjectListOptions,
  SpellCheckerSettings,
  UpdateCheckResult,
  UpdateInstallResult,
  CreateProjectOptions,
} from "./types.js";
import {
  getGitRepositoryContext,
  readCommitDiffSession,
  readGitBlame,
  readGitDiffPreview,
  readStructuredGitCommitDetails,
  readStructuredGitHistory,
  readStructuredGitStatus,
  readWorkingTreeDiffSession,
  repoPathForProjectPath,
  runGitText,
} from "./git.js";
import { registerTerminalIpc } from "./terminal.js";
import { listProject } from "./projectTree.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const appIconPath = path.join(currentDirectory, "..", "build", "icon.png");
const startupSmokeTest = process.argv.includes("--smoke-test");
const startupSmokeTimeoutMs = 20_000;
const extensionCatalogFetchTimeoutMs = 4_500;
const downloadsPageUrl = "https://latexdo.org/downloads/";
const downloadsManifestUrl = "https://latexdo.org/downloads/manifest.json";
const updatesFeedUrl = "https://latexdo.org/updates/latest.json";
const extensionStoreUrl = "https://store.latexdo.org/";
const extensionStoreCatalogUrl = "https://store.latexdo.org/extensions/catalog.json";
const privacyInfoUrl = "https://latexdo.org/privacy.html";
const externalUrlHosts = new Set([
  "github.com",
  "latexdo.org",
  "store.latexdo.org",
  "www.latexdo.org",
]);
const updateDownloadHosts = new Set(["github.com", "latexdo.org", "www.latexdo.org"]);
const spellCheckerSettingsFile = "spellchecker-settings.json";
const proofreadingSettingsFile = "proofreading-settings.json";
const privacyConsentFile = "privacy-consent.json";
const trustedWorkspacesFile = "trusted-workspaces.json";
const privacyConsentSchemaVersion = 1;
const trustedWorkspacesSchemaVersion = 1;
const openSpellCheckerChannel = "tools:open-spellchecker";
const openProjectChannel = "file:open-project";
const createFileChannel = "file:create-dialog";
const createFolderChannel = "folder:create-dialog";
const importDocxChannel = "file:import-docx";
const importMarkdownChannel = "file:import-markdown";
const starterDocument = String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{microtype}
\usepackage{hyperref}

\title{My LatexDo Document}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Start writing here.

\end{document}
`;

function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "EPIPE"
  );
}

function installSafeConsole(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error) => {
      if (isBrokenPipeError(error)) {
        return;
      }
      throw error;
    });
  }

  const wrapConsoleMethod =
    (method: (...data: unknown[]) => void) =>
    (...data: unknown[]) => {
      try {
        method(...data);
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error;
        }
      }
    };

  console.log = wrapConsoleMethod(console.log.bind(console));
  console.warn = wrapConsoleMethod(console.warn.bind(console));
  console.error = wrapConsoleMethod(console.error.bind(console));
}

installSafeConsole();

const openProjects = new Map<string, OpenProject>();
const activeCompileControllers = new Map<string, Set<AbortController>>();

interface GitWatchState {
  watchers: FSWatcher[];
  timer: NodeJS.Timeout | null;
  pendingReason: "repository" | "working-tree";
}

const gitWatchStates = new Map<string, GitWatchState>();

function closeGitWatchers(projectId: string): void {
  const state = gitWatchStates.get(projectId);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  for (const watcher of state.watchers) watcher.close();
  gitWatchStates.delete(projectId);
}

function emitGitChanged(
  projectId: string,
  reason: "repository" | "working-tree",
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("git:changed", { projectId, reason });
    }
  }
}

function scheduleGitChanged(
  projectId: string,
  reason: "repository" | "working-tree",
): void {
  const state = gitWatchStates.get(projectId);
  if (!state) return;
  if (reason === "repository") state.pendingReason = "repository";
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    emitGitChanged(projectId, state.pendingReason);
    state.pendingReason = "working-tree";
  }, 150);
}

function addGitWatcher(
  state: GitWatchState,
  projectId: string,
  targetPath: string,
  recursive: boolean,
  classify: (filename: string) => "repository" | "working-tree",
): boolean {
  try {
    const watcher = watch(targetPath, { recursive }, (_eventType, filename) => {
      scheduleGitChanged(projectId, classify(filename?.toString() ?? ""));
    });
    watcher.on("error", () => watcher.close());
    state.watchers.push(watcher);
    return true;
  } catch {
    return false;
  }
}

async function addGitDirectoryTreeWatchers(
  state: GitWatchState,
  projectId: string,
  directory: string,
  classify: (filename: string) => "repository" | "working-tree",
  excludedDirectoryNames: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (addGitWatcher(state, projectId, directory, true, classify)) return;
  if (!addGitWatcher(state, projectId, directory, false, classify)) return;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !excludedDirectoryNames.has(entry.name),
      )
      .map((entry) =>
        addGitDirectoryTreeWatchers(
          state,
          projectId,
          path.join(directory, entry.name),
          classify,
          excludedDirectoryNames,
        ),
      ),
  );
}

async function ensureGitWatchers(
  projectId: string,
  projectPath: string,
): Promise<void> {
  if (gitWatchStates.has(projectId)) return;
  let context;
  try {
    context = await getGitRepositoryContext(projectPath);
  } catch {
    return;
  }
  const state: GitWatchState = {
    watchers: [],
    timer: null,
    pendingReason: "working-tree",
  };
  gitWatchStates.set(projectId, state);

  const worktreeClassify = (filename: string) =>
    /(^|[/\\])\.git([/\\]|$)/.test(filename) ? "repository" : "working-tree";
  await addGitDirectoryTreeWatchers(
    state,
    projectId,
    projectPath,
    worktreeClassify,
    new Set([".git", "node_modules", "dist"]),
  );

  const watchedMetadataDirectories = new Set<string>();
  for (const directory of [context.gitDirectory, context.commonGitDirectory]) {
    if (watchedMetadataDirectories.has(directory)) continue;
    watchedMetadataDirectories.add(directory);
    await addGitDirectoryTreeWatchers(state, projectId, directory, () => "repository");
    addGitWatcher(
      state,
      projectId,
      path.join(directory, "index"),
      false,
      () => "repository",
    );
    addGitWatcher(
      state,
      projectId,
      path.join(directory, "HEAD"),
      false,
      () => "repository",
    );
    await addGitDirectoryTreeWatchers(
      state,
      projectId,
      path.join(directory, "refs"),
      () => "repository",
    );
  }
}

interface WebsiteUpdatePayload {
  schemaVersion?: unknown;
  product?: unknown;
  channel?: unknown;
  version?: unknown;
  publishedAt?: unknown;
  releaseUrl?: unknown;
  downloadsPage?: unknown;
  manifestUrl?: unknown;
  files?: unknown;
}

interface WebsiteUpdateFile {
  id: string;
  label: string;
  platform: string;
  arch: string;
  filename: string;
  url: string;
  sha256: string | null;
}

interface StoredPrivacyConsent {
  schemaVersion?: unknown;
  acceptedAt?: unknown;
  appVersion?: unknown;
  privacyInfoUrl?: unknown;
}

interface StoredTrustedWorkspaces {
  schemaVersion?: unknown;
  trustedPaths?: unknown;
}

function registerProject(rootPath: string): OpenProject {
  const resolvedRoot = path.resolve(rootPath);
  const existingProject = [...openProjects.values()].find(
    (project) => project.rootPath === resolvedRoot,
  );
  if (existingProject) {
    return existingProject;
  }

  const project: OpenProject = {
    id: randomUUID(),
    rootPath: resolvedRoot,
    name: path.basename(resolvedRoot) || resolvedRoot,
  };
  openProjects.set(project.id, project);
  return project;
}

function getProjectRoot(projectId: string): string {
  if (!projectId) {
    throw new Error("Open a project before using this action.");
  }

  const project = openProjects.get(projectId);
  if (!project) {
    throw new Error("The requested project is not open.");
  }
  return project.rootPath;
}

function trackCompileController(
  projectId: string,
  controller: AbortController,
): () => void {
  let controllers = activeCompileControllers.get(projectId);
  if (!controllers) {
    controllers = new Set();
    activeCompileControllers.set(projectId, controllers);
  }
  controllers.add(controller);

  return () => {
    controllers.delete(controller);
    if (!controllers.size) {
      activeCompileControllers.delete(projectId);
    }
  };
}

function cancelActiveCompiles(projectId: string): boolean {
  const controllers = activeCompileControllers.get(projectId);
  if (!controllers?.size) {
    return false;
  }

  for (const controller of controllers) {
    controller.abort();
  }
  return true;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(projectPath: string, targetPath: string): void {
  if (!isInside(projectPath, targetPath)) {
    throw new Error("The requested path is outside the open project.");
  }
}

function resolveProjectPath(projectPath: string, relativePath: string): string {
  const cleanPath = relativePath.trim();
  if (!cleanPath || path.isAbsolute(cleanPath)) {
    throw new Error("Enter a relative path inside the project.");
  }

  const targetPath = path.resolve(projectPath, cleanPath);
  assertInside(projectPath, targetPath);
  return targetPath;
}

function relativeProjectPath(projectPath: string, targetPath: string): string {
  assertInside(projectPath, targetPath);
  const relativePath = path.relative(projectPath, targetPath);
  return relativePath || ".";
}

function temporarySiblingPath(targetPath: string, label = "tmp"): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.${label}`,
  );
}

async function removeIfPresent(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => {});
}

async function syncParentDirectory(filePath: string): Promise<void> {
  let directoryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    directoryHandle = await open(path.dirname(filePath), "r");
    await directoryHandle.sync();
  } catch {
    // Directory fsync is best-effort and unsupported on some platforms.
  } finally {
    await directoryHandle?.close().catch(() => {});
  }
}

async function writeSyncedUtf8(filePath: string, content: string): Promise<void> {
  const fileHandle = await open(filePath, "wx");
  try {
    await fileHandle.writeFile(content, "utf8");
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }
}

async function refreshBackupFile(targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.bak`;
  const backupTempPath = temporarySiblingPath(backupPath, "bak.tmp");

  try {
    await copyFile(targetPath, backupTempPath);
    await rename(backupTempPath, backupPath);
    await syncParentDirectory(backupPath);
  } catch (error) {
    await removeIfPresent(backupTempPath);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function atomicWriteUtf8(
  targetPath: string,
  content: string,
  options: { backup?: boolean; exclusive?: boolean } = {},
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = temporarySiblingPath(targetPath);

  try {
    await writeSyncedUtf8(tempPath, content);
    if (options.backup) {
      await refreshBackupFile(targetPath);
    }

    if (options.exclusive) {
      await link(tempPath, targetPath);
      await removeIfPresent(tempPath);
    } else {
      await rename(tempPath, targetPath);
    }
    await syncParentDirectory(targetPath);
  } catch (error) {
    await removeIfPresent(tempPath);
    throw error;
  }
}

function userDataFilePath(fileName: string): string {
  return path.join(app.getPath("userData"), fileName);
}

async function readUserDataJson<T>(fileName: string): Promise<T | null> {
  try {
    const content = await readFile(userDataFilePath(fileName), "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function hasStoredPrivacyConsent(): Promise<boolean> {
  const stored = await readUserDataJson<StoredPrivacyConsent>(privacyConsentFile);
  return (
    isRecord(stored) &&
    stored.schemaVersion === privacyConsentSchemaVersion &&
    typeof stored.acceptedAt === "string"
  );
}

async function writePrivacyConsent(): Promise<void> {
  await atomicWriteUtf8(
    userDataFilePath(privacyConsentFile),
    JSON.stringify(
      {
        schemaVersion: privacyConsentSchemaVersion,
        acceptedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        privacyInfoUrl,
      },
      null,
      2,
    ),
    { backup: true },
  );
}

async function ensurePrivacyConsent(
  targetWindow: BrowserWindow | null,
): Promise<boolean> {
  if (await hasStoredPrivacyConsent()) {
    return true;
  }

  const options = {
    type: "question" as const,
    buttons: ["Agree and Continue", "View Privacy Info", "Quit"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: "LatexDo Privacy and Consent",
    message: "Review LatexDo privacy and consent",
    detail:
      "LatexDo does not currently collect personal analytics, sell user data, or track your documents.\n\n" +
      "LatexDo stores app settings, trusted folder choices, editor preferences, spell checker settings, proofreading settings, and extension choices on this device. Project files and PDFs stay on your device unless you choose a feature or external service that sends a request.\n\n" +
      "LatexDo reads and writes files only in folders you create, open, or trust. Update checks, the extension catalog, external links, downloads, and optional proofreading can contact LatexDo services or the provider you configure.\n\n" +
      "Choose Agree and Continue to consent to this use.",
  } satisfies Electron.MessageBoxOptions;

  while (true) {
    const result = targetWindow
      ? await dialog.showMessageBox(targetWindow, options)
      : await dialog.showMessageBox(options);

    if (result.response === 0) {
      await writePrivacyConsent();
      return true;
    }

    if (result.response === 1) {
      await shell.openExternal(privacyInfoUrl);
      continue;
    }

    return false;
  }
}

function normalizePathForTrust(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathIsTrustedBy(trustedPath: string, targetPath: string): boolean {
  const normalizedTrustedPath = normalizePathForTrust(trustedPath);
  const normalizedTargetPath = normalizePathForTrust(targetPath);
  const relativePath = path.relative(normalizedTrustedPath, normalizedTargetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function canonicalWorkspacePath(rootPath: string): Promise<string> {
  const resolvedRoot = path.resolve(rootPath);
  try {
    return await realpath(resolvedRoot);
  } catch {
    return resolvedRoot;
  }
}

async function readTrustedWorkspacePaths(): Promise<string[]> {
  const stored = await readUserDataJson<StoredTrustedWorkspaces>(trustedWorkspacesFile);
  if (!isRecord(stored) || !Array.isArray(stored.trustedPaths)) {
    return [];
  }

  const trustedPaths = stored.trustedPaths.filter(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "" && !value.includes("\0"),
  );
  const canonicalPaths = await Promise.all(
    trustedPaths.map((trustedPath) => canonicalWorkspacePath(trustedPath)),
  );
  return [...new Set(canonicalPaths)];
}

async function writeTrustedWorkspacePaths(trustedPaths: string[]): Promise<void> {
  await atomicWriteUtf8(
    userDataFilePath(trustedWorkspacesFile),
    JSON.stringify(
      {
        schemaVersion: trustedWorkspacesSchemaVersion,
        trustedPaths,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { backup: true },
  );
}

async function isWorkspaceTrusted(rootPath: string): Promise<boolean> {
  const canonicalRoot = await canonicalWorkspacePath(rootPath);
  const trustedPaths = await readTrustedWorkspacePaths();
  return trustedPaths.some((trustedPath) =>
    pathIsTrustedBy(trustedPath, canonicalRoot),
  );
}

async function trustWorkspace(rootPath: string): Promise<void> {
  const canonicalRoot = await canonicalWorkspacePath(rootPath);
  const trustedPaths = await readTrustedWorkspacePaths();
  if (trustedPaths.some((trustedPath) => pathIsTrustedBy(trustedPath, canonicalRoot))) {
    return;
  }
  await writeTrustedWorkspacePaths([...trustedPaths, canonicalRoot]);
}

async function ensureWorkspaceTrust(
  targetWindow: BrowserWindow | null,
  rootPath: string,
): Promise<boolean> {
  const canonicalRoot = await canonicalWorkspacePath(rootPath);
  if (await isWorkspaceTrusted(canonicalRoot)) {
    return true;
  }

  const options = {
    type: "warning" as const,
    buttons: ["Trust and Open", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Trust This Folder?",
    message: "Do you trust the authors of the files in this folder?",
    detail:
      `Folder:\n${canonicalRoot}\n\n` +
      "Trusting this folder lets LatexDo read and write files, compile LaTeX, use Git, and start integrated terminals for this workspace. Only trust folders whose contents and authors you trust.",
    checkboxLabel: "Remember trust for this folder",
    checkboxChecked: true,
  } satisfies Electron.MessageBoxOptions;

  const result = targetWindow
    ? await dialog.showMessageBox(targetWindow, options)
    : await dialog.showMessageBox(options);

  if (result.response !== 0) {
    return false;
  }

  if (result.checkboxChecked !== false) {
    await trustWorkspace(canonicalRoot);
  }

  return true;
}

async function registerProjectIfTrusted(
  targetWindow: BrowserWindow | null,
  rootPath: string,
): Promise<OpenProject | null> {
  if (!(await ensureWorkspaceTrust(targetWindow, rootPath))) {
    return null;
  }
  return registerProject(rootPath);
}

const maxProjectIdLength = 128;
const maxRelativePathLength = 4096;
const maxTextContentLength = 20 * 1024 * 1024;
const maxProofreadingContentLength = 5 * 1024 * 1024;
const MAX_PROOFREAD_CHARS = 20_000;
const maxGitCommitMessageLength = 20_000;
const maxSettingsStringLength = 2048;
const maxProjectTreeIgnoredNames = 256;
const maxProjectTreeIgnoreNameLength = 128;
const maxProjectTreeDepth = 50;
const maxProjectTreeEntries = 100_000;
const maxSyncTexNumber = 1_000_000;
const reservedProjectPathSegments = new Set([".git", "node_modules"]);
const compileEngines = new Set(["pdflatex", "xelatex", "lualatex"]);
const languageCodePattern = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const gitHashPattern = /^[0-9a-fA-F]{7,64}$/;
const invalidProjectFolderCharacters = new Set([
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
]);

function invalidIpcInput(channel: string): never {
  throw new Error(`Invalid IPC input for ${channel}.`);
}

function expectIpcArgs(
  channel: string,
  args: unknown[],
  expectedCount: number,
): unknown[] {
  if (args.length !== expectedCount) {
    invalidIpcInput(channel);
  }
  return args;
}

function expectIpcArgRange(
  channel: string,
  args: unknown[],
  minCount: number,
  maxCount: number,
): unknown[] {
  if (args.length < minCount || args.length > maxCount) {
    invalidIpcInput(channel);
  }
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function parseString(
  channel: string,
  value: unknown,
  options: {
    allowEmpty?: boolean;
    maxLength?: number;
    trim?: boolean;
    rejectControlChars?: boolean;
    rejectNullByte?: boolean;
    pattern?: RegExp;
  } = {},
): string {
  if (typeof value !== "string") {
    invalidIpcInput(channel);
  }

  const parsed = options.trim === false ? value : value.trim();
  const maxLength = options.maxLength ?? maxSettingsStringLength;
  if ((!options.allowEmpty && !parsed) || parsed.length > maxLength) {
    invalidIpcInput(channel);
  }
  if (options.rejectNullByte !== false && parsed.includes("\0")) {
    invalidIpcInput(channel);
  }
  if (options.rejectControlChars && hasControlChars(parsed)) {
    invalidIpcInput(channel);
  }
  if (options.pattern && !options.pattern.test(parsed)) {
    invalidIpcInput(channel);
  }

  return parsed;
}

function parseBoolean(channel: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidIpcInput(channel);
  }
  return value;
}

function parseInteger(
  channel: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    invalidIpcInput(channel);
  }
  return value;
}

function parseFiniteNumber(
  channel: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    invalidIpcInput(channel);
  }
  return value;
}

function parseProjectId(channel: string, value: unknown): string {
  return parseString(channel, value, {
    maxLength: maxProjectIdLength,
    rejectControlChars: true,
  });
}

function sanitizeProjectFolderName(value: string): string {
  const sanitized = value
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return invalidProjectFolderCharacters.has(character) || code < 32
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  return sanitized || "LatexDo Project";
}

function parseCreateProjectOptions(
  channel: string,
  value: unknown,
): CreateProjectOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const options: CreateProjectOptions = {};
  if (value.folderName !== undefined) {
    options.folderName = sanitizeProjectFolderName(
      parseString(channel, value.folderName, {
        maxLength: 96,
        rejectControlChars: true,
      }),
    );
  }
  return options;
}

async function availableProjectPath(
  parentPath: string,
  folderName: string,
): Promise<string> {
  for (let index = 0; index < 100; index += 1) {
    const candidateName = index === 0 ? folderName : `${folderName} ${index + 1}`;
    const candidatePath = path.join(parentPath, candidateName);
    try {
      await stat(candidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return candidatePath;
      }
      throw error;
    }
  }
  throw new Error(`Could not find an available folder named "${folderName}".`);
}

function parseRelativePath(
  channel: string,
  value: unknown,
  options: { extensions?: string[] } = {},
): string {
  const parsed = parseString(channel, value, {
    maxLength: maxRelativePathLength,
    rejectControlChars: true,
  }).replace(/\\/g, "/");

  if (
    path.isAbsolute(parsed) ||
    path.posix.isAbsolute(parsed) ||
    path.win32.isAbsolute(parsed) ||
    /^[A-Za-z]:/.test(parsed)
  ) {
    invalidIpcInput(channel);
  }

  const segments = parsed.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        reservedProjectPathSegments.has(segment),
    )
  ) {
    invalidIpcInput(channel);
  }

  if (
    options.extensions &&
    !options.extensions.includes(path.posix.extname(parsed).toLowerCase())
  ) {
    invalidIpcInput(channel);
  }

  return parsed;
}

function parseOptionalRelativePath(
  channel: string,
  value: unknown,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseRelativePath(channel, value);
}

function parseProjectListOptions(channel: string, value: unknown): ProjectListOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const ignoredNames =
    value.ignoredNames === undefined
      ? undefined
      : parseStringArray(channel, value.ignoredNames, {
          maxItems: maxProjectTreeIgnoredNames,
          maxItemLength: maxProjectTreeIgnoreNameLength,
          pattern: /^[^/\\]+$/,
        });
  if (ignoredNames?.some((name) => name === "." || name === "..")) {
    invalidIpcInput(channel);
  }

  return {
    ignoredNames,
    maxDepth:
      value.maxDepth === undefined
        ? undefined
        : parseInteger(channel, value.maxDepth, 1, maxProjectTreeDepth),
    maxEntries:
      value.maxEntries === undefined
        ? undefined
        : parseInteger(channel, value.maxEntries, 100, maxProjectTreeEntries),
  };
}

function parseTextContent(
  channel: string,
  value: unknown,
  maxLength = maxTextContentLength,
): string {
  return parseString(channel, value, {
    allowEmpty: true,
    maxLength,
    trim: false,
    rejectNullByte: true,
  });
}

function parseOptionalImportDestination(channel: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return parseRelativePath(channel, value);
}

function parseExternalSourcePaths(channel: string, value: unknown): string[] {
  const sourcePaths = parseStringArray(channel, value, {
    maxItems: 64,
    maxItemLength: 4096,
  });

  for (const sourcePath of sourcePaths) {
    if (
      (!path.isAbsolute(sourcePath) && !path.win32.isAbsolute(sourcePath)) ||
      sourcePath.includes("\0")
    ) {
      invalidIpcInput(channel);
    }
  }

  return [...new Set(sourcePaths.map((sourcePath) => path.resolve(sourcePath)))];
}

function parseStringArray(
  channel: string,
  value: unknown,
  options: { maxItems: number; maxItemLength: number; pattern?: RegExp },
): string[] {
  if (!Array.isArray(value) || value.length > options.maxItems) {
    invalidIpcInput(channel);
  }

  return value.map((item) =>
    parseString(channel, item, {
      maxLength: options.maxItemLength,
      rejectControlChars: true,
      pattern: options.pattern,
    }),
  );
}

function normalizeHttpUrl(value: string): string | null {
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseHttpUrl(channel: string, value: unknown): string {
  const raw = parseString(channel, value, {
    allowEmpty: true,
    maxLength: maxSettingsStringLength,
    rejectControlChars: true,
  });
  const normalized = normalizeHttpUrl(raw);
  if (normalized === null) {
    invalidIpcInput(channel);
  }
  return normalized;
}

function parseSpellCheckerSettingsInput(
  channel: string,
  value: unknown,
): SpellCheckerSettings {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  return {
    enabled: parseBoolean(channel, value.enabled),
    languages: parseStringArray(channel, value.languages, {
      maxItems: 64,
      maxItemLength: 32,
      pattern: languageCodePattern,
    }),
    customWords: parseStringArray(channel, value.customWords, {
      maxItems: 2000,
      maxItemLength: 128,
    }),
    availableLanguages: [],
    usesSystemLanguage: false,
  };
}

function parseProofreadingSettingsInput(
  channel: string,
  value: unknown,
): ProofreadingSettings {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const language = parseString(channel, value.language, {
    maxLength: 32,
    pattern: /^(?:auto|[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)$/,
  });
  const motherTongue = parseString(channel, value.motherTongue, {
    allowEmpty: true,
    maxLength: 32,
    rejectControlChars: true,
  });
  if (motherTongue && !languageCodePattern.test(motherTongue)) {
    invalidIpcInput(channel);
  }

  return {
    enabled: parseBoolean(channel, value.enabled),
    serverUrl: parseHttpUrl(channel, value.serverUrl),
    language,
    picky: parseBoolean(channel, value.picky),
    motherTongue,
  };
}

function parseProofreadingRequestOptions(
  channel: string,
  value: unknown,
): ProofreadingRequestOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  return {
    baseLine:
      value.baseLine === undefined
        ? undefined
        : parseInteger(channel, value.baseLine, 1, maxTextContentLength),
    baseColumn:
      value.baseColumn === undefined
        ? undefined
        : parseInteger(channel, value.baseColumn, 1, maxTextContentLength),
    originalTextLength:
      value.originalTextLength === undefined
        ? undefined
        : parseInteger(channel, value.originalTextLength, 0, maxTextContentLength),
    truncated:
      value.truncated === undefined
        ? undefined
        : parseBoolean(channel, value.truncated),
  };
}

function parseCompileRequestInput(channel: string, value: unknown): CompileRequest {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  const engine = parseString(channel, value.engine, {
    maxLength: 16,
    rejectControlChars: true,
  }) as CompileRequest["engine"];
  if (!compileEngines.has(engine)) {
    invalidIpcInput(channel);
  }

  return {
    projectId: parseProjectId(channel, value.projectId),
    rootFile: parseRelativePath(channel, value.rootFile, {
      extensions: [".tex"],
    }),
    engine,
  };
}

function parseAsymptoteCompileRequestInput(
  channel: string,
  value: unknown,
): AsymptoteCompileRequest {
  if (!isRecord(value)) {
    invalidIpcInput(channel);
  }

  return {
    projectId: parseProjectId(channel, value.projectId),
    relativePath: parseRelativePath(channel, value.relativePath, {
      extensions: [".asy"],
    }),
  };
}

function parseGitHash(channel: string, value: unknown): string {
  return parseString(channel, value, {
    maxLength: 64,
    rejectControlChars: true,
    pattern: gitHashPattern,
  });
}

function parseOptionalGitHash(channel: string, value: unknown): string | undefined {
  return value === undefined ? undefined : parseGitHash(channel, value);
}

function parseGitRevisionRef(channel: string, value: unknown): GitRevisionRef {
  if (!isRecord(value) || typeof value.kind !== "string") {
    invalidIpcInput(channel);
  }
  if (value.kind === "commit") {
    return { kind: "commit", hash: parseGitHash(channel, value.hash) };
  }
  if (
    value.kind === "working-tree" ||
    value.kind === "index" ||
    value.kind === "empty"
  ) {
    return { kind: value.kind };
  }
  invalidIpcInput(channel);
}

function starterContent(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".tex" && path.basename(relativePath) === "main.tex") {
    return starterDocument;
  }
  if (extension === ".bib") {
    return "% Add BibTeX entries here.\n";
  }
  return "";
}

function normalizeVersion(version: string): string[] {
  return version.trim().replace(/^v/i, "").split(/[.-]/).filter(Boolean);
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "0";
    const rightPart = rightParts[index] ?? "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);

    if (bothNumeric) {
      if (leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
      }
      continue;
    }

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

interface StoredSpellCheckerSettings {
  enabled?: boolean;
  languages?: string[];
  customWords?: string[];
}

interface StoredProofreadingSettings {
  enabled?: boolean;
  serverUrl?: string;
  language?: string;
  picky?: boolean;
  motherTongue?: string;
}

interface ProofreadingMatch {
  message?: string;
  offset?: number;
  length?: number;
  replacements?: Array<{ value?: string }>;
  rule?: {
    id?: string;
    issueType?: string;
    category?: { name?: string };
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeLanguageCode(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace("_", "-");
  const [language] = normalized.split("-");
  if (!language) {
    return [];
  }

  return uniqueStrings([normalized, language]);
}

function defaultSpellCheckerLanguages(availableLanguages: string[]): string[] {
  const availableSet = new Set(availableLanguages);
  const localeCandidates = [...normalizeLanguageCode(app.getLocale()), "en-US", "en"];
  const matched = localeCandidates.filter((code) => availableSet.has(code));
  if (matched.length) {
    return matched;
  }

  return availableLanguages[0] ? [availableLanguages[0]] : [];
}

async function readStoredSpellCheckerSettings(): Promise<StoredSpellCheckerSettings> {
  try {
    const filePath = path.join(app.getPath("userData"), spellCheckerSettingsFile);
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as StoredSpellCheckerSettings;

    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      languages: Array.isArray(parsed.languages)
        ? parsed.languages.filter((value): value is string => typeof value === "string")
        : [],
      customWords: Array.isArray(parsed.customWords)
        ? parsed.customWords.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    };
  } catch {
    return {
      enabled: true,
      languages: [],
      customWords: [],
    };
  }
}

async function writeStoredSpellCheckerSettings(
  settings: StoredSpellCheckerSettings,
): Promise<void> {
  const filePath = path.join(app.getPath("userData"), spellCheckerSettingsFile);
  await atomicWriteUtf8(
    filePath,
    JSON.stringify(
      {
        enabled: settings.enabled !== false,
        languages: uniqueStrings(settings.languages ?? []),
        customWords: uniqueStrings(settings.customWords ?? []),
      },
      null,
      2,
    ),
    { backup: true },
  );
}

function sanitizeSpellCheckerSettings(
  stored: StoredSpellCheckerSettings,
  availableLanguages: string[],
): SpellCheckerSettings {
  const usesSystemLanguage = process.platform === "darwin";
  const available = uniqueStrings(availableLanguages).sort((left, right) =>
    left.localeCompare(right),
  );
  const availableSet = new Set(available);
  const requestedLanguages = uniqueStrings(stored.languages ?? []).filter((code) =>
    availableSet.has(code),
  );

  return {
    enabled: stored.enabled !== false,
    languages: usesSystemLanguage
      ? []
      : requestedLanguages.length
        ? requestedLanguages
        : defaultSpellCheckerLanguages(available),
    customWords: uniqueStrings(stored.customWords ?? []),
    availableLanguages: available,
    usesSystemLanguage,
  };
}

async function getSpellCheckerSettings(
  targetWindow?: BrowserWindow | null,
): Promise<SpellCheckerSettings> {
  const window =
    targetWindow ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0] ??
    null;
  const availableLanguages =
    window && process.platform !== "darwin"
      ? window.webContents.session.availableSpellCheckerLanguages
      : [];
  const stored = await readStoredSpellCheckerSettings();
  return sanitizeSpellCheckerSettings(stored, availableLanguages);
}

function applySpellCheckerSettings(
  targetWindow: BrowserWindow,
  settings: SpellCheckerSettings,
): void {
  const { session } = targetWindow.webContents;
  session.setSpellCheckerEnabled(settings.enabled);

  if (!settings.usesSystemLanguage) {
    session.setSpellCheckerLanguages(settings.languages);
  }

  for (const word of settings.customWords) {
    session.addWordToSpellCheckerDictionary(word);
  }
}

async function syncSpellCheckerSettings(
  targetWindow: BrowserWindow,
): Promise<SpellCheckerSettings> {
  const settings = await getSpellCheckerSettings(targetWindow);
  applySpellCheckerSettings(targetWindow, settings);
  return settings;
}

async function updateSpellCheckerSettings(
  nextSettings: SpellCheckerSettings,
): Promise<SpellCheckerSettings> {
  const referenceWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const availableLanguages =
    referenceWindow && process.platform !== "darwin"
      ? referenceWindow.webContents.session.availableSpellCheckerLanguages
      : [];
  const sanitized = sanitizeSpellCheckerSettings(
    {
      enabled: nextSettings.enabled,
      languages: nextSettings.languages,
      customWords: nextSettings.customWords,
    },
    availableLanguages,
  );

  await writeStoredSpellCheckerSettings({
    enabled: sanitized.enabled,
    languages: sanitized.languages,
    customWords: sanitized.customWords,
  });

  for (const window of BrowserWindow.getAllWindows()) {
    applySpellCheckerSettings(window, sanitized);
  }

  return sanitized;
}

async function addSpellCheckerWord(word: string): Promise<SpellCheckerSettings> {
  const current = await getSpellCheckerSettings();
  return updateSpellCheckerSettings({
    ...current,
    customWords: uniqueStrings([...current.customWords, word]),
  });
}

function defaultProofreadingSettings(): ProofreadingSettings {
  return {
    enabled: true,
    serverUrl: "https://api.languagetool.org/v2/check",
    language: "auto",
    picky: false,
    motherTongue: "",
  };
}

async function readStoredProofreadingSettings(): Promise<StoredProofreadingSettings> {
  try {
    const filePath = path.join(app.getPath("userData"), proofreadingSettingsFile);
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as StoredProofreadingSettings;
    return parsed ?? {};
  } catch {
    return {};
  }
}

async function writeStoredProofreadingSettings(
  settings: ProofreadingSettings,
): Promise<void> {
  const filePath = path.join(app.getPath("userData"), proofreadingSettingsFile);
  await atomicWriteUtf8(filePath, JSON.stringify(settings, null, 2), {
    backup: true,
  });
}

function sanitizeProofreadingSettings(
  stored: StoredProofreadingSettings,
): ProofreadingSettings {
  const defaults = defaultProofreadingSettings();
  const serverUrl = typeof stored.serverUrl === "string" ? stored.serverUrl.trim() : "";
  const language = typeof stored.language === "string" ? stored.language.trim() : "";
  const motherTongue =
    typeof stored.motherTongue === "string" ? stored.motherTongue.trim() : "";
  const normalizedServerUrl = normalizeHttpUrl(serverUrl);

  return {
    enabled: stored.enabled !== false,
    serverUrl: normalizedServerUrl || defaults.serverUrl,
    language:
      language === "auto" || languageCodePattern.test(language)
        ? language
        : defaults.language,
    picky: typeof stored.picky === "boolean" ? stored.picky : defaults.picky,
    motherTongue: languageCodePattern.test(motherTongue) ? motherTongue : "",
  };
}

async function getProofreadingSettings(): Promise<ProofreadingSettings> {
  return sanitizeProofreadingSettings(await readStoredProofreadingSettings());
}

async function updateProofreadingSettings(
  settings: ProofreadingSettings,
): Promise<ProofreadingSettings> {
  const sanitized = sanitizeProofreadingSettings(settings);
  await writeStoredProofreadingSettings(sanitized);
  return sanitized;
}

function replaceRangeWithSpaces(source: string, start: number, end: number): string {
  return source.slice(start, end).replace(/[^\n]/g, " ");
}

function sanitizeLatexForProofreading(source: string): string {
  const ignoredArgumentCommands = new Set([
    "cite",
    "citet",
    "citep",
    "parencite",
    "textcite",
    "ref",
    "cref",
    "Cref",
    "autoref",
    "pageref",
    "eqref",
    "label",
    "url",
    "href",
    "includegraphics",
    "bibliography",
    "bibliographystyle",
    "usepackage",
    "documentclass",
    "input",
    "include",
    "begin",
    "end",
    "bibliographystyle",
  ]);

  let sanitized = source;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "%" && source[index - 1] !== "\\") {
      let end = index;
      while (end < source.length && source[end] !== "\n") {
        end += 1;
      }
      sanitized =
        sanitized.slice(0, index) +
        replaceRangeWithSpaces(source, index, end) +
        sanitized.slice(end);
      index = end;
      continue;
    }

    if (char === "$") {
      const doubleMath = next === "$";
      const closeToken = doubleMath ? "$$" : "$";
      let end = index + closeToken.length;

      while (end < source.length) {
        if (source.startsWith(closeToken, end) && source[end - 1] !== "\\") {
          end += closeToken.length;
          break;
        }
        end += 1;
      }

      if (end > index) {
        sanitized =
          sanitized.slice(0, index) +
          replaceRangeWithSpaces(source, index, end) +
          sanitized.slice(end);
        index = end;
        continue;
      }
    }

    if (source.startsWith("\\(", index) || source.startsWith("\\[", index)) {
      const closeToken = source[index + 1] === "(" ? "\\)" : "\\]";
      let end = index + 2;
      while (end < source.length && !source.startsWith(closeToken, end)) {
        end += 1;
      }
      end = Math.min(source.length, end + 2);
      sanitized =
        sanitized.slice(0, index) +
        replaceRangeWithSpaces(source, index, end) +
        sanitized.slice(end);
      index = end;
      continue;
    }

    if (char === "\\") {
      let commandEnd = index + 1;
      while (commandEnd < source.length && /[A-Za-z*@]/.test(source[commandEnd]!)) {
        commandEnd += 1;
      }
      const command = source.slice(index + 1, commandEnd);
      if (!command) {
        index += 1;
        continue;
      }

      sanitized =
        sanitized.slice(0, index) +
        replaceRangeWithSpaces(source, index, commandEnd) +
        sanitized.slice(commandEnd);

      if (ignoredArgumentCommands.has(command)) {
        let pointer = commandEnd;
        while (pointer < source.length && /\s/.test(source[pointer]!)) {
          pointer += 1;
        }

        for (let groups = 0; groups < 2 && pointer < source.length; groups += 1) {
          if (source[pointer] === "[") {
            let depth = 1;
            let end = pointer + 1;
            while (end < source.length && depth > 0) {
              if (source[end] === "[") depth += 1;
              else if (source[end] === "]") depth -= 1;
              end += 1;
            }
            sanitized =
              sanitized.slice(0, pointer) +
              replaceRangeWithSpaces(source, pointer, end) +
              sanitized.slice(end);
            pointer = end;
            while (pointer < source.length && /\s/.test(source[pointer]!)) {
              pointer += 1;
            }
          }

          if (source[pointer] === "{") {
            let depth = 1;
            let end = pointer + 1;
            while (end < source.length && depth > 0) {
              if (source[end] === "{") depth += 1;
              else if (source[end] === "}") depth -= 1;
              end += 1;
            }
            sanitized =
              sanitized.slice(0, pointer) +
              replaceRangeWithSpaces(source, pointer, end) +
              sanitized.slice(end);
            pointer = end;
            while (pointer < source.length && /\s/.test(source[pointer]!)) {
              pointer += 1;
            }
          }
        }
      }

      index = commandEnd;
      continue;
    }

    index += 1;
  }

  return sanitized;
}

function offsetToLocation(
  source: string,
  offset: number,
  baseLine = 1,
  baseColumn = 1,
): {
  line: number;
  column: number;
} {
  let line = baseLine;
  let column = baseColumn;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function mapProofreadingMatch(
  relativePath: string,
  source: string,
  match: ProofreadingMatch,
  options: ProofreadingRequestOptions = {},
): Diagnostic | null {
  const offset = typeof match.offset === "number" ? match.offset : -1;
  const length = typeof match.length === "number" ? Math.max(1, match.length) : 1;
  if (offset < 0 || offset >= source.length) {
    return null;
  }

  const baseLine = options.baseLine ?? 1;
  const baseColumn = options.baseColumn ?? 1;
  const start = offsetToLocation(source, offset, baseLine, baseColumn);
  const end = offsetToLocation(
    source,
    Math.min(source.length, offset + length),
    baseLine,
    baseColumn,
  );
  const replacements = uniqueStrings(
    (match.replacements ?? [])
      .map((replacement) => replacement.value ?? "")
      .slice(0, 5),
  );
  const category = match.rule?.category?.name;
  const ruleId = match.rule?.id;

  return {
    file: relativePath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    severity: "warning",
    message: category
      ? `${match.message ?? "Proofreading suggestion"} (${category})`
      : (match.message ?? "Proofreading suggestion"),
    source: "proofread",
    code: ruleId,
    replacements,
  };
}

async function proofreadDocument(
  relativePath: string,
  content: string,
  options: ProofreadingRequestOptions = {},
): Promise<ProofreadingResult> {
  const settings = await getProofreadingSettings();
  if (!settings.enabled) {
    return {
      diagnostics: [],
      output: "Proofreading is disabled.",
      checkedTextLength: 0,
    };
  }

  const sanitizedText = relativePath.endsWith(".tex")
    ? sanitizeLatexForProofreading(content)
    : content;
  const payloadWasLimited =
    sanitizedText.length > MAX_PROOFREAD_CHARS || Boolean(options.truncated);
  const limitedText =
    sanitizedText.length > MAX_PROOFREAD_CHARS
      ? sanitizedText.slice(0, MAX_PROOFREAD_CHARS)
      : sanitizedText;
  const textForCheck = limitedText.replace(/[ \t]+\n/g, "\n");
  if (!textForCheck.trim()) {
    return {
      diagnostics: [],
      output: "No natural-language text found to proofread.",
      checkedTextLength: 0,
    };
  }

  const payload = new URLSearchParams();
  payload.set("text", limitedText);
  payload.set("language", settings.language || "auto");
  if (settings.motherTongue) {
    payload.set("motherTongue", settings.motherTongue);
  }
  if (settings.picky) {
    payload.set("level", "picky");
  }

  try {
    const response = await fetch(settings.serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: payload.toString(),
    });

    if (!response.ok) {
      throw new Error(`Proofreading failed (${response.status})`);
    }

    const result = (await response.json()) as { matches?: ProofreadingMatch[] };
    const diagnostics = (result.matches ?? [])
      .map((match) => mapProofreadingMatch(relativePath, content, match, options))
      .filter((diagnostic): diagnostic is Diagnostic => diagnostic !== null);
    const checkedTextLength = limitedText.trim().length;
    const limitMessage = payloadWasLimited
      ? ` Checked ${checkedTextLength.toLocaleString()} characters from the current document chunk (limit ${MAX_PROOFREAD_CHARS.toLocaleString()}).`
      : "";
    const baseOutput = diagnostics.length
      ? `Found ${diagnostics.length} writing suggestion${diagnostics.length === 1 ? "" : "s"}.`
      : "No grammar or style suggestions found.";

    return {
      diagnostics,
      output: `${baseOutput}${limitMessage}`,
      checkedTextLength,
    };
  } catch (error) {
    return {
      diagnostics: [],
      output: "Proofreading could not reach the grammar service.",
      checkedTextLength: limitedText.trim().length,
      error: error instanceof Error ? error.message : "Proofreading failed",
    };
  }
}

function showSpellCheckerMenu(): void {
  const targetWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  targetWindow?.webContents.send(openSpellCheckerChannel);
}

function installSpellCheckerContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.dictionarySuggestions.length) {
      template.push(
        ...params.dictionarySuggestions.slice(0, 6).map((suggestion) => ({
          label: suggestion,
          click: () => {
            window.webContents.replaceMisspelling(suggestion);
          },
        })),
      );
    }

    if (params.misspelledWord) {
      if (template.length) {
        template.push({ type: "separator" });
      }
      template.push({
        label: `Add "${params.misspelledWord}" to Dictionary`,
        click: () => {
          void addSpellCheckerWord(params.misspelledWord);
        },
      });
    }

    if (params.isEditable) {
      if (template.length) {
        template.push({ type: "separator" });
      }
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      );
    } else if (params.selectionText.trim()) {
      if (template.length) {
        template.push({ type: "separator" });
      }
      template.push({ role: "copy" });
    }

    if (!template.length) {
      return;
    }

    Menu.buildFromTemplate(template).popup({ window });
  });
}

function buildApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder...",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(openProjectChannel);
          },
        },
        {
          label: "New File...",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(createFileChannel);
          },
        },
        {
          label: "New Folder...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(createFolderChannel);
          },
        },
        {
          label: "Import DOCX...",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(importDocxChannel);
          },
        },
        {
          label: "Import Markdown...",
          accelerator: "CmdOrCtrl+Shift+M",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(importMarkdownChannel);
          },
        },
        { type: "separator" },
        { role: "close" },
        ...(process.platform === "darwin"
          ? []
          : ([{ type: "separator" }, { role: "quit" }] as const)),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? ([{ type: "separator" }, { role: "front" }] as const)
          : ([{ role: "close" }] as const)),
      ],
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Spell Checker...",
          accelerator: "CmdOrCtrl+Alt+S",
          click: () => {
            showSpellCheckerMenu();
          },
        },
        {
          label: "Writing Tools...",
          click: () => {
            showSpellCheckerMenu();
          },
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Report an Issue",
          click: () => {
            void shell.openExternal("https://github.com/latexdo/latexdo/issues/new");
          },
        },
        { type: "separator" },
        {
          label: "Check for Updates",
          click: () => {
            void shell.openExternal(downloadsPageUrl);
          },
        },
        {
          label: "LatexDo Downloads",
          click: () => {
            void shell.openExternal(downloadsPageUrl);
          },
        },
        {
          label: "LatexDo Store",
          click: () => {
            void shell.openExternal(extensionStoreUrl);
          },
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function payloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeDownloadsUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxSettingsStringLength
  ) {
    return downloadsPageUrl;
  }

  try {
    const url = new URL(value.trim());
    if (
      url.protocol === "https:" &&
      url.hostname === "latexdo.org" &&
      url.pathname.startsWith("/downloads/")
    ) {
      return url.href;
    }
  } catch {
    return downloadsPageUrl;
  }

  return downloadsPageUrl;
}

function safeExternalUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxSettingsStringLength
  ) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && externalUrlHosts.has(url.hostname)) {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

function safeUpdateDownloadUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxSettingsStringLength
  ) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && updateDownloadHosts.has(url.hostname)) {
      return url.href;
    }
  } catch {
    return null;
  }

  return null;
}

function safeUpdateFilename(value: unknown): string | null {
  const filename = payloadString(value);
  if (
    !filename ||
    filename.length > 180 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename
      .split("")
      .some(
        (character) => character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character),
      ) ||
    filename.startsWith(".")
  ) {
    return null;
  }

  return filename;
}

function updateFileFromPayload(value: unknown): WebsiteUpdateFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = payloadString(record.id);
  const label = payloadString(record.label);
  const platform = payloadString(record.platform);
  const arch = payloadString(record.arch);
  const filename = safeUpdateFilename(record.filename);
  const url = safeUpdateDownloadUrl(record.url);
  const sha256 = payloadString(record.sha256);

  if (!id || !label || !platform || !arch || !filename || !url) {
    return null;
  }

  return {
    id,
    label,
    platform,
    arch,
    filename,
    url,
    sha256: sha256 && /^[a-f0-9]{64}$/i.test(sha256) ? sha256.toLowerCase() : null,
  };
}

function updateFilesFromPayload(value: unknown): WebsiteUpdateFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((file) => updateFileFromPayload(file))
    .filter((file): file is WebsiteUpdateFile => file !== null);
}

function currentUpdatePlatform(): string {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return process.platform;
}

function currentUpdateArch(): string {
  if (process.arch === "x64" || process.arch === "arm64") {
    return process.arch;
  }

  return process.arch;
}

function selectUpdateFile(files: WebsiteUpdateFile[]): WebsiteUpdateFile | null {
  const platform = currentUpdatePlatform();
  const arch = currentUpdateArch();

  return (
    files.find((file) => file.platform === platform && file.arch === arch) ??
    files.find((file) => file.platform === platform) ??
    null
  );
}

function updateResultFromWebsitePayload(
  payload: WebsiteUpdatePayload,
  currentVersion: string,
): UpdateCheckResult {
  if (payload.schemaVersion !== 1 || payload.product !== "LatexDo") {
    throw new Error("Website update payload is not a LatexDo update feed.");
  }

  const latestVersion = payloadString(payload.version)?.replace(/^v/i, "") ?? null;
  if (!latestVersion) {
    throw new Error("No website update version found.");
  }

  const releaseUrl =
    payloadString(payload.releaseUrl) ??
    payloadString(payload.downloadsPage) ??
    downloadsPageUrl;
  return {
    currentVersion,
    latestVersion,
    releaseUrl,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    publishedAt: payloadString(payload.publishedAt),
    channel: payloadString(payload.channel),
    manifestUrl: payloadString(payload.manifestUrl) ?? downloadsManifestUrl,
    checkedAt: new Date().toISOString(),
  };
}

async function fetchWebsiteUpdateJson(
  url: string,
  headers: Record<string, string>,
): Promise<WebsiteUpdatePayload> {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return (await response.json()) as WebsiteUpdatePayload;
}

async function fetchExtensionStoreCatalogJson(): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), extensionCatalogFetchTimeoutMs);

  try {
    const response = await fetch(extensionStoreCatalogUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": `latexdo/${app.getVersion()}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Store catalog returned HTTP ${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWebsiteUpdatePayload(
  url: string,
  currentVersion: string,
  headers: Record<string, string>,
): Promise<UpdateCheckResult> {
  return updateResultFromWebsitePayload(
    await fetchWebsiteUpdateJson(url, headers),
    currentVersion,
  );
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const requestHeaders = {
    Accept: "application/json",
    "User-Agent": `latexdo/${currentVersion}`,
  };
  const errors: string[] = [];

  for (const url of [updatesFeedUrl, downloadsManifestUrl]) {
    try {
      return await fetchWebsiteUpdatePayload(url, currentVersion, requestHeaders);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    currentVersion,
    latestVersion: null,
    releaseUrl: downloadsPageUrl,
    updateAvailable: false,
    manifestUrl: downloadsManifestUrl,
    checkedAt: new Date().toISOString(),
    error: errors.join(" ") || "Update check failed",
  };
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function uniqueDownloadPath(filename: string): Promise<string> {
  const downloadsDirectory = app.getPath("downloads");
  const parsed = path.parse(filename);

  for (let index = 0; index < 100; index += 1) {
    const candidateName =
      index === 0 ? filename : `${parsed.name} (${index.toString()})${parsed.ext}`;
    const candidate = path.join(downloadsDirectory, candidateName);

    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }

  throw new Error("Could not choose a download path for the update installer.");
}

async function downloadUpdateInstaller(
  file: WebsiteUpdateFile,
  currentVersion: string,
): Promise<string> {
  const response = await fetch(file.url, {
    headers: {
      "User-Agent": `latexdo/${currentVersion}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Update installer download returned ${response.status}.`);
  }
  if (!response.body) {
    throw new Error("Update installer download did not include a response body.");
  }

  const temporaryPath = path.join(
    app.getPath("temp"),
    `latexdo-update-${randomUUID()}-${file.filename}.download`,
  );

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      createWriteStream(temporaryPath, { flags: "wx" }),
    );

    if (file.sha256) {
      const actualSha256 = await sha256File(temporaryPath);
      if (actualSha256 !== file.sha256) {
        throw new Error("Downloaded update installer failed checksum verification.");
      }
    }

    const installerPath = await uniqueDownloadPath(file.filename);
    await rename(temporaryPath, installerPath);
    return installerPath;
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function updateNow(): Promise<UpdateInstallResult> {
  const currentVersion = app.getVersion();
  const requestHeaders = {
    Accept: "application/json",
    "User-Agent": `latexdo/${currentVersion}`,
  };
  const errors: string[] = [];

  for (const url of [updatesFeedUrl, downloadsManifestUrl]) {
    try {
      const payload = await fetchWebsiteUpdateJson(url, requestHeaders);
      const result = updateResultFromWebsitePayload(payload, currentVersion);

      if (!result.updateAvailable) {
        return {
          ...result,
          installerPath: null,
          opened: false,
        };
      }

      const updateFile = selectUpdateFile(updateFilesFromPayload(payload.files));
      if (!updateFile) {
        throw new Error(
          `No LatexDo ${result.latestVersion ?? "update"} installer is available for ${currentUpdatePlatform()} ${currentUpdateArch()}.`,
        );
      }

      const installerPath = await downloadUpdateInstaller(updateFile, currentVersion);
      const openError = await shell.openPath(installerPath);
      if (openError) {
        throw new Error(
          `Downloaded update installer but could not open it: ${openError}`,
        );
      }

      return {
        ...result,
        installerPath,
        opened: true,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.join(" ") || "Update failed.");
}

async function availableImportRelativePath(
  channel: string,
  projectPath: string,
  destinationDirectory: string,
  sourceName: string,
): Promise<string> {
  const parsed = path.posix.parse(sourceName.replaceAll("\\", "/"));

  for (let index = 0; index < 100; index += 1) {
    const candidateName =
      index === 0 ? sourceName : `${parsed.name} ${index + 1}${parsed.ext}`;
    const candidateRelativePath = destinationDirectory
      ? path.posix.join(destinationDirectory, candidateName)
      : candidateName;
    const validatedRelativePath = parseRelativePath(channel, candidateRelativePath);
    const candidatePath = resolveProjectPath(projectPath, validatedRelativePath);

    try {
      await stat(candidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return validatedRelativePath;
      }
      throw error;
    }
  }

  throw new Error(`Could not choose an available path for "${sourceName}".`);
}

async function importExternalFilesIntoProject(
  channel: string,
  projectPath: string,
  destinationDirectory: string,
  sourcePaths: string[],
): Promise<ImportedProjectEntry[]> {
  const destinationRoot = destinationDirectory
    ? resolveProjectPath(projectPath, destinationDirectory)
    : projectPath;
  const destinationStats = await stat(destinationRoot).catch(() => null);
  if (!destinationStats?.isDirectory()) {
    throw new Error("Drop files onto an existing project folder.");
  }

  const imported: ImportedProjectEntry[] = [];
  for (const sourcePath of sourcePaths) {
    const sourceStats = await stat(sourcePath).catch(() => null);
    if (!sourceStats || (!sourceStats.isFile() && !sourceStats.isDirectory())) {
      continue;
    }

    const sourceName = path.basename(sourcePath);
    const relativePath = await availableImportRelativePath(
      channel,
      projectPath,
      destinationDirectory,
      sourceName,
    );
    const targetPath = resolveProjectPath(projectPath, relativePath);

    if (sourceStats.isDirectory()) {
      if (isInside(sourcePath, targetPath)) {
        throw new Error("Cannot import a folder into itself.");
      }
      await cp(sourcePath, targetPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: true,
      });
    } else {
      await copyFile(sourcePath, targetPath);
    }

    imported.push({
      sourcePath,
      relativePath: relativeProjectPath(projectPath, targetPath),
      type: sourceStats.isDirectory() ? "directory" : "file",
    });
  }

  return imported;
}

function gitRecoveryTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function gitRecoveryScopeLabel(relativePath?: string): string {
  const label = (relativePath ?? "all")
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return label || "changes";
}

async function confirmGitDiscard(
  targetWindow: BrowserWindow | null,
  message: string,
): Promise<boolean> {
  const options = {
    type: "warning" as const,
    buttons: ["Cancel", "Discard changes"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message,
    detail:
      "LatexDo will save recovery data in .latexdo/recovery before discarding changes.",
  };
  const result = targetWindow
    ? await dialog.showMessageBox(targetWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function createGitDiscardRecoveryPatch(
  projectPath: string,
  relativePath?: string,
): Promise<string | undefined> {
  const context = await getGitRepositoryContext(projectPath);
  const args = ["diff", "--binary", "--no-ext-diff"];
  if (relativePath) {
    args.push("--", repoPathForProjectPath(context, relativePath));
  } else {
    args.push("--", context.projectPrefix || ".");
  }

  const stdout = await runGitText(context.repositoryRoot, args, {
    maxBytes: 100 * 1024 * 1024,
  });
  if (!stdout.trim()) {
    return undefined;
  }

  const recoveryDirectory = resolveProjectPath(projectPath, ".latexdo/recovery");
  const patchPath = path.join(
    recoveryDirectory,
    `discard-${gitRecoveryTimestamp()}-${gitRecoveryScopeLabel(
      relativePath,
    )}-${randomUUID().slice(0, 8)}.patch`,
  );
  await atomicWriteUtf8(patchPath, stdout, { exclusive: true });
  return relativeProjectPath(projectPath, patchPath);
}

async function createGitUntrackedRecoveryCopy(
  projectPath: string,
  relativePath: string,
  targetPath: string,
): Promise<string> {
  const recoveryDirectory = resolveProjectPath(projectPath, ".latexdo/recovery");
  const extension = path.extname(relativePath);
  const recoveryPath = path.join(
    recoveryDirectory,
    `discard-${gitRecoveryTimestamp()}-${gitRecoveryScopeLabel(
      relativePath,
    )}-${randomUUID().slice(0, 8)}${extension || ".backup"}`,
  );
  await mkdir(recoveryDirectory, { recursive: true });
  await copyFile(targetPath, recoveryPath);
  return relativeProjectPath(projectPath, recoveryPath);
}

async function gitAdd(projectPath: string, relativePath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  await runGitText(context.repositoryRoot, [
    "add",
    "--",
    repoPathForProjectPath(context, relativePath),
  ]);
}

async function gitUnstage(projectPath: string, relativePath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  const repoPath = repoPathForProjectPath(context, relativePath);
  try {
    await runGitText(context.repositoryRoot, ["restore", "--staged", "--", repoPath]);
  } catch {
    await runGitText(context.repositoryRoot, ["reset", "HEAD", "--", repoPath]);
  }
}

async function gitCommit(projectPath: string, message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Enter a commit message.");
  }

  const context = await getGitRepositoryContext(projectPath);
  await runGitText(context.repositoryRoot, ["commit", "-m", trimmed]);
}

async function gitDiscard(
  projectPath: string,
  relativePath: string,
): Promise<GitDiscardResult> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
  const status = await readStructuredGitStatus(projectPath);
  const entry = status.entries.find((candidate) => candidate.path === relativePath);
  const recoveryPatch = entry?.untracked
    ? await createGitUntrackedRecoveryCopy(projectPath, relativePath, targetPath)
    : await createGitDiscardRecoveryPatch(projectPath, relativePath);
  if (entry?.untracked) {
    await unlink(targetPath);
    return { discarded: true, recoveryPatch };
  }
  const context = await getGitRepositoryContext(projectPath);
  const repoPath = repoPathForProjectPath(context, relativePath);
  try {
    await runGitText(context.repositoryRoot, ["restore", "--worktree", "--", repoPath]);
  } catch {
    await runGitText(context.repositoryRoot, ["checkout", "--", repoPath]);
  }
  return {
    discarded: true,
    recoveryPatch,
  };
}

async function gitStageAll(projectPath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  await runGitText(context.repositoryRoot, [
    "add",
    "--all",
    "--",
    context.projectPrefix || ".",
  ]);
}

async function gitUnstageAll(projectPath: string): Promise<void> {
  const context = await getGitRepositoryContext(projectPath);
  const scope = context.projectPrefix || ".";
  try {
    await runGitText(context.repositoryRoot, ["restore", "--staged", "--", scope]);
  } catch {
    await runGitText(context.repositoryRoot, ["reset", "HEAD", "--", scope]);
  }
}

async function gitDiscardAll(projectPath: string): Promise<GitDiscardResult> {
  const recoveryPatch = await createGitDiscardRecoveryPatch(projectPath);
  const context = await getGitRepositoryContext(projectPath);
  const scope = context.projectPrefix || ".";
  try {
    await runGitText(context.repositoryRoot, ["restore", "--worktree", "--", scope]);
  } catch {
    await runGitText(context.repositoryRoot, ["checkout", "--", scope]);
  }
  return {
    discarded: true,
    recoveryPatch,
  };
}

function createWindow(): BrowserWindow {
  console.log("[latexdo] createWindow:start");
  nativeTheme.themeSource = "dark";
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "LatexDo",
    icon: appIconPath,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  console.log("[latexdo] createWindow:created");

  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  window.webContents.once("did-finish-load", () => {
    console.log("[latexdo] createWindow:did-finish-load");
    installSpellCheckerContextMenu(window);
    void syncSpellCheckerSettings(window).catch((error) => {
      console.error("Failed to initialize spell checker", error);
    });
  });

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void window.loadFile(path.join(currentDirectory, "..", "dist", "index.html"));
  }

  return window;
}

function waitForRendererLoad(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoadingMainFrame()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Renderer did not finish loading before the timeout."));
    }, startupSmokeTimeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      window.webContents.off("did-finish-load", handleFinish);
      window.webContents.off("did-fail-load", handleFailure);
    };

    const handleFinish = () => {
      cleanup();
      resolve();
    };

    const handleFailure = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
    ) => {
      cleanup();
      reject(
        new Error(
          `Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`,
        ),
      );
    };

    window.webContents.once("did-finish-load", handleFinish);
    window.webContents.once("did-fail-load", handleFailure);
  });
}

async function runStartupSmokeTest(window: BrowserWindow): Promise<void> {
  await waitForRendererLoad(window);

  const result = (await window.webContents.executeJavaScript(`
    (() => {
      const root = document.getElementById("root");
      return {
        title: document.title,
        rootChildCount: root?.childElementCount ?? 0,
        hasLatexDoText: document.body?.innerText?.includes("LatexDo") ?? false,
      };
    })()
  `)) as { title?: string; rootChildCount?: number; hasLatexDoText?: boolean };

  if (
    result.title !== "LatexDo" ||
    !result.rootChildCount ||
    result.hasLatexDoText !== true
  ) {
    throw new Error(`Renderer smoke test failed: ${JSON.stringify(result)}`);
  }

  console.log("[latexdo] packaged startup smoke test passed", result);
}

app.whenReady().then(async () => {
  console.log("[latexdo] app:ready");
  if (process.platform === "darwin") {
    app.dock.setIcon(appIconPath);
  }
  registerTerminalIpc({ getProjectRoot });
  console.log("[latexdo] app:terminal-registered");
  buildApplicationMenu();
  console.log("[latexdo] app:menu-built");
  ipcMain.handle("project:open", async (event, ...rawArgs: unknown[]) => {
    const channel = "project:open";
    expectIpcArgs(channel, rawArgs, 0);
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Open LaTeX project",
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return registerProjectIfTrusted(window, result.filePaths[0]);
  });
  ipcMain.handle("project:create", async (_event, ...rawArgs: unknown[]) => {
    const channel = "project:create";
    const [rawOptions] = expectIpcArgRange(channel, rawArgs, 0, 1);
    const options = parseCreateProjectOptions(channel, rawOptions);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: options.folderName
        ? `Choose where to create ${options.folderName}`
        : "Choose a folder for the new LaTeX project",
      buttonLabel: options.folderName ? "Create Here" : "Create Project",
      defaultPath: app.getPath("documents"),
    });
    if (result.canceled) {
      return null;
    }

    const projectPath = options.folderName
      ? await availableProjectPath(result.filePaths[0], options.folderName)
      : result.filePaths[0];
    await mkdir(projectPath, { recursive: !options.folderName });
    try {
      await atomicWriteUtf8(path.join(projectPath, "main.tex"), starterDocument, {
        exclusive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          "Choose a folder without an existing main.tex, or open that folder instead.",
        );
      }
      throw error;
    }
    await trustWorkspace(projectPath);
    return registerProject(projectPath);
  });
  ipcMain.handle("project:list", async (_event, ...rawArgs: unknown[]) => {
    const channel = "project:list";
    const [rawProjectId, rawOptions] = expectIpcArgRange(channel, rawArgs, 1, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const options = parseProjectListOptions(channel, rawOptions);
    const projectPath = getProjectRoot(projectId);
    return listProject(projectPath, options);
  });
  ipcMain.handle("file:exists", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:exists";
    const [rawProjectId, rawFilePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath);
    const projectPath = getProjectRoot(projectId);
    const resolvedPath = resolveProjectPath(projectPath, filePath);
    try {
      await access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("file:read", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:read";
    const [rawProjectId, rawFilePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath, {
      extensions: [...editableTextFileExtensions],
    });
    const projectPath = getProjectRoot(projectId);
    const resolvedPath = resolveProjectPath(projectPath, filePath);
    return readSafeTextFile(projectPath, resolvedPath, filePath);
  });
  ipcMain.handle("asset:read", async (_event, ...rawArgs: unknown[]) => {
    const channel = "asset:read";
    const [rawProjectId, rawFilePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath, {
      extensions: [".png", ".jpg", ".jpeg", ".svg", ".pdf"],
    });
    const projectPath = getProjectRoot(projectId);
    const resolvedPath = resolveProjectPath(projectPath, filePath);
    return readFile(resolvedPath);
  });
  ipcMain.handle("file:write", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:write";
    const [rawProjectId, rawFilePath, rawContent] = expectIpcArgs(channel, rawArgs, 3);
    const projectId = parseProjectId(channel, rawProjectId);
    const filePath = parseRelativePath(channel, rawFilePath);
    const content = parseTextContent(channel, rawContent);
    const projectPath = getProjectRoot(projectId);
    const resolvedPath = resolveProjectPath(projectPath, filePath);
    await atomicWriteUtf8(resolvedPath, content, { backup: true });
  });
  ipcMain.handle("file:create", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:create";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    const filePath = resolveProjectPath(projectPath, relativePath);
    try {
      await atomicWriteUtf8(filePath, starterContent(relativePath), {
        exclusive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return relativeProjectPath(projectPath, filePath);
      }
      throw error;
    }
    return relativeProjectPath(projectPath, filePath);
  });
  ipcMain.handle(
    "docx:import",
    async (event, ...rawArgs: unknown[]): Promise<DocxImportResult | null> => {
      const channel = "docx:import";
      const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
      let project: OpenProject | null = null;
      if (typeof rawProjectId === "string" && rawProjectId.trim()) {
        const projectId = parseProjectId(channel, rawProjectId);
        project = openProjects.get(projectId) ?? null;
        if (!project) {
          throw new Error("The requested project is not open.");
        }
      }
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions = {
        properties: ["openFile"],
        title: "Import DOCX as LaTeX",
        buttonLabel: "Import DOCX",
        defaultPath: project?.rootPath ?? app.getPath("documents"),
        filters: [
          { name: "Word documents", extensions: ["docx"] },
          { name: "All files", extensions: ["*"] },
        ],
      } satisfies Electron.OpenDialogOptions;
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      if (!project) {
        project = await registerProjectIfTrusted(
          window ?? null,
          path.dirname(result.filePaths[0]),
        );
        if (!project) {
          return null;
        }
      }
      const imported = await importDocxIntoProject(
        project.rootPath,
        result.filePaths[0],
      );
      return {
        ...imported,
        project,
      };
    },
  );
  ipcMain.handle(
    "markdown:import",
    async (event, ...rawArgs: unknown[]): Promise<MarkdownImportResult | null> => {
      const channel = "markdown:import";
      const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
      let project: OpenProject | null = null;
      if (typeof rawProjectId === "string" && rawProjectId.trim()) {
        const projectId = parseProjectId(channel, rawProjectId);
        project = openProjects.get(projectId) ?? null;
        if (!project) {
          throw new Error("The requested project is not open.");
        }
      }
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions = {
        properties: ["openFile"],
        title: "Import Markdown as LaTeX",
        buttonLabel: "Import Markdown",
        defaultPath: project?.rootPath ?? app.getPath("documents"),
        filters: [
          { name: "Markdown documents", extensions: ["md", "markdown"] },
          { name: "All files", extensions: ["*"] },
        ],
      } satisfies Electron.OpenDialogOptions;
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      if (!project) {
        project = await registerProjectIfTrusted(
          window ?? null,
          path.dirname(result.filePaths[0]),
        );
        if (!project) {
          return null;
        }
      }
      const imported = await importMarkdown(project.rootPath, result.filePaths[0]);
      return {
        ...imported,
        project,
      };
    },
  );
  ipcMain.handle("folder:create", async (_event, ...rawArgs: unknown[]) => {
    const channel = "folder:create";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    const folderPath = resolveProjectPath(projectPath, relativePath);
    try {
      await mkdir(folderPath, { recursive: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return relativeProjectPath(projectPath, folderPath);
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Create the parent folder first.");
      }
      throw error;
    }
    return relativeProjectPath(projectPath, folderPath);
  });
  ipcMain.handle("file:import-external", async (_event, ...rawArgs: unknown[]) => {
    const channel = "file:import-external";
    const [rawProjectId, rawDestinationDirectory, rawSourcePaths] = expectIpcArgs(
      channel,
      rawArgs,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const destinationDirectory = parseOptionalImportDestination(
      channel,
      rawDestinationDirectory,
    );
    const sourcePaths = parseExternalSourcePaths(channel, rawSourcePaths);
    const projectPath = getProjectRoot(projectId);
    return importExternalFilesIntoProject(
      channel,
      projectPath,
      destinationDirectory,
      sourcePaths,
    );
  });
  ipcMain.handle("entry:move", async (_event, ...rawArgs: unknown[]) => {
    const channel = "entry:move";
    const [rawProjectId, rawFromRelativePath, rawToRelativePath] = expectIpcArgs(
      channel,
      rawArgs,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const fromRelativePath = parseRelativePath(channel, rawFromRelativePath);
    const toRelativePath = parseRelativePath(channel, rawToRelativePath);
    const projectPath = getProjectRoot(projectId);
    const sourcePath = resolveProjectPath(projectPath, fromRelativePath);
    const targetPath = resolveProjectPath(projectPath, toRelativePath);

    if (sourcePath === targetPath) {
      return relativeProjectPath(projectPath, targetPath);
    }

    const sourceStats = await stat(sourcePath).catch(() => null);
    if (!sourceStats) {
      throw new Error(`"${fromRelativePath}" no longer exists.`);
    }

    if (isInside(sourcePath, targetPath)) {
      throw new Error("Cannot move a folder into itself.");
    }

    const targetExists = await stat(targetPath).catch(() => null);
    if (targetExists) {
      throw new Error(`"${toRelativePath}" already exists.`);
    }

    const targetParent = path.dirname(targetPath);
    const targetParentStats = await stat(targetParent).catch(() => null);
    if (!targetParentStats?.isDirectory()) {
      throw new Error("Choose an existing folder as the destination.");
    }

    await rename(sourcePath, targetPath);
    return relativeProjectPath(projectPath, targetPath);
  });
  ipcMain.handle("git:status", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:status";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const projectPath = getProjectRoot(projectId);
    await ensureGitWatchers(projectId, projectPath);
    return readStructuredGitStatus(projectPath);
  });
  ipcMain.handle("git:stage", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:stage";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    await gitAdd(projectPath, relativePath);
  });
  ipcMain.handle("git:unstage", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:unstage";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    await gitUnstage(projectPath, relativePath);
  });
  ipcMain.handle("git:commit", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit";
    const [rawProjectId, rawMessage] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const message = parseString(channel, rawMessage, {
      maxLength: maxGitCommitMessageLength,
    });
    const projectPath = getProjectRoot(projectId);
    await gitCommit(projectPath, message);
  });
  ipcMain.handle("git:diff", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:diff";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    return {
      path: relativePath,
      diff: await readGitDiffPreview(projectPath, relativePath),
    };
  });
  ipcMain.handle("git:discard", async (event, ...rawArgs: unknown[]) => {
    const channel = "git:discard";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    const confirmed = await confirmGitDiscard(
      BrowserWindow.fromWebContents(event.sender),
      `Discard changes in ${relativePath}?`,
    );
    if (!confirmed) {
      return { discarded: false };
    }
    return gitDiscard(projectPath, relativePath);
  });
  ipcMain.handle("git:stage-all", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:stage-all";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const projectPath = getProjectRoot(projectId);
    await gitStageAll(projectPath);
  });
  ipcMain.handle("git:unstage-all", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:unstage-all";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const projectPath = getProjectRoot(projectId);
    await gitUnstageAll(projectPath);
  });
  ipcMain.handle("git:discard-all", async (event, ...rawArgs: unknown[]) => {
    const channel = "git:discard-all";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const projectPath = getProjectRoot(projectId);
    const confirmed = await confirmGitDiscard(
      BrowserWindow.fromWebContents(event.sender),
      "Discard all unstaged changes?",
    );
    if (!confirmed) {
      return { discarded: false };
    }
    return gitDiscardAll(projectPath);
  });
  ipcMain.handle("git:editor-diff", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:editor-diff";
    const [rawProjectId, rawRelativePath, rawArea] = expectIpcArgRange(
      channel,
      rawArgs,
      2,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const area =
      rawArea === undefined
        ? "changes"
        : parseString(channel, rawArea, {
            pattern: /^(staged|changes)$/,
            rejectControlChars: true,
          });
    const projectPath = getProjectRoot(projectId);
    return readWorkingTreeDiffSession(
      projectPath,
      relativePath,
      area as "staged" | "changes",
    );
  });
  ipcMain.handle("git:history", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:history";
    const [rawProjectId, rawRelativePath] = expectIpcArgRange(channel, rawArgs, 1, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseOptionalRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    return readStructuredGitHistory(projectPath, relativePath);
  });
  ipcMain.handle("git:commit-details", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit-details";
    const [rawProjectId, rawHash] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const hash = parseGitHash(channel, rawHash);
    const projectPath = getProjectRoot(projectId);
    return readStructuredGitCommitDetails(projectPath, hash);
  });
  ipcMain.handle("git:commit-file-diff", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit-file-diff";
    const [rawProjectId, rawRelativePath, rawHash, rawParentHash] = expectIpcArgRange(
      channel,
      rawArgs,
      3,
      4,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const hash = parseGitHash(channel, rawHash);
    const parentHash = parseOptionalGitHash(channel, rawParentHash);
    const projectPath = getProjectRoot(projectId);
    return readCommitDiffSession(projectPath, relativePath, hash, parentHash);
  });
  ipcMain.handle("git:blame", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:blame";
    const [rawProjectId, rawRelativePath, rawRevision] = expectIpcArgs(
      channel,
      rawArgs,
      3,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const revision = parseGitRevisionRef(channel, rawRevision);
    const projectPath = getProjectRoot(projectId);
    return readGitBlame(projectPath, relativePath, revision);
  });
  ipcMain.handle("git:reveal-file", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:reveal-file";
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    shell.showItemInFolder(resolveProjectPath(projectPath, relativePath));
  });
  ipcMain.handle("app:check-updates", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:check-updates";
    expectIpcArgs(channel, rawArgs, 0);
    return checkForUpdates();
  });
  ipcMain.handle("app:update-now", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:update-now";
    expectIpcArgs(channel, rawArgs, 0);
    return updateNow();
  });
  ipcMain.handle("app:open-releases", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:open-releases";
    const [rawReleaseUrl] = expectIpcArgRange(channel, rawArgs, 0, 1);
    await shell.openExternal(safeDownloadsUrl(rawReleaseUrl));
  });
  ipcMain.handle("app:open-external", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:open-external";
    const [rawUrl] = expectIpcArgs(channel, rawArgs, 1);
    const url = safeExternalUrl(rawUrl);
    if (!url) {
      throw new Error("Unsupported external URL.");
    }
    await shell.openExternal(url);
  });
  ipcMain.handle("extensions:get-catalog", async (_event, ...rawArgs: unknown[]) => {
    const channel = "extensions:get-catalog";
    expectIpcArgs(channel, rawArgs, 0);
    return fetchExtensionStoreCatalogJson();
  });
  ipcMain.handle("spellchecker:get-settings", async (event, ...rawArgs: unknown[]) => {
    const channel = "spellchecker:get-settings";
    expectIpcArgs(channel, rawArgs, 0);
    return getSpellCheckerSettings(BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle(
    "spellchecker:update-settings",
    async (_event, ...rawArgs: unknown[]) => {
      const channel = "spellchecker:update-settings";
      const [rawSettings] = expectIpcArgs(channel, rawArgs, 1);
      const settings = parseSpellCheckerSettingsInput(channel, rawSettings);
      return updateSpellCheckerSettings(settings);
    },
  );
  ipcMain.handle("proofread:get-settings", async (_event, ...rawArgs: unknown[]) => {
    const channel = "proofread:get-settings";
    expectIpcArgs(channel, rawArgs, 0);
    return getProofreadingSettings();
  });
  ipcMain.handle("proofread:update-settings", async (_event, ...rawArgs: unknown[]) => {
    const channel = "proofread:update-settings";
    const [rawSettings] = expectIpcArgs(channel, rawArgs, 1);
    const settings = parseProofreadingSettingsInput(channel, rawSettings);
    return updateProofreadingSettings(settings);
  });
  ipcMain.handle("proofread:check", async (_event, ...rawArgs: unknown[]) => {
    const channel = "proofread:check";
    const [rawRelativePath, rawContent, rawOptions] = expectIpcArgRange(
      channel,
      rawArgs,
      2,
      3,
    );
    const relativePath = parseRelativePath(channel, rawRelativePath, {
      extensions: [".tex", ".md", ".txt"],
    });
    const content = parseTextContent(channel, rawContent, maxProofreadingContentLength);
    const options = parseProofreadingRequestOptions(channel, rawOptions);
    return proofreadDocument(relativePath, content, options);
  });
  ipcMain.handle("latex:compile", async (_event, ...rawArgs: unknown[]) => {
    const channel = "latex:compile";
    const [rawRequest] = expectIpcArgs(channel, rawArgs, 1);
    const request = parseCompileRequestInput(channel, rawRequest);
    const projectPath = getProjectRoot(request.projectId);
    resolveProjectPath(projectPath, request.rootFile);
    const controller = new AbortController();
    const untrack = trackCompileController(request.projectId, controller);
    try {
      const result = await compileLatex(
        {
          projectPath,
          rootFile: request.rootFile,
          engine: request.engine,
        },
        { signal: controller.signal },
      );
      return {
        ...result,
        pdfPath: result.pdfPath
          ? relativeProjectPath(projectPath, result.pdfPath)
          : undefined,
      };
    } finally {
      untrack();
    }
  });
  ipcMain.handle("latex:compile-cancel", async (_event, ...rawArgs: unknown[]) => {
    const channel = "latex:compile-cancel";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    getProjectRoot(projectId);
    return cancelActiveCompiles(projectId);
  });
  ipcMain.handle("asymptote:compile", async (_event, ...rawArgs: unknown[]) => {
    const channel = "asymptote:compile";
    const [rawRequest] = expectIpcArgs(channel, rawArgs, 1);
    const request = parseAsymptoteCompileRequestInput(channel, rawRequest);
    const projectPath = getProjectRoot(request.projectId);
    resolveProjectPath(projectPath, request.relativePath);
    const controller = new AbortController();
    const untrack = trackCompileController(request.projectId, controller);
    try {
      const result = await compileAsymptote(
        {
          projectPath,
          relativePath: request.relativePath,
        },
        { signal: controller.signal },
      );
      return {
        ...result,
        pdfPath: result.pdfPath
          ? relativeProjectPath(projectPath, result.pdfPath)
          : undefined,
      };
    } finally {
      untrack();
    }
  });
  ipcMain.handle("pdf:read", async (_event, ...rawArgs: unknown[]) => {
    const channel = "pdf:read";
    const [rawProjectId, rawPdfPath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const pdfPath = parseRelativePath(channel, rawPdfPath, {
      extensions: [".pdf"],
    });
    const projectPath = getProjectRoot(projectId);
    const resolvedPath = resolveProjectPath(projectPath, pdfPath);
    return readFile(resolvedPath);
  });
  ipcMain.handle("synctex:forward", async (_event, ...rawArgs: unknown[]) => {
    const channel = "synctex:forward";
    const [rawProjectId, rawPdfRelativePath, rawInputRelativePath, rawLine, rawColumn] =
      expectIpcArgs(channel, rawArgs, 5);
    const projectId = parseProjectId(channel, rawProjectId);
    const pdfRelativePath = parseRelativePath(channel, rawPdfRelativePath, {
      extensions: [".pdf"],
    });
    const inputRelativePath = parseRelativePath(channel, rawInputRelativePath, {
      extensions: [".tex"],
    });
    const line = parseInteger(channel, rawLine, 1, maxSyncTexNumber);
    const column = parseInteger(channel, rawColumn, 1, maxSyncTexNumber);
    const projectPath = getProjectRoot(projectId);
    const pdfPath = resolveProjectPath(projectPath, pdfRelativePath);
    const inputPath = resolveProjectPath(projectPath, inputRelativePath);
    return forwardSyncTex(projectPath, pdfPath, inputPath, line, column);
  });
  ipcMain.handle("synctex:backward", async (_event, ...rawArgs: unknown[]) => {
    const channel = "synctex:backward";
    const [rawProjectId, rawPdfRelativePath, rawPage, rawX, rawY] = expectIpcArgs(
      channel,
      rawArgs,
      5,
    );
    const projectId = parseProjectId(channel, rawProjectId);
    const pdfRelativePath = parseRelativePath(channel, rawPdfRelativePath, {
      extensions: [".pdf"],
    });
    const page = parseInteger(channel, rawPage, 1, 100_000);
    const x = parseFiniteNumber(channel, rawX, 0, maxSyncTexNumber);
    const y = parseFiniteNumber(channel, rawY, 0, maxSyncTexNumber);
    const projectPath = getProjectRoot(projectId);
    const pdfPath = resolveProjectPath(projectPath, pdfRelativePath);
    return backwardSyncTex(projectPath, pdfPath, page, x, y);
  });

  const window = createWindow();
  console.log("[latexdo] app:window-opened");
  if (!startupSmokeTest && !(await ensurePrivacyConsent(window))) {
    app.quit();
    return;
  }
  if (startupSmokeTest) {
    void runStartupSmokeTest(window)
      .then(() => app.exit(0))
      .catch((error) => {
        console.error("[latexdo] packaged startup smoke test failed", error);
        app.exit(1);
      });
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  for (const projectId of gitWatchStates.keys()) closeGitWatchers(projectId);
});
