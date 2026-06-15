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
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compileLatex } from "./compiler.js";
import { backwardSyncTex, forwardSyncTex } from "./synctex.js";
import type {
  Diagnostic,
  GitCommitDetails,
  GitCommitEntry,
  CompileRequest,
  GitDiffEditorInput,
  GitDiffPreview,
  GitHistorySummary,
  GitStatusEntry,
  GitStatusSummary,
  ProofreadingResult,
  ProofreadingSettings,
  ProjectEntry,
  SpellCheckerSettings,
  UpdateCheckResult,
} from "./types.js";
import { registerTerminalIpc } from "./terminal.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const execFileAsync = promisify(execFile);
const githubLatestReleaseUrl =
  "https://api.github.com/repos/latexdo/latexdo/releases/latest";
const spellCheckerSettingsFile = "spellchecker-settings.json";
const proofreadingSettingsFile = "proofreading-settings.json";
const openSpellCheckerChannel = "tools:open-spellchecker";
const openProjectChannel = "file:open-project";
const createFileChannel = "file:create-dialog";
const createFolderChannel = "folder:create-dialog";
let welcomeProjectPromise: Promise<string> | null = null;
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
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .filter(Boolean);
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
  const localeCandidates = [
    ...normalizeLanguageCode(app.getLocale()),
    "en-US",
    "en",
  ];
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
        ? parsed.customWords.filter((value): value is string => typeof value === "string")
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
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
    "utf8",
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
  const referenceWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
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

async function addSpellCheckerWord(
  word: string,
): Promise<SpellCheckerSettings> {
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(settings, null, 2), "utf8");
}

function sanitizeProofreadingSettings(
  stored: StoredProofreadingSettings,
): ProofreadingSettings {
  const defaults = defaultProofreadingSettings();
  const serverUrl = typeof stored.serverUrl === "string" ? stored.serverUrl.trim() : "";
  const language = typeof stored.language === "string" ? stored.language.trim() : "";
  const motherTongue =
    typeof stored.motherTongue === "string" ? stored.motherTongue.trim() : "";

  return {
    enabled: stored.enabled !== false,
    serverUrl: serverUrl || defaults.serverUrl,
    language: language || defaults.language,
    picky: typeof stored.picky === "boolean" ? stored.picky : defaults.picky,
    motherTongue,
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
  return source
    .slice(start, end)
    .replace(/[^\n]/g, " ");
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
        if (
          source.startsWith(closeToken, end) &&
          source[end - 1] !== "\\"
        ) {
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

function offsetToLocation(source: string, offset: number): {
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
        { type: "separator" },
        { role: "close" },
        ...(process.platform === "darwin" ? [] : ([{ type: "separator" }, { role: "quit" }] as const)),
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
            void shell.openExternal("https://github.com/latexdo/latexdo/releases");
          },
        },
        {
          label: "LatexDo Releases",
          click: () => {
            void shell.openExternal("https://github.com/latexdo/latexdo/releases");
          },
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  try {
    const response = await fetch(githubLatestReleaseUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `latexdo/${currentVersion}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Update check failed (${response.status})`);
    }

    const payload = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
    };
    const latestVersion = payload.tag_name?.replace(/^v/i, "") ?? null;

    return {
      currentVersion,
      latestVersion,
      releaseUrl: payload.html_url ?? null,
      updateAvailable:
        latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0,
    };
  } catch (error) {
    return {
      currentVersion,
      latestVersion: null,
      releaseUrl: "https://github.com/latexdo/latexdo/releases",
      updateAvailable: false,
      error: error instanceof Error ? error.message : "Update check failed",
    };
  }
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
      indexStatus: line[0] === " " ? "" : line[0] ?? "",
      workingTreeStatus: line[1] === " " ? "" : line[1] ?? "",
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
    await execFileAsync("git", [
      "-C",
      projectPath,
      "reset",
      "HEAD",
      "--",
      targetPath,
    ]);
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

async function gitDiscard(projectPath: string, relativePath: string): Promise<void> {
  const targetPath = resolveProjectPath(projectPath, relativePath);
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
    await execFileAsync("git", [
      "-C",
      projectPath,
      "checkout",
      "--",
      targetPath,
    ]);
  }
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

async function gitDiscardAll(projectPath: string): Promise<void> {
  try {
    await execFileAsync("git", ["-C", projectPath, "restore", "."]);
  } catch {
    await execFileAsync("git", ["-C", projectPath, "checkout", "--", "."]);
  }
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

async function initializeWelcomeProject(): Promise<string> {
  const projectPath = path.join(app.getPath("userData"), "projects", "Welcome");
  const mainFile = path.join(projectPath, "main.tex");

  try {
    await stat(mainFile);
  } catch {
    const source = app.isPackaged
      ? path.join(process.resourcesPath, "examples", "welcome")
      : path.join(process.cwd(), "examples", "welcome");
    await mkdir(projectPath, { recursive: true });
    await cp(source, projectPath, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }

  return projectPath;
}

function ensureWelcomeProject(): Promise<string> {
  welcomeProjectPromise ??= initializeWelcomeProject().catch((error) => {
    welcomeProjectPromise = null;
    throw error;
  });
  return welcomeProjectPromise;
}

function createWindow(): void {
  console.log("[latexdo] createWindow:start");
  nativeTheme.themeSource = "dark";
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "LatexDo",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });
  console.log("[latexdo] createWindow:created");

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
}

app.whenReady().then(() => {
  console.log("[latexdo] app:ready");
  registerTerminalIpc();
  console.log("[latexdo] app:terminal-registered");
  buildApplicationMenu();
  console.log("[latexdo] app:menu-built");
  ipcMain.handle("project:get-welcome", ensureWelcomeProject);
  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Open LaTeX project",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("project:create", async () => {
    const result = await dialog.showSaveDialog({
      title: "Create LaTeX project",
      defaultPath: path.join(app.getPath("documents"), "My LaTeX Project"),
      buttonLabel: "Create Project",
      nameFieldLabel: "Project name",
      showsTagField: false,
    });
    if (result.canceled || !result.filePath) {
      return null;
    }

    const projectPath = result.filePath;
    try {
      await mkdir(projectPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("A file or folder with that project name already exists.");
      }
      throw error;
    }
    await writeFile(path.join(projectPath, "main.tex"), starterDocument, "utf8");
    return projectPath;
  });
  ipcMain.handle("project:list", async (_event, projectPath: string) => {
    return listProject(projectPath);
  });
  ipcMain.handle("file:exists", async (_event, projectPath: string, filePath: string) => {
    assertInside(projectPath, filePath);
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(
    "file:read",
    async (_event, projectPath: string, filePath: string) => {
      assertInside(projectPath, filePath);
      return readFile(filePath, "utf8");
    },
  );
  ipcMain.handle(
    "file:write",
    async (
      _event,
      projectPath: string,
      filePath: string,
      content: string,
    ) => {
      assertInside(projectPath, filePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    },
  );
  ipcMain.handle(
    "file:create",
    async (_event, projectPath: string, relativePath: string) => {
      const filePath = resolveProjectPath(projectPath, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      try {
        await writeFile(filePath, starterContent(relativePath), {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`"${relativePath}" already exists.`);
        }
        throw error;
      }
      return filePath;
    },
  );
  ipcMain.handle(
    "folder:create",
    async (_event, projectPath: string, relativePath: string) => {
      const folderPath = resolveProjectPath(projectPath, relativePath);
      try {
        await mkdir(folderPath, { recursive: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`"${relativePath}" already exists.`);
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error("Create the parent folder first.");
        }
        throw error;
      }
      return folderPath;
    },
  );
  ipcMain.handle(
    "entry:move",
    async (
      _event,
      projectPath: string,
      fromRelativePath: string,
      toRelativePath: string,
    ) => {
      const sourcePath = resolveProjectPath(projectPath, fromRelativePath);
      const targetPath = resolveProjectPath(projectPath, toRelativePath);

      if (sourcePath === targetPath) {
        return targetPath;
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
      return targetPath;
    },
  );
  ipcMain.handle("git:status", async (_event, projectPath: string) => {
    return readGitStatus(projectPath);
  });
  ipcMain.handle(
    "git:stage",
    async (_event, projectPath: string, relativePath: string) => {
      await gitAdd(projectPath, relativePath);
    },
  );
  ipcMain.handle(
    "git:unstage",
    async (_event, projectPath: string, relativePath: string) => {
      await gitUnstage(projectPath, relativePath);
    },
  );
  ipcMain.handle(
    "git:commit",
    async (_event, projectPath: string, message: string) => {
      await gitCommit(projectPath, message);
    },
  );
  ipcMain.handle(
    "git:diff",
    async (_event, projectPath: string, relativePath: string) => {
      return gitDiff(projectPath, relativePath);
    },
  );
  ipcMain.handle(
    "git:discard",
    async (_event, projectPath: string, relativePath: string) => {
      await gitDiscard(projectPath, relativePath);
    },
  );
  ipcMain.handle("git:stage-all", async (_event, projectPath: string) => {
    await gitStageAll(projectPath);
  });
  ipcMain.handle("git:unstage-all", async (_event, projectPath: string) => {
    await gitUnstageAll(projectPath);
  });
  ipcMain.handle("git:discard-all", async (_event, projectPath: string) => {
    await gitDiscardAll(projectPath);
  });
  ipcMain.handle(
    "git:editor-diff",
    async (_event, projectPath: string, relativePath: string) => {
      return gitDiffEditorInput(projectPath, relativePath);
    },
  );
  ipcMain.handle(
    "git:history",
    async (_event, projectPath: string, relativePath?: string) => {
      return gitHistory(projectPath, relativePath);
    },
  );
  ipcMain.handle(
    "git:commit-details",
    async (_event, projectPath: string, hash: string) => {
      return gitCommitDetails(projectPath, hash);
    },
  );
  ipcMain.handle(
    "git:commit-file-diff",
    async (
      _event,
      projectPath: string,
      relativePath: string,
      hash: string,
    ) => {
      return gitDiffAtCommit(projectPath, relativePath, hash);
    },
  );
  ipcMain.handle("app:check-updates", async () => {
    return checkForUpdates();
  });
  ipcMain.handle("app:open-releases", async () => {
    await shell.openExternal("https://github.com/latexdo/latexdo/releases");
  });
  ipcMain.handle("spellchecker:get-settings", async (event) => {
    return getSpellCheckerSettings(BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle(
    "spellchecker:update-settings",
    async (_event, settings: SpellCheckerSettings) => {
      return updateSpellCheckerSettings(settings);
    },
  );
  ipcMain.handle("proofread:get-settings", async () => {
    return getProofreadingSettings();
  });
  ipcMain.handle(
    "proofread:update-settings",
    async (_event, settings: ProofreadingSettings) => {
      return updateProofreadingSettings(settings);
    },
  );
  ipcMain.handle(
    "proofread:check",
    async (_event, relativePath: string, content: string) => {
      return proofreadDocument(relativePath, content);
    },
  );
  ipcMain.handle("latex:compile", async (_event, request: CompileRequest) => {
    const rootPath = path.join(request.projectPath, request.rootFile);
    assertInside(request.projectPath, rootPath);
    return compileLatex(request);
  });
  ipcMain.handle(
    "pdf:read",
    async (_event, projectPath: string, pdfPath: string) => {
      assertInside(projectPath, pdfPath);
      return readFile(pdfPath);
    },
  );
  ipcMain.handle(
    "synctex:forward",
    async (
      _event,
      projectPath: string,
      pdfPath: string,
      inputPath: string,
      line: number,
      column: number,
    ) => {
      assertInside(projectPath, pdfPath);
      assertInside(projectPath, inputPath);
      return forwardSyncTex(
        projectPath,
        pdfPath,
        inputPath,
        line,
        column,
      );
    },
  );
  ipcMain.handle(
    "synctex:backward",
    async (
      _event,
      projectPath: string,
      pdfPath: string,
      page: number,
      x: number,
      y: number,
    ) => {
      assertInside(projectPath, pdfPath);
      return backwardSyncTex(projectPath, pdfPath, page, x, y);
    },
  );

  createWindow();
  console.log("[latexdo] app:window-opened");
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
