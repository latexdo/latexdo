import { describe, expect, it } from "vitest";
import { defaultAiConfig } from "../aiConfig";
import { resolveAiRuntime } from "./aiRuntimeResolver";

describe("resolveAiRuntime", () => {
  it("uses the visible provider over stale legacy selection data", () => {
    expect(
      resolveAiRuntime({
        ...defaultAiConfig,
        provider: "cloud",
        selection: { mode: "latexdo", tier: "latexdo-ai-plus" },
        cloud: {
          ...defaultAiConfig.cloud,
          providerId: "openai",
          vendor: "openai",
          model: "gpt-4.1-mini",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-test",
        },
      }),
    ).toEqual({
      provider: "cloud",
      vendor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
    });
  });

  it("resolves LatexDo tiers to local runtime models only for local configs", () => {
    expect(resolveAiRuntime(defaultAiConfig)).toEqual({
      provider: "local",
      modelId: "qwen2.5-coder-3b",
      fileName: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    });
  });
});
