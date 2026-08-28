// Shared types for the AI agent: chat messages, tool schemas, and the
// single-step generation protocol used across all providers (local / ollama /
// cloud). The agent loop lives in the renderer (aiAgent.ts); providers only
// implement one "generate one step" call and return either assistant text or a
// batch of tool calls.

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments object. */
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool-result messages; links back to the ToolCall id. */
  toolCallId?: string;
  /** Optional label for UI (e.g. the tool name that produced a result). */
  name?: string;
}

/** JSON-schema-ish parameter description for a tool. */
export interface ToolParam {
  type: "string" | "number" | "boolean" | "integer";
  description: string;
  enum?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  required: string[];
}

/** Result the renderer sends back after executing a tool. */
export interface ToolResult {
  ok: boolean;
  /** Human/model-readable payload (stringified for the model). */
  content: string;
  /** Optional structured data for the UI (e.g. a diff to render). */
  ui?: unknown;
}

/** One decoded generation step returned by a provider. */
export type GenerationStep =
  | { type: "text"; content: string }
  | { type: "tool_calls"; content: string; toolCalls: ToolCall[] }
  | { type: "error"; content: string };

/** Streaming delta pushed from main -> renderer during generation. */
export interface GenerationDelta {
  /** Correlates deltas to a single ai:generate request. */
  requestId: string;
  kind: "token" | "done" | "error";
  text?: string;
  step?: GenerationStep;
}

/** Request payload sent renderer -> main for one generation step. */
export interface GenerateRequest {
  requestId: string;
  provider: "local" | "ollama" | "cloud";
  messages: ChatMessage[];
  tools: ToolSchema[];
  options: {
    modelId?: string;
    /** GGUF file name (for the main process to resolve under the models dir). */
    fileName?: string;
    modelPath?: string;
    temperature?: number;
    maxTokens?: number;
    // provider-specific config
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    cloudVendor?: string;
    cloudBaseUrl?: string;
    cloudModel?: string;
    cloudApiKey?: string;
  };
}

export interface ModelStatus {
  id: string;
  fileName: string;
  downloaded: boolean;
  path: string | null;
  sizeBytes: number | null;
  manifest?: ImportedModelManifest;
}

export interface DownloadProgress {
  modelId: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
}

export interface AiSystemCapabilities {
  totalRamBytes: number;
  freeRamBytes: number;
  platform: string;
  arch: string;
  cpuCount: number;
  localAiAvailable: boolean;
}

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

export type ToolSupport = "native" | "prompt-fallback" | "unknown" | "unsupported";

export interface ImportedModelManifest {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  path: string | null;
  downloaded: boolean;
  sizeBytes: number;
  modelName?: string;
  architecture?: string;
  parameterCount?: number;
  contextLength?: number;
  quantization?: string;
  compatibility: {
    state: "compatible" | "memory-pressure" | "unsupported" | "unknown";
    estimatedRamBytes?: number;
    estimatedVramBytes?: number;
    availableRamBytes?: number;
    reason?: string;
    checkedAt: string;
  };
  capabilities: {
    toolUse: ToolSupport;
  };
}
