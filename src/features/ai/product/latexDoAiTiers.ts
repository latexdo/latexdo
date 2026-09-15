import type { AiSystemCapabilities, TierAvailability } from "../aiTypes";
import { findLocalModel } from "../aiModels";

export const GB = 1024 ** 3;
const storageHeadroomBytes = 256 * 1024 ** 2;

export type LatexDoAiTier =
  | "latexdo-ai"
  | "latexdo-ai-plus"
  | "latexdo-pro"
  | "latexdo-pro-max";

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
    minAvailableStorageBytes: number;
  };
}

interface LatexDoAiTierProduct {
  id: LatexDoAiTier;
  name: string;
  description: string;
  runtimeModelId: string;
}

const tierProducts: readonly LatexDoAiTierProduct[] = [
  {
    id: "latexdo-ai",
    name: "LatexDo AI",
    description: "Fast, capable, everyday AI",
    runtimeModelId: "qwen2.5-coder-1.5b",
  },
  {
    id: "latexdo-ai-plus",
    name: "LatexDo AI Plus",
    description: "Smarter, stronger, more capable",
    runtimeModelId: "qwen2.5-coder-3b",
  },
  {
    id: "latexdo-pro",
    name: "LatexDo Pro",
    description: "Advanced AI for professionals",
    runtimeModelId: "qwen3-4b",
  },
  {
    id: "latexdo-pro-max",
    name: "LatexDo Pro Max",
    description: "Our most powerful AI",
    runtimeModelId: "qwen3-8b",
  },
];

function gbToBytes(value: number): number {
  return Math.round(value * GB);
}

function downloadSizeToBytes(value: string): number {
  const match = /([\d.]+)\s*(GB|MB)\b/i.exec(value);
  if (!match) {
    throw new Error(`Invalid local model download size: ${value}`);
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid local model download size: ${value}`);
  }
  const unit = match[2].toUpperCase();
  return Math.round(amount * (unit === "GB" ? GB : 1024 ** 2));
}

function storageRequirementBytes(downloadSize: string): number {
  return Math.ceil(downloadSizeToBytes(downloadSize) * 1.15 + storageHeadroomBytes);
}

function toTierDefinition(product: LatexDoAiTierProduct): LatexDoAiTierDefinition {
  const runtime = findLocalModel(product.runtimeModelId);
  if (!runtime) {
    throw new Error(`Missing LatexDo AI runtime model: ${product.runtimeModelId}`);
  }
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    runtime: {
      modelId: runtime.id,
      fileName: runtime.fileName,
      downloadUrl: runtime.downloadUrl,
    },
    requirements: {
      minSystemRamBytes: gbToBytes(runtime.minSystemRamGb),
      minAvailableRamBytes: gbToBytes(runtime.minAvailableRamGb),
      minAvailableStorageBytes: storageRequirementBytes(runtime.downloadSize),
    },
  };
}

export const latexDoAiTiers: readonly LatexDoAiTierDefinition[] =
  tierProducts.map(toTierDefinition);

export const defaultLatexDoAiTier: LatexDoAiTier = "latexdo-ai-plus";

export function findLatexDoAiTier(tier: string): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find((item) => item.id === tier);
}

export function findLatexDoAiTierByModelId(
  modelId: string,
): LatexDoAiTierDefinition | undefined {
  return latexDoAiTiers.find((item) => item.runtime.modelId === modelId);
}

export function resolveLatexDoAiTier(tier: LatexDoAiTier): LatexDoAiTierDefinition {
  const definition = findLatexDoAiTier(tier);
  if (!definition) {
    throw new Error(`Unknown LatexDo AI tier: ${tier}`);
  }
  return definition;
}

export function fastTierAvailability(
  tier: LatexDoAiTierDefinition,
  system: AiSystemCapabilities | null,
): TierAvailability {
  if (!system?.localAiAvailable) {
    return {
      state: "unsupported",
      reason: "Local AI requires the LatexDo desktop app.",
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
  if (system.freeStorageBytes === null) {
    return {
      state: "unsupported",
      reason: "Could not check available storage for local AI models.",
    };
  }
  if (system.freeStorageBytes < tier.requirements.minAvailableStorageBytes) {
    return {
      state: "storage-pressure",
      requiredAvailableStorageBytes: tier.requirements.minAvailableStorageBytes,
      availableStorageBytes: system.freeStorageBytes,
    };
  }
  return { state: "available" };
}
