import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectLocalTranscriptionServers } from "../features/voice/localTranscriptionDetection";
import {
  defaultLocalTranscriptionBaseUrl,
  defaultVoiceSettings,
  type VoiceSettings,
} from "../features/voice/voiceSettings";
import { VoiceSettingsPopover } from "./VoiceSettingsPopover";

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
  });

  it("lets you save the bundled endpoint and model", async () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPopover settings={settings} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice settings" }));

    const endpoint = screen.getByLabelText(/Bundled speech endpoint/i);
    fireEvent.change(endpoint, {
      target: { value: "http://localhost:1234/v1" },
    });
    const model = screen.getByLabelText(/^Model/i);
    fireEvent.change(model, { target: { value: "whisper-small" } });

    fireEvent.click(screen.getByRole("button", { name: /Save voice settings/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sttBaseUrl: "http://localhost:1234/v1",
        transcriptionModel: "whisper-small",
      }),
    );
  });

  it("normalizes remote endpoints back to bundled local speech before saving", async () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPopover settings={settings} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice settings" }));

    fireEvent.change(screen.getByLabelText(/Bundled speech endpoint/i), {
      target: { value: "https://api.openai.com/v1" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save voice settings/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ sttBaseUrl: defaultLocalTranscriptionBaseUrl }),
    );
  });

  it("saves AI enhanced as clean versus verbatim transcription", async () => {
    const onSave = vi.fn();
    render(<VoiceSettingsPopover settings={settings} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice settings" }));

    const enhanced = screen.getByLabelText(/AI enhanced/i) as HTMLInputElement;
    expect(enhanced.checked).toBe(true);
    fireEvent.click(enhanced);

    fireEvent.click(screen.getByRole("button", { name: /Save voice settings/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptMode: "verbatim" }),
    );
  });

  it("detects and applies bundled speech in one click", async () => {
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
      screen.getByRole("button", { name: /Check bundled speech/i }),
    );

    await screen.findByText(/whisper.cpp server/i);
    fireEvent.click(screen.getByRole("button", { name: /whisper.cpp server/i }));

    const endpoint = screen.getByLabelText(/Bundled speech endpoint/i);
    expect((endpoint as HTMLInputElement).value).toBe("http://localhost:8080/v1");
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
      screen.getByRole("button", { name: /Check bundled speech/i }),
    );

    await screen.findByText(/Bundled local speech was not found/i);
  });
});
