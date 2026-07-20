// Registers ai:* IPC handlers. Cloud generation runs in the renderer; only
// local (node-llama-cpp) and Ollama go through here, plus model management.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { generateLocalStep } from "./localLlm.js";
import { detectOllama, generateOllamaStep } from "./ollama.js";
import {
  deleteModelFile,
  downloadModelFile,
  listModelFiles,
  modelExists,
  modelPath,
} from "./models.js";

interface GenerateRequest {
  requestId: string;
  provider: "local" | "ollama" | "cloud";
  messages: any[];
  tools: any[];
  options: {
    fileName?: string;
    temperature?: number;
    maxTokens?: number;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
  };
}

const inFlight = new Map<string, AbortController>();
const activeDownloads = new Map<string, AbortController>();

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
    return files.map((f) => ({
      id: f.fileName,
      fileName: f.fileName,
      downloaded: true,
      path: f.path,
      sizeBytes: f.sizeBytes,
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
}
