// AI + onboarding configuration store.
//
// Intentionally decoupled from the fuzz-tested AppSettings object so we never
// destabilize its round-trip/key-set invariants. Persisted under its own
// localStorage key with explicit validation, mirroring the settings.ts style.

import type { ColorTheme } from "../settings/settings";
import { defaultLocalModelId, defaultInlineModelId, findLocalModel } from "./aiModels";
import { defaultCloudProviderId, findCloudProvider } from "./cloudProviders";
import {
  defaultResearcherProfile,
  normalizeResearcherProfile,
  type ResearcherProfile,
} from "./researcherProfile";

export type AiProvider = "local" | "ollama" | "cloud" | "off";
/** API wire format aiCloud speaks; OpenAI-compatible vendors use "openai". */
export type CloudVendor = "anthropic" | "openai";
export type LayoutPreset = "focus" | "balanced" | "power";

export interface CloudConfig {
  /** Provider preset id (see cloudProviders.ts): anthropic, openai, gemini, … */
  providerId: string;
  vendor: CloudVendor;
  model: string;
  /** For OpenAI-compatible / self-hosted gateways; empty = vendor default. */
  baseUrl: string;
  /** Stored locally only; never synced. */
  apiKey: string;
}

export interface AiAccessConfig {
  /** Send prior chat turns to the model. The current user prompt is always sent. */
  chatHistory: boolean;
  /** Allow the agent to inspect and edit the currently open editor document. */
  currentEditor: boolean;
  /** Allow the agent to list, read, and write project files. */
  projectFiles: boolean;
  /** Allow the agent to inspect citation indexes and bibliography entries. */
  bibliography: boolean;
  /** Allow the configured researcher profile and fetched papers in prompts. */
  researcherProfile: boolean;
}

export interface AiConfig {
  version: 1;
  setupComplete: boolean;
  userName: string;
  layoutPreset: LayoutPreset;

  provider: AiProvider;
  /** Local GGUF model id (see aiModels catalog). */
  modelId: string;
  /** Whether the local model file has finished downloading. */
  modelDownloaded: boolean;

  inlineCompletionEnabled: boolean;
  inlineModelId: string;

  ollamaBaseUrl: string;
  ollamaModel: string;

  cloud: CloudConfig;

  /** Researcher identity (ORCID / anonymous token) fed to the agent. */
  profile: ResearcherProfile;
  /** Controls which local project/profile context the AI agent may inspect. */
  access: AiAccessConfig;

  /** Agent may write files / run compiles without per-step confirmation. */
  autoApproveEdits: boolean;
  /** Max agent tool-loop iterations before we stop and ask the user. */
  maxAgentSteps: number;
}

export const aiConfigStorageKey = "latexdo.ai.config.v1";

const defaultCloudProvider = findCloudProvider(defaultCloudProviderId);
const defaultCloudConfig: CloudConfig = {
  providerId: defaultCloudProvider?.id ?? defaultCloudProviderId,
  vendor: defaultCloudProvider?.apiShape ?? "anthropic",
  model: defaultCloudProvider?.defaultModel ?? "claude-haiku-4-5",
  baseUrl: defaultCloudProvider?.baseUrl ?? "",
  apiKey: "",
};

export const defaultAiConfig: AiConfig = {
  version: 1,
  setupComplete: false,
  userName: "",
  layoutPreset: "balanced",

  provider: "local",
  modelId: defaultLocalModelId,
  modelDownloaded: false,

  inlineCompletionEnabled: false,
  inlineModelId: defaultInlineModelId,

  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5-coder:3b",

  cloud: defaultCloudConfig,

  profile: defaultResearcherProfile,
  access: {
    chatHistory: true,
    currentEditor: true,
    projectFiles: true,
    bibliography: true,
    researcherProfile: true,
  },

  autoApproveEdits: false,
  maxAgentSteps: 12,
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isProvider(value: unknown): value is AiProvider {
  return (
    value === "local" || value === "ollama" || value === "cloud" || value === "off"
  );
}
function isVendor(value: unknown): value is CloudVendor {
  return value === "openai" || value === "anthropic";
}
function isLayout(value: unknown): value is LayoutPreset {
  return value === "focus" || value === "balanced" || value === "power";
}

function normalizeCloud(value: unknown): CloudConfig {
  const raw = (value ?? {}) as Partial<CloudConfig>;
  // Older configs used "openai-compatible"; fold it into "openai".
  const vendorRaw = raw.vendor as unknown;
  const vendor = vendorRaw === "openai-compatible" ? "openai" : vendorRaw;
  return {
    providerId: str(raw.providerId, defaultAiConfig.cloud.providerId),
    vendor: isVendor(vendor) ? vendor : defaultAiConfig.cloud.vendor,
    model: str(raw.model, defaultAiConfig.cloud.model),
    baseUrl: str(raw.baseUrl, defaultAiConfig.cloud.baseUrl),
    apiKey: str(raw.apiKey, defaultAiConfig.cloud.apiKey),
  };
}

function normalizeAccess(value: unknown): AiAccessConfig {
  const raw = (value ?? {}) as Partial<AiAccessConfig>;
  return {
    chatHistory: bool(raw.chatHistory, defaultAiConfig.access.chatHistory),
    currentEditor: bool(raw.currentEditor, defaultAiConfig.access.currentEditor),
    projectFiles: bool(raw.projectFiles, defaultAiConfig.access.projectFiles),
    bibliography: bool(raw.bibliography, defaultAiConfig.access.bibliography),
    researcherProfile: bool(
      raw.researcherProfile,
      defaultAiConfig.access.researcherProfile,
    ),
  };
}

export function normalizeAiConfig(raw: unknown): AiConfig {
  const saved = (raw ?? {}) as Partial<AiConfig>;
  const modelId = findLocalModel(str(saved.modelId, defaultAiConfig.modelId))
    ? str(saved.modelId, defaultAiConfig.modelId)
    : defaultAiConfig.modelId;
  const inlineModelId = findLocalModel(
    str(saved.inlineModelId, defaultAiConfig.inlineModelId),
  )
    ? str(saved.inlineModelId, defaultAiConfig.inlineModelId)
    : defaultAiConfig.inlineModelId;

  return {
    version: 1,
    setupComplete: bool(saved.setupComplete, defaultAiConfig.setupComplete),
    userName: str(saved.userName, defaultAiConfig.userName).slice(0, 80),
    layoutPreset: isLayout(saved.layoutPreset)
      ? saved.layoutPreset
      : defaultAiConfig.layoutPreset,
    provider: isProvider(saved.provider) ? saved.provider : defaultAiConfig.provider,
    modelId,
    modelDownloaded: bool(saved.modelDownloaded, defaultAiConfig.modelDownloaded),
    inlineCompletionEnabled: bool(
      saved.inlineCompletionEnabled,
      defaultAiConfig.inlineCompletionEnabled,
    ),
    inlineModelId,
    ollamaBaseUrl: str(saved.ollamaBaseUrl, defaultAiConfig.ollamaBaseUrl),
    ollamaModel: str(saved.ollamaModel, defaultAiConfig.ollamaModel),
    cloud: normalizeCloud(saved.cloud),
    profile: normalizeResearcherProfile(saved.profile),
    access: normalizeAccess(saved.access),
    autoApproveEdits: bool(saved.autoApproveEdits, defaultAiConfig.autoApproveEdits),
    maxAgentSteps: int(saved.maxAgentSteps, defaultAiConfig.maxAgentSteps, 1, 50),
  };
}

export function loadAiConfig(): AiConfig {
  try {
    return normalizeAiConfig(
      JSON.parse(window.localStorage.getItem(aiConfigStorageKey) ?? "{}"),
    );
  } catch {
    return defaultAiConfig;
  }
}

export function saveAiConfig(config: AiConfig): void {
  window.localStorage.setItem(aiConfigStorageKey, JSON.stringify(config));
}

/** Layout presets map onto the app's existing panel visibility state. */
export interface LayoutFlags {
  sidebarVisible: boolean;
  previewVisible: boolean;
  panelVisible: boolean;
  minimap: boolean;
}

export const layoutPresetFlags: Record<LayoutPreset, LayoutFlags> = {
  focus: {
    sidebarVisible: false,
    previewVisible: true,
    panelVisible: false,
    minimap: false,
  },
  balanced: {
    sidebarVisible: true,
    previewVisible: true,
    panelVisible: false,
    minimap: true,
  },
  power: {
    sidebarVisible: true,
    previewVisible: true,
    panelVisible: true,
    minimap: true,
  },
};

export const layoutPresetInfo: {
  id: LayoutPreset;
  name: string;
  description: string;
}[] = [
  {
    id: "focus",
    name: "Focus",
    description: "Editor + preview only. Sidebars hidden for distraction-free writing.",
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "File tree, editor, and live PDF preview side by side.",
  },
  {
    id: "power",
    name: "Power",
    description:
      "Everything on: sidebar, preview, and the bottom problems/output panel.",
  },
];

export function suggestedThemeForLayout(_preset: LayoutPreset): ColorTheme {
  return "graphite";
}
