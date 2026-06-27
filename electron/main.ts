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
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compileLatex } from "./compiler.js";
import { importDocxIntoProject } from "./docxImport.js";
import { importMarkdown } from "./markdownImport.js";
import { backwardSyncTex, forwardSyncTex } from "./synctex.js";
import type {
  Diagnostic,
  DocxImportResult,
  MarkdownImportResult,
  GitCommitDetails,
  GitCommitEntry,
  CompileRequest,
  GitDiscardResult,
  GitDiffEditorInput,
  GitDiffPreview,
  GitHistorySummary,
  GitStatusEntry,
  GitStatusSummary,
  OpenProject,
  ProofreadingResult,
  ProofreadingSettings,
  ProjectEntry,
  SpellCheckerSettings,
  UpdateCheckResult,
  CreateProjectOptions,
} from "./types.js";
import { registerTerminalIpc } from "./terminal.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const appIconPath = path.join(currentDirectory, "..", "build", "icon.png");
const execFileAsync = promisify(execFile);
const startupSmokeTest = process.argv.includes("--smoke-test");
const startupSmokeTimeoutMs = 20_000;
const downloadsPageUrl = "https://latexdo.org/downloads/";
const downloadsManifestUrl = "https://latexdo.org/downloads/manifest.json";
const updatesFeedUrl = "https://latexdo.org/updates/latest.json";
const spellCheckerSettingsFile = "spellchecker-settings.json";
const proofreadingSettingsFile = "proofreading-settings.json";
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

const openProjects = new Map<string, OpenProject>();

interface WebsiteUpdatePayload {
  schemaVersion?: unknown;
  product?: unknown;
  channel?: unknown;
  version?: unknown;
  publishedAt?: unknown;
  downloadsPage?: unknown;
  manifestUrl?: unknown;
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

const maxProjectIdLength = 128;
const maxRelativePathLength = 4096;
const maxTextContentLength = 20 * 1024 * 1024;
const maxProofreadingContentLength = 5 * 1024 * 1024;
const maxGitCommitMessageLength = 20_000;
const maxSettingsStringLength = 2048;
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

function parseGitHash(channel: string, value: unknown): string {
  return parseString(channel, value, {
    maxLength: 64,
    rejectControlChars: true,
    pattern: gitHashPattern,
  });
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
): {
  line: number;
  column: number;
} {
  let line = 1;
  let column = 1;

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
): Diagnostic | null {
  const offset = typeof match.offset === "number" ? match.offset : -1;
  const length = typeof match.length === "number" ? Math.max(1, match.length) : 1;
  if (offset < 0 || offset >= source.length) {
    return null;
  }

  const start = offsetToLocation(source, offset);
  const end = offsetToLocation(source, Math.min(source.length, offset + length));
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
  const textForCheck = sanitizedText.replace(/[ \t]+\n/g, "\n");
  if (!textForCheck.trim()) {
    return {
      diagnostics: [],
      output: "No natural-language text found to proofread.",
      checkedTextLength: 0,
    };
  }

  const payload = new URLSearchParams();
  payload.set("text", sanitizedText);
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
      .map((match) => mapProofreadingMatch(relativePath, content, match))
      .filter((diagnostic): diagnostic is Diagnostic => diagnostic !== null);

    return {
      diagnostics,
      output: diagnostics.length
        ? `Found ${diagnostics.length} writing suggestion${diagnostics.length === 1 ? "" : "s"}.`
        : "No grammar or style suggestions found.",
      checkedTextLength: sanitizedText.trim().length,
    };
  } catch (error) {
    return {
      diagnostics: [],
      output: "Proofreading could not reach the grammar service.",
      checkedTextLength: sanitizedText.trim().length,
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
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function payloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

  const releaseUrl = payloadString(payload.downloadsPage) ?? downloadsPageUrl;
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

async function fetchWebsiteUpdatePayload(
  url: string,
  currentVersion: string,
  headers: Record<string, string>,
): Promise<UpdateCheckResult> {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return updateResultFromWebsitePayload(
    (await response.json()) as WebsiteUpdatePayload,
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

async function readGitStatus(projectPath: string): Promise<GitStatusSummary> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      projectPath,
      "status",
      "--short",
      "--branch",
    ]);
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const header = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "";
    const branch = header ? header.split("...")[0] || header : null;
    const entries: GitStatusEntry[] = lines.slice(1).map((line) => ({
      indexStatus: line[0] === " " ? "" : (line[0] ?? ""),
      workingTreeStatus: line[1] === " " ? "" : (line[1] ?? ""),
      path: line.slice(3).trim(),
    }));

    return {
      isRepo: true,
      branch,
      entries,
    };
  } catch (error) {
    const message = normalizeGitError(error, "Git status failed");
    if (
      message === "Not a Git repository" ||
      message.includes("unknown option") ||
      message.includes("No such file or directory")
    ) {
      return {
        isRepo: false,
        branch: null,
        entries: [],
        error: message,
      };
    }

    return {
      isRepo: false,
      branch: null,
      entries: [],
      error: message,
    };
  }
}

function isNotGitRepositoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("not a git repository") ||
    message.includes("No such file or directory")
  );
}

function normalizeGitError(error: unknown, fallback: string): string {
  if (isNotGitRepositoryError(error)) {
    return "Not a Git repository";
  }
  return error instanceof Error ? error.message : fallback;
}

async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      projectPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return stdout.trim() === "true";
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return false;
    }
    throw error;
  }
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
      "LatexDo will save a recovery patch in .latexdo/recovery before discarding changes.",
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
  const args = ["-C", projectPath, "diff", "--binary"];
  if (relativePath) {
    args.push("--", relativePath);
  }

  const { stdout } = await execFileAsync("git", args, {
    maxBuffer: 100 * 1024 * 1024,
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

async function gitAdd(projectPath: string, relativePath: string): Promise<void> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
  await execFileAsync("git", ["-C", projectPath, "add", "--", targetPath]);
}

async function gitUnstage(projectPath: string, relativePath: string): Promise<void> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
  try {
    await execFileAsync("git", [
      "-C",
      projectPath,
      "restore",
      "--staged",
      "--",
      targetPath,
    ]);
  } catch {
    await execFileAsync("git", ["-C", projectPath, "reset", "HEAD", "--", targetPath]);
  }
}

async function gitCommit(projectPath: string, message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Enter a commit message.");
  }

  await execFileAsync("git", ["-C", projectPath, "commit", "-m", trimmed]);
}

async function gitDiff(
  projectPath: string,
  relativePath: string,
): Promise<GitDiffPreview> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
  const { stdout } = await execFileAsync("git", [
    "-C",
    projectPath,
    "diff",
    "--",
    targetPath,
  ]);

  return {
    path: relativePath,
    diff: stdout || "No unstaged diff available.",
  };
}

async function gitDiscard(
  projectPath: string,
  relativePath: string,
): Promise<GitDiscardResult> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
  const recoveryPatch = await createGitDiscardRecoveryPatch(projectPath, relativePath);
  try {
    await execFileAsync("git", [
      "-C",
      projectPath,
      "restore",
      "--worktree",
      "--",
      targetPath,
    ]);
  } catch {
    await execFileAsync("git", ["-C", projectPath, "checkout", "--", targetPath]);
  }
  return {
    discarded: true,
    recoveryPatch,
  };
}

async function gitStageAll(projectPath: string): Promise<void> {
  await execFileAsync("git", ["-C", projectPath, "add", "--all"]);
}

async function gitUnstageAll(projectPath: string): Promise<void> {
  try {
    await execFileAsync("git", ["-C", projectPath, "restore", "--staged", "."]);
  } catch {
    await execFileAsync("git", ["-C", projectPath, "reset", "HEAD", "--", "."]);
  }
}

async function gitDiscardAll(projectPath: string): Promise<GitDiscardResult> {
  const recoveryPatch = await createGitDiscardRecoveryPatch(projectPath);
  try {
    await execFileAsync("git", ["-C", projectPath, "restore", "."]);
  } catch {
    await execFileAsync("git", ["-C", projectPath, "checkout", "--", "."]);
  }
  return {
    discarded: true,
    recoveryPatch,
  };
}

async function gitDiffEditorInput(
  projectPath: string,
  relativePath: string,
): Promise<GitDiffEditorInput> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
  const modified = await readFile(targetPath, "utf8").catch(() => "");

  if (!(await isGitRepository(projectPath))) {
    return {
      path: relativePath,
      original: "",
      modified,
    };
  }

  let original = "";
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      projectPath,
      "show",
      `HEAD:${relativePath}`,
    ]);
    original = stdout;
  } catch {
    original = "";
  }

  return {
    path: relativePath,
    original,
    modified,
  };
}

function parseGitCommitLines(output: string): GitCommitEntry[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, author, date, subject] = line.split("\u001f");
      return {
        hash,
        shortHash,
        author,
        date,
        subject,
      };
    });
}

async function gitHistory(
  projectPath: string,
  relativePath?: string,
): Promise<GitHistorySummary> {
  if (!(await isGitRepository(projectPath))) {
    return {
      scope: relativePath ? "file" : "repo",
      target: relativePath ?? null,
      commits: [],
    };
  }

  const args = [
    "-C",
    projectPath,
    "log",
    "--date=short",
    "--pretty=format:%H\u001f%h\u001f%an\u001f%ad\u001f%s",
    "-n",
    "20",
  ];

  if (relativePath) {
    const targetPath = resolveProjectPath(projectPath, relativePath);
    args.push("--", targetPath);
  }

  const { stdout } = await execFileAsync("git", args);
  return {
    scope: relativePath ? "file" : "repo",
    target: relativePath ?? null,
    commits: parseGitCommitLines(stdout),
  };
}

async function gitCommitDetails(
  projectPath: string,
  hash: string,
): Promise<GitCommitDetails> {
  if (!(await isGitRepository(projectPath))) {
    return {
      hash,
      summary: "",
      body: "",
    };
  }

  const { stdout } = await execFileAsync("git", [
    "-C",
    projectPath,
    "show",
    "--stat",
    "--format=%H%n%s%n%b",
    "--no-patch",
    hash,
  ]);
  const lines = stdout.split(/\r?\n/);
  const [, summary = "", ...bodyLines] = lines;
  return {
    hash,
    summary,
    body: bodyLines.join("\n").trim(),
  };
}

async function gitDiffAtCommit(
  projectPath: string,
  relativePath: string,
  hash: string,
): Promise<GitDiffEditorInput> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
  const modified = await readFile(targetPath, "utf8").catch(() => "");

  if (!(await isGitRepository(projectPath))) {
    return {
      path: relativePath,
      original: "",
      modified,
    };
  }

  let original = "";
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      projectPath,
      "show",
      `${hash}:${relativePath}`,
    ]);
    original = stdout;
  } catch {
    original = "";
  }

  return {
    path: relativePath,
    original,
    modified,
  };
}

async function listProject(
  projectPath: string,
  directory = projectPath,
): Promise<ProjectEntry[]> {
  const hidden = new Set([".git", ".latexdo", "node_modules", "dist"]);
  const entries = await readdir(directory, { withFileTypes: true });
  const result: ProjectEntry[] = [];

  for (const entry of entries) {
    if (hidden.has(entry.name) || entry.name === ".DS_Store") {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(projectPath, absolutePath);

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: absolutePath,
        relativePath,
        type: "directory",
        children: await listProject(projectPath, absolutePath),
      });
    } else {
      result.push({
        name: entry.name,
        path: absolutePath,
        relativePath,
        type: "file",
      });
    }
  }

  return result.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
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

app.whenReady().then(() => {
  console.log("[latexdo] app:ready");
  if (process.platform === "darwin") {
    app.dock.setIcon(appIconPath);
  }
  registerTerminalIpc({ getProjectRoot });
  console.log("[latexdo] app:terminal-registered");
  buildApplicationMenu();
  console.log("[latexdo] app:menu-built");
  ipcMain.handle("project:open", async (_event, ...rawArgs: unknown[]) => {
    const channel = "project:open";
    expectIpcArgs(channel, rawArgs, 0);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Open LaTeX project",
    });
    return result.canceled ? null : registerProject(result.filePaths[0]);
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
    return registerProject(projectPath);
  });
  ipcMain.handle("project:list", async (_event, ...rawArgs: unknown[]) => {
    const channel = "project:list";
    const [rawProjectId] = expectIpcArgs(channel, rawArgs, 1);
    const projectId = parseProjectId(channel, rawProjectId);
    const projectPath = getProjectRoot(projectId);
    return listProject(projectPath);
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
    const filePath = parseRelativePath(channel, rawFilePath);
    const projectPath = getProjectRoot(projectId);
    const resolvedPath = resolveProjectPath(projectPath, filePath);
    return readFile(resolvedPath, "utf8");
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

      project ??= registerProject(path.dirname(result.filePaths[0]));
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

      project ??= registerProject(path.dirname(result.filePaths[0]));
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
    return readGitStatus(projectPath);
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
      rejectControlChars: true,
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
    return gitDiff(projectPath, relativePath);
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
    const [rawProjectId, rawRelativePath] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    return gitDiffEditorInput(projectPath, relativePath);
  });
  ipcMain.handle("git:history", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:history";
    const [rawProjectId, rawRelativePath] = expectIpcArgRange(channel, rawArgs, 1, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseOptionalRelativePath(channel, rawRelativePath);
    const projectPath = getProjectRoot(projectId);
    return gitHistory(projectPath, relativePath);
  });
  ipcMain.handle("git:commit-details", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit-details";
    const [rawProjectId, rawHash] = expectIpcArgs(channel, rawArgs, 2);
    const projectId = parseProjectId(channel, rawProjectId);
    const hash = parseGitHash(channel, rawHash);
    const projectPath = getProjectRoot(projectId);
    return gitCommitDetails(projectPath, hash);
  });
  ipcMain.handle("git:commit-file-diff", async (_event, ...rawArgs: unknown[]) => {
    const channel = "git:commit-file-diff";
    const [rawProjectId, rawRelativePath, rawHash] = expectIpcArgs(channel, rawArgs, 3);
    const projectId = parseProjectId(channel, rawProjectId);
    const relativePath = parseRelativePath(channel, rawRelativePath);
    const hash = parseGitHash(channel, rawHash);
    const projectPath = getProjectRoot(projectId);
    return gitDiffAtCommit(projectPath, relativePath, hash);
  });
  ipcMain.handle("app:check-updates", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:check-updates";
    expectIpcArgs(channel, rawArgs, 0);
    return checkForUpdates();
  });
  ipcMain.handle("app:open-releases", async (_event, ...rawArgs: unknown[]) => {
    const channel = "app:open-releases";
    expectIpcArgs(channel, rawArgs, 0);
    await shell.openExternal(downloadsPageUrl);
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
    const [rawRelativePath, rawContent] = expectIpcArgs(channel, rawArgs, 2);
    const relativePath = parseRelativePath(channel, rawRelativePath, {
      extensions: [".tex", ".md", ".txt"],
    });
    const content = parseTextContent(channel, rawContent, maxProofreadingContentLength);
    return proofreadDocument(relativePath, content);
  });
  ipcMain.handle("latex:compile", async (_event, ...rawArgs: unknown[]) => {
    const channel = "latex:compile";
    const [rawRequest] = expectIpcArgs(channel, rawArgs, 1);
    const request = parseCompileRequestInput(channel, rawRequest);
    const projectPath = getProjectRoot(request.projectId);
    resolveProjectPath(projectPath, request.rootFile);
    const result = await compileLatex({
      projectPath,
      rootFile: request.rootFile,
      engine: request.engine,
    });
    return {
      ...result,
      pdfPath: result.pdfPath
        ? relativeProjectPath(projectPath, result.pdfPath)
        : undefined,
    };
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
