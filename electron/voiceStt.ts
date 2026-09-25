import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import path from "node:path";

export interface SpeechServerEnsureRequest {
  baseUrl?: string;
  model?: string;
}

export type SpeechServerEnsureResult =
  | {
      ok: true;
      baseUrl: string;
      model: string;
      alreadyRunning: boolean;
      bundled: boolean;
    }
  | {
      ok: false;
      code: "missing-runtime" | "missing-model" | "start-failed";
      error: string;
    };

const defaultHost = "127.0.0.1";
const defaultPort = 8080;
const defaultBaseUrl = `http://localhost:${defaultPort}/v1`;
const defaultModel = "whisper-1";
const startupTimeoutMs = 12_000;

let speechProcess: ChildProcess | null = null;
let starting: Promise<SpeechServerEnsureResult> | null = null;

function speechRoot(): string {
  const configured = process.env.LATEXDO_SPEECH_ROOT?.trim();
  if (configured) return configured;
  if (app.isPackaged) return path.join(process.resourcesPath, "speech");
  return path.join(app.getAppPath(), "resources", "speech");
}

function executableNames(): string[] {
  if (process.platform === "win32") {
    return ["whisper-server.exe", "server.exe"];
  }
  return ["whisper-server", "server"];
}

function executableCandidates(): string[] {
  const configured = process.env.LATEXDO_SPEECH_SERVER_PATH?.trim();
  if (configured) return [configured];
  const root = speechRoot();
  return executableNames().flatMap((name) => [
    path.join(root, "bin", process.platform, process.arch, name),
    path.join(root, "bin", process.platform, name),
    path.join(root, "bin", name),
  ]);
}

function modelCandidates(): string[] {
  const configured = process.env.LATEXDO_SPEECH_MODEL_PATH?.trim();
  if (configured) return [configured];
  const root = speechRoot();
  return [
    path.join(root, "models", "ggml-base.en.bin"),
    path.join(root, "models", "ggml-base.bin"),
    path.join(root, "models", "ggml-small.en.bin"),
    path.join(root, "models", "ggml-tiny.en.bin"),
  ];
}

async function firstExecutablePath(): Promise<string | null> {
  for (const candidate of executableCandidates()) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      try {
        await access(candidate, fsConstants.R_OK);
        if (process.platform !== "win32") await chmod(candidate, 0o755);
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
  }
  return null;
}

async function firstModelPath(): Promise<string | null> {
  for (const candidate of modelCandidates()) {
    try {
      await access(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function portFromBaseUrl(baseUrl: string): number {
  try {
    const parsed = new URL(baseUrl);
    return parsed.port ? Number(parsed.port) : defaultPort;
  } catch {
    return defaultPort;
  }
}

async function probe(baseUrl: string, timeoutMs = 1200): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const models = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (models.ok) return true;
  } catch {
    // Some compatible servers do not expose /models until the first request.
  } finally {
    clearTimeout(timeout);
  }
  return false;
}

async function waitUntilReady(baseUrl: string): Promise<boolean> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await probe(baseUrl, 800)) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

function spawnArgs(modelPath: string, port: number): string[] {
  return ["-m", modelPath, "--host", defaultHost, "--port", String(port)];
}

async function ensureSpeechServerInner(
  request: SpeechServerEnsureRequest = {},
): Promise<SpeechServerEnsureResult> {
  const baseUrl = request.baseUrl?.trim() || defaultBaseUrl;
  const model = request.model?.trim() || defaultModel;

  if (speechProcess && !speechProcess.killed && (await probe(baseUrl))) {
    return { ok: true, baseUrl, model, alreadyRunning: true, bundled: true };
  }
  if (await probe(baseUrl)) {
    return { ok: true, baseUrl, model, alreadyRunning: true, bundled: false };
  }

  const executable = await firstExecutablePath();
  if (!executable) {
    return {
      ok: false,
      code: "missing-runtime",
      error:
        "This LatexDo build is missing the bundled local speech runtime. Reinstall LatexDo with speech support.",
    };
  }

  const modelPath = await firstModelPath();
  if (!modelPath) {
    return {
      ok: false,
      code: "missing-model",
      error:
        "This LatexDo build is missing the bundled local speech model. Reinstall LatexDo with speech support.",
    };
  }

  const port = portFromBaseUrl(baseUrl);
  speechProcess = spawn(executable, spawnArgs(modelPath, port), {
    env: { ...process.env },
    stdio: "ignore",
    windowsHide: true,
  });
  speechProcess.once("exit", () => {
    speechProcess = null;
  });
  speechProcess.once("error", () => {
    speechProcess = null;
  });

  if (await waitUntilReady(baseUrl)) {
    return { ok: true, baseUrl, model, alreadyRunning: false, bundled: true };
  }

  stopBundledSpeechServer();
  return {
    ok: false,
    code: "start-failed",
    error:
      "LatexDo could not start the bundled local speech service. Restart LatexDo and try again.",
  };
}

export async function ensureBundledSpeechServer(
  request: SpeechServerEnsureRequest = {},
): Promise<SpeechServerEnsureResult> {
  if (!starting) {
    starting = ensureSpeechServerInner(request).finally(() => {
      starting = null;
    });
  }
  return starting;
}

export function stopBundledSpeechServer(): void {
  if (!speechProcess) return;
  const child = speechProcess;
  speechProcess = null;
  if (!child.killed) child.kill();
}
