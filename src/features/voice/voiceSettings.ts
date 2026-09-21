// Voice dictation settings.
//
// Mirrors the aiConfig.ts store pattern: its own localStorage key, explicit
// normalization, no side effects. Kept tiny and separate so the fuzz-tested
// AppSettings/aiConfig round-trips are never destabilized by a new feature.

import type { TranscriptMode } from "./types";

export interface VoiceSettings {
  /** "clean" enables the optional punctuation/capitalization pass. */
  transcriptMode: TranscriptMode;
  /** Hard cap for a single dictation. See spec §38 (default 3 minutes). */
  maxDurationMs: number;
  /** Speech model used by the cloud transcription provider. */
  transcriptionModel: string;
  /**
   * OpenAI-compatible speech-to-text endpoint (e.g. a local whisper server
   * at http://localhost:8080/v1, or Groq). Blank falls back to the AI
   * provider's own cloud key when it is OpenAI. The endpoint does NOT have
   * to match the chat provider, so local AI setups can still dictate.
   */
  sttBaseUrl: string;
}

export const voiceSettingsStorageKey = "latexdo.voice.config.v1";
export const defaultMaxVoiceDurationMs = 180_000;

/** Credential vault id for the standalone speech-to-text API key. */
export const voiceSttCredentialId = "credential-voice-stt-primary";

export const defaultVoiceSettings: VoiceSettings = {
  transcriptMode: "clean",
  maxDurationMs: defaultMaxVoiceDurationMs,
  transcriptionModel: "gpt-4o-mini-transcribe",
  sttBaseUrl: "",
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isTranscriptMode(value: unknown): value is TranscriptMode {
  return value === "verbatim" || value === "clean";
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
  const saved = (raw ?? {}) as Partial<VoiceSettings>;
  return {
    transcriptMode: isTranscriptMode(saved.transcriptMode)
      ? saved.transcriptMode
      : defaultVoiceSettings.transcriptMode,
    maxDurationMs: intInRange(
      saved.maxDurationMs,
      defaultVoiceSettings.maxDurationMs,
      5_000, // never below a few seconds
      10 * 60_000,
    ),
    transcriptionModel: str(
      saved.transcriptionModel,
      defaultVoiceSettings.transcriptionModel,
    ),
    sttBaseUrl: str(saved.sttBaseUrl, defaultVoiceSettings.sttBaseUrl),
  };
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    return normalizeVoiceSettings(
      JSON.parse(window.localStorage.getItem(voiceSettingsStorageKey) ?? "{}"),
    );
  } catch {
    return defaultVoiceSettings;
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  window.localStorage.setItem(
    voiceSettingsStorageKey,
    JSON.stringify(normalizeVoiceSettings(settings)),
  );
}