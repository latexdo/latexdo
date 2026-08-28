// Registers ai:* IPC handlers. Cloud generation runs in the renderer; only
// local (node-llama-cpp) and Ollama go through here, plus model management.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { stat } from "node:fs/promises";
import { generateLocalStep } from "./localLlm.js";
import { detectOllama, generateOllamaStep } from "./ollama.js";
import {
  deleteModelFile,
  downloadModelFile,
  listModelFiles,
  modelExists,
  modelPath,
} from "./models.js";
import {
  evaluateImportedModelCompatibility,
  findImportedModelManifest,
  importGgufModel,
  inspectInstalledGgufModel,
  readImportedModelManifests,
} from "./importedModels.js";
import {
  fastTierAvailability,
  findLatexDoAiTier,
  findLatexDoAiTierByRuntime,
  type LatexDoAiTier,
  type TierAvailability,
} from "./productTiers.js";
import { getAiSystemCapabilities } from "./systemCapabilities.js";

interface GenerateRequest {
  requestId: string;
  provider: "local" | "ollama" | "cloud";
  messages: any[];
  tools: any[];
  options: {
    modelId?: string;
    fileName?: string;
    temperature?: number;
    maxTokens?: number;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
  };
}

const inFlight = new Map<string, AbortController>();
const activeDownloads = new Map<string, AbortController>();

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function tierAvailabilityMessage(
  tierName: string,
  availability: TierAvailability,
): string | null {
  if (availability.state === "available") return null;
  if (availability.state === "memory-pressure") {
    return `${tierName} is temporarily unavailable. It needs approximately ${formatGb(
      availability.requiredAvailableBytes,
    )} of available memory; currently available: ${formatGb(
      availability.availableBytes,
    )}. Close some applications and try again.`;
  }
  if (
    typeof availability.requiredSystemRamBytes === "number" &&
    typeof availability.detectedSystemRamBytes === "number"
  ) {
    return `${tierName} is not available on this computer. Required RAM: ${formatGb(
      availability.requiredSystemRamBytes,
    )}. Detected RAM: ${formatGb(availability.detectedSystemRamBytes)}.`;
  }
  return `${tierName} is not available on this computer. ${availability.reason}`;
}

async function localModelBlockReason(
  modelId: string | undefined,
  fileName: string,
): Promise<string | null> {
  const system = getAiSystemCapabilities();
  const tier = findLatexDoAiTierByRuntime(modelId, fileName);
  if (tier) {
    return tierAvailabilityMessage(tier.name, fastTierAvailability(tier, system));
  }

  const fullPath = modelPath(fileName);
  const info = await stat(fullPath).catch(() => null);
  const manifest = await findImportedModelManifest(fileName);
  const compatibility = info
    ? evaluateImportedModelCompatibility(info.size, system)
    : manifest?.compatibility;
  if (!compatibility) return null;
  if (compatibility.state === "unsupported") {
    return (
      compatibility.reason ??
      "This GGUF model is not compatible with the current local runtime."
    );
  }
  if (compatibility.state === "memory-pressure") {
    const required = compatibility.estimatedRamBytes;
    const available = compatibility.availableRamBytes ?? system.freeRamBytes;
    return required
      ? `This GGUF model is temporarily unavailable. Estimated memory: ${formatGb(
          required,
        )}. Currently available: ${formatGb(available)}.`
      : `This GGUF model is temporarily unavailable. Currently available: ${formatGb(
          available,
        )}.`;
  }
  return null;
}

export function registerAiIpc(): void {
  ipcMain.handle(
    "ai:generate-step",
    async (event: IpcMainInvokeEvent, req: GenerateRequest) => {
      const controller = new AbortController();
      inFlight.set(req.requestId, controller);
      const onToken = (text: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("ai:token", { requestId: req.requestId, text });
        }
      };
      try {
        if (req.provider === "ollama") {
          return await generateOllamaStep(
            req.options.ollamaBaseUrl ?? "http://127.0.0.1:11434",
            req.options.ollamaModel ?? "qwen2.5-coder:3b",
            req.messages,
            req.tools,
            onToken,
            controller.signal,
          );
        }
        if (req.provider === "local") {
          if (!req.options.fileName) {
            return { type: "error", content: "No local model selected." };
          }
          const blocked = await localModelBlockReason(
            req.options.modelId,
            req.options.fileName,
          );
          if (blocked) {
            return { type: "error", content: blocked };
          }
          return await generateLocalStep(
            req.messages,
            {
              fileName: req.options.fileName,
              temperature: req.options.temperature,
              maxTokens: req.options.maxTokens,
            },
            onToken,
            controller.signal,
          );
        }
        return {
          type: "error",
          content: "Cloud generation is handled in the renderer, not main.",
        };
      } finally {
        inFlight.delete(req.requestId);
      }
    },
  );

  ipcMain.handle("ai:abort", async (_event, requestId: string) => {
    inFlight.get(requestId)?.abort();
    inFlight.delete(requestId);
  });

  ipcMain.handle("ai:list-models", async () => {
    const files = await listModelFiles();
    const manifests = new Map(
      (await readImportedModelManifests()).map((manifest) => [
        manifest.fileName,
        manifest,
      ]),
    );
    return files.map((f) => ({
      id: f.fileName,
      fileName: f.fileName,
      downloaded: true,
      path: f.path,
      sizeBytes: f.sizeBytes,
      manifest: manifests.get(f.fileName),
    }));
  });

  ipcMain.handle(
    "ai:download-model",
    async (
      event: IpcMainInvokeEvent,
      modelId: string,
      url: string,
      fileName: string,
    ) => {
      const tier = findLatexDoAiTierByRuntime(modelId, fileName);
      if (tier) {
        const blocked = tierAvailabilityMessage(
          tier.name,
          fastTierAvailability(tier, getAiSystemCapabilities()),
        );
        if (blocked) return { ok: false, error: blocked };
      }
      if (await modelExists(fileName)) return { ok: true };
      const controller = new AbortController();
      activeDownloads.set(modelId, controller);
      try {
        await downloadModelFile(url, fileName, {
          signal: controller.signal,
          onProgress: (received, total) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("ai:download-progress", {
                modelId,
                receivedBytes: received,
                totalBytes: total,
                done: false,
              });
            }
          },
        });
        if (!event.sender.isDestroyed()) {
          event.sender.send("ai:download-progress", {
            modelId,
            receivedBytes: 0,
            totalBytes: null,
            done: true,
          });
        }
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!event.sender.isDestroyed()) {
          event.sender.send("ai:download-progress", {
            modelId,
            receivedBytes: 0,
            totalBytes: null,
            done: true,
            error: message,
          });
        }
        return { ok: false, error: message };
      } finally {
        activeDownloads.delete(modelId);
      }
    },
  );

  ipcMain.handle("ai:cancel-download", async (_event, modelId: string) => {
    activeDownloads.get(modelId)?.abort();
    activeDownloads.delete(modelId);
  });

  ipcMain.handle("ai:delete-model", async (_event, fileName: string) => {
    await deleteModelFile(fileName);
  });

  ipcMain.handle("ai:model-path", async (_event, fileName: string) => {
    return (await modelExists(fileName)) ? modelPath(fileName) : null;
  });

  ipcMain.handle("ai:detect-ollama", async (_event, baseUrl: string) => {
    return detectOllama(baseUrl);
  });

  ipcMain.handle("ai:system-capabilities", async () => {
    return getAiSystemCapabilities();
  });

  ipcMain.handle("ai:tier-availability", async (_event, tierId: LatexDoAiTier) => {
    const tier = findLatexDoAiTier(tierId);
    if (!tier) {
      return {
        state: "unsupported",
        reason: "Unknown LatexDo AI tier.",
      } satisfies TierAvailability;
    }
    return fastTierAvailability(tier, getAiSystemCapabilities());
  });

  ipcMain.handle("ai:inspect-local-model", async (_event, fileName: string) => {
    return inspectInstalledGgufModel(fileName);
  });

  ipcMain.handle("ai:import-model", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const dialogOptions = {
      title: "Import GGUF model",
      properties: ["openFile"],
      filters: [{ name: "GGUF models", extensions: ["gguf"] }],
    } satisfies Electron.OpenDialogOptions;
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) return null;
    return importGgufModel(result.filePaths[0]);
  });
}
