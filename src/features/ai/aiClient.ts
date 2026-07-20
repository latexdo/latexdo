// Renderer transport. Routes a single generation step to the right place:
//   - cloud   -> direct fetch from the renderer (works in browser + desktop)
//   - local   -> Electron main via IPC (node-llama-cpp); desktop only
//   - ollama  -> Electron main via IPC (avoids mixed-content on hosted builds)
//
// Also exposes model management (list/download) which is desktop-only.

import type {
  DownloadProgress,
  GenerateRequest,
  GenerationStep,
  ModelStatus,
} from "./aiTypes";
import { generateStepCloud } from "./aiCloud";

/** Shape of the `ai` object exposed by preload on window.electronApi. */
export interface AiBridge {
  generateStep(req: GenerateRequest): Promise<GenerationStep>;
  subscribeTokens(cb: (payload: { requestId: string; text: string }) => void): () => void;
  abort(requestId: string): Promise<void>;
  listModels(): Promise<ModelStatus[]>;
  downloadModel(
    modelId: string,
    url: string,
    fileName: string,
  ): Promise<{ ok: boolean; error?: string }>;
  subscribeDownload(cb: (p: DownloadProgress) => void): () => void;
  deleteModel(fileName: string): Promise<void>;
  detectOllama(baseUrl: string): Promise<{ available: boolean; models: string[] }>;
}

function bridge(): AiBridge | null {
  return (globalThis as { aiApi?: AiBridge }).aiApi ?? null;
}

export function isLocalRuntimeAvailable(): boolean {
  return bridge() !== null;
}

/** Run one generation step, streaming tokens through onToken. */
export async function generateStep(
  req: GenerateRequest,
  onToken: (text: string) => void,
): Promise<GenerationStep> {
  if (req.provider === "cloud") {
    return generateStepCloud(req, onToken);
  }
  const ai = bridge();
  if (!ai) {
    return {
      type: "error",
      content:
        "Local and Ollama models require the LatexDo desktop app. In the browser, choose a cloud provider in AI settings.",
    };
  }
  const unsub = ai.subscribeTokens((payload) => {
    if (payload.requestId === req.requestId) onToken(payload.text);
  });
  try {
    return await ai.generateStep(req);
  } finally {
    unsub();
  }
}

export async function abortGeneration(requestId: string): Promise<void> {
  await bridge()?.abort(requestId);
}

export async function listModels(): Promise<ModelStatus[]> {
  return (await bridge()?.listModels()) ?? [];
}

export async function downloadModel(
  modelId: string,
  url: string,
  fileName: string,
): Promise<{ ok: boolean; error?: string }> {
  const ai = bridge();
  if (!ai) return { ok: false, error: "Model download requires the desktop app." };
  return ai.downloadModel(modelId, url, fileName);
}

export function subscribeDownload(cb: (p: DownloadProgress) => void): () => void {
  return bridge()?.subscribeDownload(cb) ?? (() => {});
}

export async function detectOllama(
  baseUrl: string,
): Promise<{ available: boolean; models: string[] }> {
  return (await bridge()?.detectOllama(baseUrl)) ?? { available: false, models: [] };
}
