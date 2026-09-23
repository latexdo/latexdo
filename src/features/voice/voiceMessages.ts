// Friendly, user-facing messages for structured voice errors. Provider
// internals are never shown; raw audio and transcript content are never logged.

import type { VoiceDictationError } from "./types";

export function voiceErrorMessage(error: VoiceDictationError | null): string | null {
  if (!error) return null;
  switch (error.code) {
    case "permission-denied":
      return "Microphone access was denied. Enable microphone permission for LatexDo and try again.";
    case "device-not-found":
      return "No microphone was detected.";
    case "device-unavailable":
      return "LatexDo couldn't access the microphone. Another application may be using it.";
    case "recording-failed":
      return "Voice recording failed. Your existing text was not changed.";
    case "empty-recording":
      return "No speech was detected.";
    case "transcription-failed":
      return "Voice transcription failed. Your existing text was not changed.";
    case "unsupported":
      return "Your microphone works — pick a speech-to-text engine in the mic gear icon (Detect local speech server), or use an OpenAI cloud provider.";
    case "cancelled":
      return null;
    case "cleanup-failed":
      return null;
    default:
      return "Voice dictation failed. Your existing text was not changed.";
  }
}
