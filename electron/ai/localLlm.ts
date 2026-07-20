// Local inference via node-llama-cpp. Loaded lazily and defensively so the app
// still boots if the native module isn't installed (e.g. web-only dev). The
// renderer runs the agent loop and uses a JSON tool protocol, so here we only
// need plain streaming chat completion — no native function-calling required.

import { modelPath } from "./models.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

interface GenerateOptions {
  fileName: string;
  temperature?: number;
  maxTokens?: number;
}

type GenerationStep =
  | { type: "text"; content: string }
  | { type: "error"; content: string };

// node-llama-cpp has no bundled types until installed; keep these loose.
/* eslint-disable @typescript-eslint/no-explicit-any */
// Resolved via a variable specifier so `tsc` doesn't hard-fail when the
// optional native module isn't installed (web-only dev, CI without rebuild).
const nodeLlamaCppSpecifier = "node-llama-cpp";
async function importLlamaCpp(): Promise<any> {
  return import(/* @vite-ignore */ nodeLlamaCppSpecifier);
}

let llamaPromise: Promise<any> | null = null;
let loadedModel: { path: string; model: any } | null = null;

async function getLlama(): Promise<any> {
  if (!llamaPromise) {
    llamaPromise = (async () => {
      const mod: any = await importLlamaCpp();
      return mod.getLlama();
    })();
  }
  return llamaPromise;
}

async function loadModel(fileName: string): Promise<any> {
  const fullPath = modelPath(fileName);
  if (loadedModel && loadedModel.path === fullPath) {
    return loadedModel.model;
  }
  const llama = await getLlama();
  if (loadedModel) {
    try {
      await loadedModel.model.dispose();
    } catch {
      /* ignore */
    }
    loadedModel = null;
  }
  const model = await llama.loadModel({ modelPath: fullPath });
  loadedModel = { path: fullPath, model };
  return model;
}

function toHistory(messages: ChatMessage[]): {
  systemPrompt: string;
  history: { type: "system" | "user" | "model"; text: string }[];
  lastPrompt: string;
} {
  const systemPrompt = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const nonSystem = messages.filter((m) => m.role !== "system");
  const history: { type: "user" | "model"; text: string }[] = [];
  for (const m of nonSystem) {
    if (m.role === "assistant") {
      history.push({ type: "model", text: m.content });
    } else if (m.role === "tool") {
      history.push({ type: "user", text: `Tool ${m.name ?? ""} result:\n${m.content}` });
    } else {
      history.push({ type: "user", text: m.content });
    }
  }
  // The last user/tool turn is the live prompt; the rest is prior history.
  let lastPrompt = "";
  if (history.length && history[history.length - 1].type === "user") {
    lastPrompt = history.pop()!.text;
  }
  return { systemPrompt, history, lastPrompt };
}

export async function generateLocalStep(
  messages: ChatMessage[],
  options: GenerateOptions,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<GenerationStep> {
  try {
    const mod: any = await importLlamaCpp();
    const model = await loadModel(options.fileName);
    const context = await model.createContext({ contextSize: 8192 });
    try {
      const sequence = context.getSequence();
      const { systemPrompt, history, lastPrompt } = toHistory(messages);
      const session = new mod.LlamaChatSession({
        contextSequence: sequence,
        systemPrompt,
      });
      if (history.length) {
        const wrapped = [
          { type: "system", text: systemPrompt },
          ...history,
        ];
        session.setChatHistory(wrapped);
      }

      let full = "";
      const response = await session.prompt(lastPrompt || " ", {
        temperature: options.temperature ?? 0.3,
        maxTokens: options.maxTokens ?? 2048,
        signal,
        onTextChunk: (chunk: string) => {
          full += chunk;
          onToken(chunk);
        },
      });
      return { type: "text", content: (response as string) || full };
    } finally {
      try {
        await context.dispose();
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      return { type: "text", content: "" };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/Cannot find module 'node-llama-cpp'|ERR_MODULE_NOT_FOUND/.test(message)) {
      return {
        type: "error",
        content:
          "The local model runtime (node-llama-cpp) is not installed in this build. Run `npm install node-llama-cpp` and rebuild, or switch to a cloud provider.",
      };
    }
    return { type: "error", content: `Local model error: ${message}` };
  }
}
