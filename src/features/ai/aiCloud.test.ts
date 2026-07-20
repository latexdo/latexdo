import { describe, it, expect, vi, afterEach } from "vitest";
import { generateStepCloud } from "./aiCloud";
import type { GenerateRequest } from "./aiTypes";

function req(options: GenerateRequest["options"]): GenerateRequest {
  return {
    requestId: "t",
    provider: "cloud",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    options,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateStepCloud — provider routing", () => {
  it("calls the Anthropic Messages API with x-api-key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const step = await generateStepCloud(
      req({ cloudVendor: "anthropic", cloudModel: "claude-haiku-4-5", cloudApiKey: "sk-ant" }),
      () => {},
    );

    expect(step).toEqual({ type: "text", content: "ok" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant");
  });

  it("calls an OpenAI-compatible endpoint with a Bearer token and honors baseUrl", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const step = await generateStepCloud(
      req({
        cloudVendor: "openai",
        cloudBaseUrl: "https://api.groq.com/openai/v1",
        cloudModel: "llama-3.3-70b-versatile",
        cloudApiKey: "gsk_123",
      }),
      () => {},
    );

    expect(step).toEqual({ type: "text", content: "ok" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer gsk_123",
    );
  });

  it("surfaces a non-2xx response as an error step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    const step = await generateStepCloud(
      req({ cloudVendor: "openai", cloudApiKey: "bad" }),
      () => {},
    );
    expect(step.type).toBe("error");
    expect(step.content).toMatch(/401/);
  });
});
