// AI model catalog facade. The data is generated from the public ai.latexdo.org
// catalog during the build and baked into normal desktop releases.

import { aiCatalog } from "./aiCatalog.generated";
import type { LocalModelInfo, ModelTier } from "./aiCatalog";

export type { LocalModelInfo, ModelTier } from "./aiCatalog";

<<<<<<< Updated upstream
// NOTE: point releases move quickly. Verify the latest revisions at build time;
// these are the correct size tier and the URLs follow the stable HF layout.
export const localModelCatalog: LocalModelInfo[] = [
  {
    id: "qwen2.5-coder-3b",
    name: "Qwen2.5 Coder 3B",
    description:
      "Code- and LaTeX-tuned. Best structured tool-calling in the 3B class — the strongest fit for an in-editor agent.",
    params: "3B",
    downloadSize: "~2.0 GB",
    ramEstimate: "~3.3 GB",
    minSystemRamGb: 8,
    tier: "recommended",
    quant: "Q4_K_M",
    downloadUrl:
      "https://huggingface.co/bartowski/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf",
    fileName: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    supportsTools: true,
    strengths: ["LaTeX", "Tool use", "Error fixing"],
  },
  {
    id: "qwen3-4b",
    name: "Qwen3 4B",
    description:
      "Strongest reasoning at the top of the budget, with an optional think mode. Best answers if your machine has the headroom.",
    params: "4B",
    downloadSize: "~2.5 GB",
    ramEstimate: "~3.9 GB",
    minSystemRamGb: 12,
    tier: "balanced",
    quant: "Q4_K_M",
    downloadUrl:
      "https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf",
    fileName: "qwen3-4b-q4_k_m.gguf",
    supportsTools: true,
    strengths: ["Reasoning", "Tool use", "Math"],
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    description:
      "Best pure prose and rewriting. Slightly weaker at structured tool calls, ideal if you mostly want writing help.",
    params: "3B",
    downloadSize: "~2.0 GB",
    ramEstimate: "~3.3 GB",
    minSystemRamGb: 8,
    tier: "balanced",
    quant: "Q4_K_M",
    downloadUrl:
      "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    fileName: "llama-3.2-3b-instruct-q4_k_m.gguf",
    supportsTools: true,
    strengths: ["Prose", "Rewriting", "Summaries"],
  },
  {
    id: "phi-4-mini",
    name: "Phi-4 Mini",
    description:
      "Strong math and structured output. A good pick for theorem-heavy or equation-heavy documents.",
    params: "3.8B",
    downloadSize: "~2.4 GB",
    ramEstimate: "~3.7 GB",
    minSystemRamGb: 10,
    tier: "balanced",
    quant: "Q4_K_M",
    downloadUrl:
      "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
    fileName: "phi-4-mini-instruct-q4_k_m.gguf",
    supportsTools: true,
    strengths: ["Math", "Structure", "Reasoning"],
  },
  {
    id: "smollm2-1.7b",
    name: "SmolLM2 1.7B",
    description:
      "Lightweight fallback for older or low-RAM machines. Fast, capable of basic edits and Q&A.",
    params: "1.7B",
    downloadSize: "~1.1 GB",
    ramEstimate: "~2.0 GB",
    minSystemRamGb: 4,
    tier: "light",
    quant: "Q4_K_M",
    downloadUrl:
      "https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf",
    fileName: "smollm2-1.7b-instruct-q4_k_m.gguf",
    supportsTools: false,
    strengths: ["Low RAM", "Fast", "Q&A"],
  },
  {
    id: "llama-3.2-1b",
    name: "Llama 3.2 1B (inline)",
    description:
      "Tiny, latency-optimized model for inline ghost-text completion. Not intended as the main chat agent.",
    params: "1B",
    downloadSize: "~0.8 GB",
    ramEstimate: "~1.5 GB",
    minSystemRamGb: 4,
    tier: "inline",
    quant: "Q4_K_M",
    downloadUrl:
      "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    fileName: "llama-3.2-1b-instruct-q4_k_m.gguf",
    supportsTools: false,
    strengths: ["Autocomplete", "Very fast"],
  },
];

export const defaultLocalModelId = "qwen2.5-coder-3b";
export const defaultInlineModelId = "llama-3.2-1b";
=======
export const localModelCatalog: readonly LocalModelInfo[] = aiCatalog.localModels;
export const defaultLocalModelId = aiCatalog.defaultLocalModelId;
export const defaultInlineModelId = aiCatalog.defaultInlineModelId;
>>>>>>> Stashed changes

export function findLocalModel(id: string): LocalModelInfo | undefined {
  return localModelCatalog.find((model) => model.id === id);
}

export const tierLabels: Record<ModelTier, string> = {
  recommended: "Recommended",
  balanced: "Balanced",
  light: "Lightweight",
  inline: "Inline completion",
};
