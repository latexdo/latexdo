import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCloudCredential } from "../ai/cloudCredentials";
import { defaultAiConfig, type AiConfig } from "../ai/aiConfig";
import {
  OpenAiTranscriptionProvider,
  TranscriptionError,
  audioExtensionForType,
  createTranscriptionProvider,
} from "./transcription";

vi.mock("../ai/cloudCredentials", () => ({
  loadCloudCredential: vi.fn(),
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async json() {
      return body;
    },
  } as unknown as Response;
}

const fetchMock =
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function provider(
  opts: Partial<{ baseUrl: string; model: string; credentialId: string }> = {},
) {
  return new OpenAiTranscriptionProvider({
    baseUrl: opts.baseUrl,
    model: opts.model,
    credentialId: opts.credentialId ?? "credential-openai-primary",
  });
}

function audio(size = 100): Blob {
  return new Blob([new Uint8Array(size)], { type: "audio/webm" });
}

describe("transcription provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCloudCredential).mockResolvedValue("sk-test");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a multipart request to the transcription endpoint with the vaulted key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "Hello world." }));

    const result = await provider().transcribe({
      audio: audio(),
      language: "en",
    });

    expect(result.text).toBe("Hello world.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/audio/transcriptions");

    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(headers["content-type"]).toBeUndefined(); // multipart managed by FormData

    const body = init?.body as FormData;
    expect(body.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(body.get("response_format")).toBe("json");
    expect(body.get("language")).toBe("en");
    expect(body.get("temperature")).toBe("0");
    const file = body.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe("recording.webm");
  });

  it("honours a custom base URL and model", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "hi" }));
    await provider({
      baseUrl: "https://gateway.example.com/v1",
      model: "whisper-1",
    }).transcribe({ audio: audio() });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://gateway.example.com/v1/audio/transcriptions");
    expect((init?.body as FormData).get("model")).toBe("whisper-1");
  });

  it("uses the vaulted credential resolution (no key in renderer state)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "ok" }));
    const result = await provider().transcribe({ audio: audio() });
    expect(result.text).toBe("ok");
    expect(loadCloudCredential).toHaveBeenCalledWith("credential-openai-primary");
  });

  it("fails with permission-denied when no credential is available", async () => {
    vi.mocked(loadCloudCredential).mockResolvedValueOnce(null);
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows keyless local speech servers when opted in", async () => {
    // Local whisper servers usually need no Authorization header.
    vi.mocked(loadCloudCredential).mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "local" }));

    const result = await new OpenAiTranscriptionProvider({
      credentialId: "credential-voice-stt-primary",
      baseUrl: "http://localhost:8080/v1",
      model: "whisper-large-v3",
      allowKeyless: true,
    }).transcribe({ audio: audio() });

    expect(result.text).toBe("local");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8080/v1/audio/transcriptions");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("maps provider HTTP errors to transcription-failed", async () => {
    vi.mocked(loadCloudCredential).mockResolvedValueOnce("sk-testa");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, "unauthorized \u0000\ninvalid key"),
    );
    const err = await provider()
      .transcribe({ audio: audio() })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).code).toBe("transcription-failed");
    expect((err as TranscriptionError).message).toContain("401");
  });

  it("maps an empty transcript to empty-recording", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { text: "   " }));
    await expect(provider().transcribe({ audio: audio() })).rejects.toMatchObject({
      code: "empty-recording",
    });
  });

  it("aborts the network request when the signal is aborted", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    controller.abort();
    await expect(
      provider().transcribe({ audio: audio(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("derives the file extension from the recorded MIME type", () => {
    expect(audioExtensionForType("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtensionForType("audio/mp4")).toBe("m4a");
    expect(audioExtensionForType("audio/ogg")).toBe("ogg");
    expect(audioExtensionForType("audio/wav")).toBe("wav");
    expect(audioExtensionForType(undefined)).toBe("webm");
  });
});

describe("createTranscriptionProvider resolution", () => {
  it("prefers an explicit standalone endpoint, even for non-cloud setups", () => {
    // Anthropic-only cloud + no STT endpoint → unsupported.
    const anthropic: AiConfig = {
      ...defaultAiConfig,
      provider: "cloud",
      cloud: {
        ...defaultAiConfig.cloud,
        vendor: "anthropic",
        credentialConfigured: true,
      },
    };
    expect(createTranscriptionProvider(anthropic)).toBeNull();

    // Add a standalone OpenAI-compatible speech endpoint (local whisper /
    // Groq): now dictation works while the chat provider stays Anthropic.
    const provider = createTranscriptionProvider(anthropic, {
      baseUrl: "http://localhost:8080/v1",
      credentialId: "credential-voice-stt-primary",
      model: "whisper-large-v3",
    });
    expect(provider).toBeInstanceOf(OpenAiTranscriptionProvider);
  });

  it("falls back to the configured OpenAI cloud provider when no endpoint is set", () => {
    const openai: AiConfig = {
      ...defaultAiConfig,
      provider: "cloud",
      cloud: {
        ...defaultAiConfig.cloud,
        vendor: "openai",
        credentialConfigured: true,
        credentialId: "credential-openai-primary",
      },
    };
    expect(createTranscriptionProvider(openai, { model: "x" })).toBeInstanceOf(
      OpenAiTranscriptionProvider,
    );
  });

  it("does not fall back through Anthropic or no-credential cloud configs", () => {
    expect(
      createTranscriptionProvider({
        ...defaultAiConfig,
        provider: "cloud",
        cloud: { ...defaultAiConfig.cloud, vendor: "anthropic" },
      }),
    ).toBeNull();
    expect(
      createTranscriptionProvider({
        ...defaultAiConfig,
        provider: "off",
      }),
    ).toBeNull();
  });
});
