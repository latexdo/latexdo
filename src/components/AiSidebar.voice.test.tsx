import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type { AgentContext, EditProposal } from "../features/ai/aiTools";
import type { UiMessage } from "../features/ai/useAiAgent";
import { voiceSettingsStorageKey } from "../features/voice/voiceSettings";

const agentMock = vi.hoisted(() => ({
  state: {
    messages: [] as UiMessage[],
    isRunning: false,
    status: "",
    send: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    pendingApproval: null as EditProposal | null,
    resolveApproval: vi.fn(),
    proposeEdit: vi.fn(),
  },
}));

vi.mock("../features/ai/useAiAgent", () => ({
  useAiAgent: vi.fn(() => agentMock.state),
}));

const transcriptionFactory = vi.hoisted(() => ({
  createTranscriptionProvider: vi.fn(),
}));
const cleanupFactory = vi.hoisted(() => ({
  createTranscriptCleanup: vi.fn(),
}));

vi.mock("../features/voice/transcription", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/voice/transcription")>();
  return {
    ...actual,
    createTranscriptionProvider: transcriptionFactory.createTranscriptionProvider,
  };
});
vi.mock("../features/voice/transcriptCleanup", () => cleanupFactory);

import { AiSidebar } from "./AiSidebar";

const ctx = {
  projectName: () => "Paper",
  activeFilePath: () => "main.tex",
  listFiles: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  documentText: () => "",
  selection: () => ({ text: "", hasSelection: false }),
  applyEdit: vi.fn().mockResolvedValue(undefined),
  compile: vi.fn(),
  runChecks: vi.fn(),
  insertCitation: vi.fn(),
  recommendCitations: vi.fn(),
  requestApproval: vi.fn(),
} satisfies AgentContext;

function cloudConfig(): AiConfig {
  return {
    ...defaultAiConfig,
    provider: "cloud",
    cloud: {
      ...defaultAiConfig.cloud,
      vendor: "openai",
      credentialConfigured: true,
    },
  };
}

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => type === "audio/webm;codecs=opus");
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(
    public stream: MediaStream,
    _options?: MediaRecorderOptions,
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    const data = new Blob([new Uint8Array(48)], { type: this.mimeType });
    this.ondataavailable?.({ data } as BlobEvent);
    this.onstop?.();
  }
}

function installCapture(rejectWith?: Error): void {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  FakeMediaRecorder.instances = [];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve, reject) => {
            if (rejectWith) {
              reject(rejectWith);
              return;
            }
            resolve({
              getTracks: () => [{ stop: vi.fn() }],
            } as unknown as MediaStream);
          }),
      ),
    },
  });
}

function renderSidebar() {
  return render(
    <AiSidebar
      config={cloudConfig()}
      ctx={ctx}
      isDesktop={true}
      expanded={false}
      onToggleExpanded={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
}

function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/Ask the AI/i) as HTMLTextAreaElement;
}

function deferredProvider() {
  let settle = (_v: { text: string }) => {};
  const promise = new Promise<{ text: string }>((resolve) => {
    settle = resolve;
  });
  return {
    id: "test",
    transcribe: vi.fn(() => promise),
    settle: (text: string) => settle({ text }),
  };
}

async function startDictation() {
  fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));
  await waitFor(() => expect(screen.getByText("Recording")).toBeVisible());
}

describe("AiSidebar voice dictation integration", () => {
  beforeEach(() => {
    agentMock.state.messages = [];
    agentMock.state.isRunning = false;
    agentMock.state.status = "";
    ctx.applyEdit.mockReset();
    ctx.applyEdit.mockResolvedValue(undefined);
    window.localStorage.clear();
    window.localStorage.setItem(
      voiceSettingsStorageKey,
      JSON.stringify({
        transcriptMode: "verbatim",
        maxDurationMs: 60_000,
        transcriptionModel: "test-transcribe",
      }),
    );
    cleanupFactory.createTranscriptCleanup.mockReturnValue({
      id: "cleanup",
      cleanup: vi.fn(),
    });
    installCapture();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it("drafts the transcript for insertion instead of writing into the composer", async () => {
    const provider = {
      id: "test",
      transcribe: vi.fn().mockResolvedValue({ text: "beautiful" }),
    };
    transcriptionFactory.createTranscriptionProvider.mockReturnValue(provider);
    renderSidebar();

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Insert dictation into editor" }),
      ).toBeVisible(),
    );
    // Composer text is untouched.
    expect(composer().value).toBe("");
  });

  it("places the draft in the editor exactly when the insert button is clicked", async () => {
    transcriptionFactory.createTranscriptionProvider.mockReturnValue({
      id: "test",
      transcribe: vi.fn().mockResolvedValue({ text: "beautiful" }),
    });
    renderSidebar();

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Insert dictation into editor" }),
      ).toBeVisible(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Insert dictation into editor" }),
    );

    await waitFor(() => {
      expect(ctx.applyEdit).toHaveBeenCalledTimes(1);
    });
    const proposal = ctx.applyEdit.mock.calls[0][0] as EditProposal;
    expect(proposal.kind).toBe("insert-at-cursor");
    expect(proposal.path).toBe("main.tex");
    expect(proposal.newText).toBe("beautiful");
    // Draft clears after insert.
    expect(
      screen.queryByRole("button", { name: "Insert dictation into editor" }),
    ).not.toBeInTheDocument();
  });

  it("leaves existing text untouched when microphone permission is denied", async () => {
    installCapture(new DOMException("denied", "NotAllowedError"));
    transcriptionFactory.createTranscriptionProvider.mockReturnValue({
      id: "test",
      transcribe: vi.fn(),
    });
    renderSidebar();

    const ta = composer();
    fireEvent.change(ta, { target: { value: "Keep this" } });

    fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));

    await waitFor(() =>
      expect(screen.getByText(/Microphone access was denied/i)).toBeVisible(),
    );
    expect(ta.value).toBe("Keep this");
    expect(
      screen.queryByRole("button", { name: "Insert dictation into editor" }),
    ).not.toBeInTheDocument();
  });

  it("never drafts a stale transcript when the user cancels during transcription", async () => {
    const provider = deferredProvider();
    transcriptionFactory.createTranscriptionProvider.mockReturnValue(provider);
    renderSidebar();

    await startDictation();
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Transcribing…" })).toBeDisabled(),
    );

    // The provider is still in flight: the user bails out.
    fireEvent.click(screen.getByRole("button", { name: "Cancel voice dictation" }));

    await act(async () => {
      await Promise.resolve();
      provider.settle("should never appear");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.queryByRole("button", { name: "Insert dictation into editor" }),
    ).not.toBeInTheDocument();
  });
});
