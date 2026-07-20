// Catalog of cloud LLM providers the user can connect to (bring-your-own-key).
// Most vendors are OpenAI-compatible, so `apiShape` selects how aiCloud.ts talks
// to them: "anthropic" (Claude native Messages API) or "openai" (OpenAI-style
// /chat/completions, used by OpenAI itself and every compatible gateway).
//
// Model IDs move fast, so `models` are suggestions rendered as a datalist — the
// field stays free-text so a user can type any model their account supports.

export type ApiShape = "anthropic" | "openai";

export interface CloudProviderPreset {
  id: string;
  label: string;
  apiShape: ApiShape;
  /** Empty => aiCloud uses the vendor's default endpoint. */
  baseUrl: string;
  models: string[];
  defaultModel: string;
  /** Where the user gets an API key. */
  apiKeyUrl: string;
  /** True => user must supply the base URL themselves. */
  custom?: boolean;
}

export const cloudProviders: CloudProviderPreset[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    apiShape: "anthropic",
    baseUrl: "",
    models: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"],
    defaultModel: "claude-haiku-4-5",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    apiShape: "openai",
    baseUrl: "",
    models: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
    defaultModel: "gpt-4o-mini",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    apiShape: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    defaultModel: "gemini-2.0-flash",
    apiKeyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    label: "Groq",
    apiShape: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    defaultModel: "llama-3.3-70b-versatile",
    apiKeyUrl: "https://console.groq.com/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    apiShape: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "mistral",
    label: "Mistral",
    apiShape: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
    defaultModel: "mistral-large-latest",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter (many models)",
    apiShape: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "anthropic/claude-sonnet-5",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
    ],
    defaultModel: "openai/gpt-4o-mini",
    apiKeyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    apiShape: "openai",
    baseUrl: "",
    models: [],
    defaultModel: "",
    apiKeyUrl: "",
    custom: true,
  },
];

export function findCloudProvider(id: string): CloudProviderPreset | undefined {
  return cloudProviders.find((provider) => provider.id === id);
}

export const defaultCloudProviderId = "anthropic";
