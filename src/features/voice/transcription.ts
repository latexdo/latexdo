// Speech-to-text providers. This module turns an audio Blob into a literal
// transcript. It knows nothing about React, the editor, or the state machine.
//
// Cloud transcription is implemented in the renderer through the existing
// cloud-credential model (never a persisted renderer key) and the OpenAI
// `audio/transcriptions` endpoint, which is served by OpenAI-compatible
// gateways. Audio is NEVER routed through the app's chat-completion pipeline.

import type { AiConfig } from "../ai/aiConfig";
import { loadCloudCredential } from "../ai/cloudCredentials";
import {
  voiceError,
  type TranscriptionProvider,
  type TranscriptionResult,
  type VoiceDictationError,
} from "./types";

/** Error carrying a structured code; used by the state machine mapping. */
export class TranscriptionError extends Error {
  readonly code: MaybeTranscriptionErrorCode;
  constructor(code: MaybeTranscriptionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.cause = cause;
  }
  toVoiceDictationError(): VoiceDictationError {
    return voiceError(this.code, this.message, this.cause);
  }
}

type MaybeTranscriptionErrorCode =
  | "transcription-failed"
  | "empty-recording"
  | "cancelled"
  | "unsupported"
  | "permission-denied";

export interface OpenAiTranscriptionProviderOptions {
  /** Base URL including the `/v1` suffix; empty = official OpenAI. */
  baseUrl?: string;
  /** Speech model. Defaults to a dedicated transcription model. */
  model?: string;
  /** Credential id resolved from the OS vault at request time. */
  credentialId: string;
  /**
   * Local speech servers (whisper.cpp, LM Studio, …) usually need no key.
   * When true, a missing vault key is fine and no Authorization header is
   * sent; the server's own access rules decide.
   */
  allowKeyless?: boolean;
  /** Max characters of provider error payload we retain in messages. */
  maxErrorChars?: number;
}

export const defaultTranscriptionModel = "gpt-4o-mini-transcribe";

export function audioExtensionForType(mimeType: string | undefined): string {
  const type = mimeType ?? "";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("wav")) return "wav";
  if (type.includes("mp3")) return "mp3";
  return "webm";
}

function sanitizeProviderError(text: string, maxChars: number): string {
  let cleaned = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isControl =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
    if (!isControl) cleaned += text[i];
  }
  cleaned = cleaned.trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned;
}

export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  readonly id = "openai";

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly credentialId: string;
  private readonly allowKeyless: boolean;
  private readonly maxErrorChars: number;

  constructor(options: OpenAiTranscriptionProviderOptions) {
    this.baseUrl = options.baseUrl?.trim() || "https://api.openai.com/v1";
    this.model = options.model?.trim() || defaultTranscriptionModel;
    this.credentialId = options.credentialId;
    this.allowKeyless = options.allowKeyless ?? false;
    this.maxErrorChars = options.maxErrorChars ?? 160;
  }

  async transcribe(request: {
    audio: Blob;
    language?: string;
    signal?: AbortSignal;
  }): Promise<TranscriptionResult> {
    const apiKey = await loadCloudCredential(this.credentialId);
    if (!apiKey && !this.allowKeyless) {
      throw new TranscriptionError(
        "permission-denied",
        "Voice transcription isn't configured. Open AI settings and re-enter your API key.",
      );
    }

    const form = new FormData();
    form.append(
      "file",
      request.audio,
      `recording.${audioExtensionForType(request.audio.type)}`,
    );
    form.append("model", this.model);
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (request.language) form.append("language", request.language);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        body: form,
        signal: request.signal,
      });
    } catch (err) {
      if (isAbortError(err, request.signal)) {
        throw new TranscriptionError(
          "cancelled",
          "Voice transcription cancelled.",
          err,
        );
      }
      throw new TranscriptionError(
        "transcription-failed",
        "Voice transcription failed. Your existing text was not changed.",
        err,
      );
    }

    if (!response.ok) {
      throw new TranscriptionError(
        "transcription-failed",
        `Voice transcription failed (${response.status}). Your existing text was not changed.`,
        sanitizeProviderError(await safeText(response), this.maxErrorChars),
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new TranscriptionError(
        "transcription-failed",
        "Voice transcription failed. Your existing text was not changed.",
        err,
      );
    }

    const text =
      typeof (data as { text?: unknown })?.text === "string"
        ? ((data as { text: string }).text as string).trim()
        : "";
    if (!text) {
      throw new TranscriptionError("empty-recording", "No speech was detected.", data);
    }

    const language =
      typeof (data as { language?: unknown })?.language === "string"
        ? ((data as { language: string }).language as string)
        : undefined;
    return { text, language };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return (
    err instanceof DOMException && err.name === "AbortError" // DOMException may be undefined in odd runtimes
  );
}

/**
 * Build the transcription provider for voice dictation.
 *
 * Resolution order:
 *   1. A standalone speech-to-text endpoint (`options.baseUrl` + its own vault
 *      `options.credentialId`). This lets ANY AI setup dictate — local models,
 *      Ollama, Anthropic — by pointing at an OpenAI-compatible audio endpoint
 *      (local whisper server, Groq, etc.). The chat provider is irrelevant.
 *   2. The app's configured cloud provider, but ONLY when it is OpenAI
 *      (Anthropic-only cloud setups return null and dictation reports
 *      "unsupported" rather than silently routing audio through chat).
 *
 * Audio is never routed through the chat-completion pipeline.
 */
export function createTranscriptionProvider(
  config: AiConfig,
  options?: { model?: string; baseUrl?: string; credentialId?: string },
): TranscriptionProvider | null {
  const explicitBaseUrl = (options?.baseUrl ?? "").trim();
  const explicitCredentialId = (options?.credentialId ?? "").trim();
  if (explicitBaseUrl && explicitCredentialId) {
    return new OpenAiTranscriptionProvider({
      baseUrl: explicitBaseUrl,
      model: options?.model,
      credentialId: explicitCredentialId,
      // An explicitly configured endpoint is the user pointing at a local
      // (or proxy) speech server; those generally don't require an API key.
      allowKeyless: true,
    });
  }

  if (config.provider !== "cloud") return null;
  if (config.cloud.vendor !== "openai") return null;
  if (!config.cloud.credentialId) return null;
  return new OpenAiTranscriptionProvider({
    baseUrl: config.cloud.baseUrl,
    model: options?.model,
    credentialId: config.cloud.credentialId,
  });
}
