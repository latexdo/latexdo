import { describe, expect, it } from "vitest";
import {
  defaultLocalTranscriptionBaseUrl,
  normalizeVoiceSettings,
} from "./voiceSettings";

describe("voiceSettings", () => {
  it("defaults blank speech settings to local transcription", () => {
    expect(normalizeVoiceSettings({ sttBaseUrl: "", transcriptionModel: "" }))
      .toMatchObject({
        sttBaseUrl: defaultLocalTranscriptionBaseUrl,
        transcriptionModel: "whisper-1",
      });
  });

  it("migrates the old cloud transcription model name to the local default", () => {
    expect(
      normalizeVoiceSettings({
        sttBaseUrl: "http://localhost:8080/v1",
        transcriptionModel: "gpt-4o-mini-transcribe",
      }).transcriptionModel,
    ).toBe("whisper-1");
  });

  it("migrates remote speech endpoints back to bundled local speech", () => {
    expect(
      normalizeVoiceSettings({
        sttBaseUrl: "https://api.openai.com/v1",
        transcriptionModel: "whisper-1",
      }).sttBaseUrl,
    ).toBe(defaultLocalTranscriptionBaseUrl);
  });
});
