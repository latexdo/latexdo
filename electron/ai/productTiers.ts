import type { AiSystemCapabilities } from "./systemCapabilities.js";

export const GB = 1024 ** 3;

export type LatexDoAiTier =
  | "latexdo-ai"
  | "latexdo-ai-plus"
  | "latexdo-pro"
  | "latexdo-pro-max";

export type TierAvailability =
  | { state: "available" }
  | {
      state: "memory-pressure";
      requiredAvailableBytes: number;
      availableBytes: number;
    }
  | {
      state: "unsupported";
      reason: string;
      requiredSystemRamBytes?: number;
      detectedSystemRamBytes?: number;
    };

export interface LatexDoAiTierDefinition {
  id: LatexDoAiTier;
  name: string;
  description: string;
  runtime: {
    modelId: string;
    fileName: string;
    downloadUrl: string;
  };
  requirements: {
    minSystemRamBytes: number;
    minAvailableRamBytes: number;
  };
}

export const latexDoAiTiers: readonly LatexDoAiTierDefinition[] = [
  {
    id: "latexdo-ai",
    name: "LatexDo AI",
    description: "Fast, capable, everyday AI",
    runtime: {
      modelId: "qwen2.5-coder-1.5b",
      fileName: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf",
    },
    requirements: {
      minSystemRamBytes: 8 * GB,
      minAvailableRamBytes: 3 * GB,
    },
  },
  {
    id: "latexdo-ai-plus",
    name: "LatexDo AI Plus",
    description: "Smarter, stronger, more capable",
    runtime: {
      modelId: "qwen2.5-coder-3b",
      fileName: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf",
    },
    requirements: {
      minSystemRamBytes: 8 * GB,
      minAvailableRamBytes: 4 * GB,
    },
  },
  {
    id: "latexdo-pro",
    name: "LatexDo Pro",
    description: "Advanced AI for professionals",
    runtime: {
      modelId: "qwen3-4b",
      fileName: "qwen3-4b-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf",
    },
    requirements: {
      minSystemRamBytes: 12 * GB,
      minAvailableRamBytes: 6 * GB,
    },
  },
  {
    id: "latexdo-pro-max",
    name: "LatexDo Pro Max",
    description: "Our most powerful AI",
    runtime: {
      modelId: "qwen3-8b",
      fileName: "qwen3-8b-q4_k_m.gguf",
      downloadUrl:
        "https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf",
    },
    requirements: {
      minSystemRamBytes: 16 * GB,
      minAvailableRamBytes: 8 * GB,
    },
  },
];

export function findLatexDoAiTier(tier: string): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find((item) => item.id === tier);
}

export function findLatexDoAiTierByRuntime(
  modelId: string | undefined,
  fileName: string | undefined,
): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find(
    (item) => item.runtime.modelId === modelId || item.runtime.fileName === fileName,
  );
}

export function fastTierAvailability(
  tier: LatexDoAiTierDefinition,
  system: AiSystemCapabilities,
): TierAvailability {
  if (!system.localAiAvailable) {
    return {
      state: "unsupported",
      reason: "Local AI is not available in this runtime.",
    };
  }
  if (system.totalRamBytes < tier.requirements.minSystemRamBytes) {
    return {
      state: "unsupported",
      reason: "Insufficient physical memory",
      requiredSystemRamBytes: tier.requirements.minSystemRamBytes,
      detectedSystemRamBytes: system.totalRamBytes,
    };
  }
  if (system.freeRamBytes < tier.requirements.minAvailableRamBytes) {
    return {
      state: "memory-pressure",
      requiredAvailableBytes: tier.requirements.minAvailableRamBytes,
      availableBytes: system.freeRamBytes,
    };
  }
  return { state: "available" };
}
