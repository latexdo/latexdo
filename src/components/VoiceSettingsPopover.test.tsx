import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCloudCredential, saveCloudCredential } from "../features/ai/cloudCredentials";
import { detectLocalTranscriptionServers } from "../features/voice/localTranscriptionDetection";
import { defaultVoiceSettings, type VoiceSettings } from "../features/voice/voiceSettings";
import { VoiceSettingsPopover } from "./VoiceSettingsPopover";

vi.mock("../features/ai/cloudCredentials", () => ({
  loadCloudCredential: vi.fn(),
  saveCloudCredential: vi.fn(),
}));

vi.mock("../features/voice/localTranscriptionDetection", () => ({
  detectLocalTranscriptionServers: vi.fn(),
}));

const settings: VoiceSettings = {
  ...defaultVoiceSettings,
  sttBaseUrl: "http://localhost:8080/v1",
  transcriptionModel: "whisper-large-v3",
};

function openPopover() {
  render(<VoiceSettingsPopover settings={settings} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Voice settings" }));
}

describe("VoiceSettingsPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCloudCredential).mockResolvedValue(null);
    vi.mocked(saveCloudCredential).mockResolvedValue(true);
  });

  it("lets you save an endpoint, model, and API key to the vault", async () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPopover settings={settings} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice settings" }));

    const endpoint = screen.getByLabelText(/Speech-to-text endpoint/i);
    fireEvent.change(endpoint, {
      target: { value: "http://localhost:1234/v1" },
    });
    const key = screen.getByLabelText(/API key/i);
    fireEvent.change(key, { target: { value: "sk-local" } });

    fireEvent.click(screen.getByRole("button", { name: /Save voice settings/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(saveCloudCredential).toHaveBeenCalledWith(
      "credential-voice-stt-primary",
      "sk-local",
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ sttBaseUrl: "http://localhost:1234/v1" }),
    );
  });

  it("detects and applies a local speech server in one click", async () => {
    vi.mocked(detectLocalTranscriptionServers).mockResolvedValueOnce([
      {
        label: "whisper.cpp server · http://localhost:8080/v1",
        baseUrl: "http://localhost:8080/v1",
        models: ["whisper-base", "whisper-large-v3"],
        speechModel: "whisper-large-v3",
      },
    ]);
    const onSave = vi.fn();
    render(<VoiceSettingsPopover settings={settings} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice settings" }));

    fireEvent.click(
      screen.getByRole("button", { name: /Detect local speech server/i }),
    );

    await screen.findByText(/whisper.cpp server/i);
    fireEvent.click(screen.getByRole("button", { name: /whisper.cpp server/i }));

    const endpoint = screen.getByLabelText(/Speech-to-text endpoint/i);
    expect((endpoint as HTMLInputElement).value).toBe(
      "http://localhost:8080/v1",
    );
    const model = screen.getByLabelText(/^Model/i) as HTMLInputElement;
    expect(model.value).toBe("whisper-large-v3");

    fireEvent.click(screen.getByRole("button", { name: /Save voice settings/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sttBaseUrl: "http://localhost:8080/v1",
        transcriptionModel: "whisper-large-v3",
      }),
    );
  });

  it("reports when no local server responds", async () => {
    vi.mocked(detectLocalTranscriptionServers).mockResolvedValueOnce([]);
    openPopover();

    fireEvent.click(
      screen.getByRole("button", { name: /Detect local speech server/i }),
    );

    await screen.findByText(/No local speech server found/i);
  });
});