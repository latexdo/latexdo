import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type { DownloadProgress } from "../features/ai/aiTypes";
import { SetupWizard } from "./SetupWizard";

const aiClientMock = vi.hoisted(() => ({
  downloadModel: vi.fn(),
  subscribeDownload: vi.fn(),
}));

vi.mock("../features/ai/aiClient", () => ({
  downloadModel: aiClientMock.downloadModel,
  subscribeDownload: aiClientMock.subscribeDownload,
}));

type AiConfigOverrides = Omit<Partial<AiConfig>, "cloud" | "profile"> & {
  cloud?: Partial<AiConfig["cloud"]>;
  profile?: Partial<AiConfig["profile"]>;
};

function makeConfig(overrides: AiConfigOverrides = {}): AiConfig {
  return {
    ...defaultAiConfig,
    ...overrides,
    cloud: {
      ...defaultAiConfig.cloud,
      ...overrides.cloud,
    },
    profile: {
      ...defaultAiConfig.profile,
      ...overrides.profile,
    },
  };
}

function continueSetup() {
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
}

function advanceToModelStep() {
  continueSetup();
  continueSetup();
  continueSetup();
  continueSetup();
}

describe("SetupWizard", () => {
  beforeEach(() => {
    aiClientMock.downloadModel.mockReset();
    aiClientMock.subscribeDownload.mockReset();
    aiClientMock.subscribeDownload.mockReturnValue(vi.fn());
    aiClientMock.downloadModel.mockResolvedValue({ ok: true });
  });

  it("walks through onboarding and completes with a cloud provider", () => {
    const onApplyTheme = vi.fn();
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "cloud",
          cloud: { apiKey: "sk-test" },
        })}
        isDesktop={false}
        onApplyTheme={onApplyTheme}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Let's set up your AI assistant")).toBeVisible();
    continueSetup();

    fireEvent.change(screen.getByPlaceholderText("Your name"), {
      target: { value: "Ada" },
    });
    continueSetup();

    fireEvent.click(screen.getByRole("button", { name: /Power/i }));
    continueSetup();

    fireEvent.click(screen.getByRole("button", { name: /Studio White/i }));
    expect(onApplyTheme).toHaveBeenCalledWith("studio");
    continueSetup();

    expect(screen.getByText(/The browser build can't run local models/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Finish/i }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        setupComplete: true,
        userName: "Ada",
        layoutPreset: "power",
        provider: "cloud",
        modelDownloaded: false,
      }),
    );
  });

  it("downloads a local model before completing desktop setup", async () => {
    let progressHandler: ((progress: DownloadProgress) => void) | null = null;
    const unsubscribe = vi.fn();
    aiClientMock.subscribeDownload.mockImplementation((handler) => {
      progressHandler = handler;
      return unsubscribe;
    });
    aiClientMock.downloadModel.mockImplementation(async (modelId: string) => {
      progressHandler?.({
        modelId,
        receivedBytes: 1024,
        totalBytes: 2048,
        done: false,
      });
      progressHandler?.({
        modelId,
        receivedBytes: 2048,
        totalBytes: 2048,
        done: true,
      });
      return { ok: true };
    });
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    fireEvent.click(
      screen.getByRole("button", { name: /Download Qwen2\.5 Coder 3B/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("Qwen2.5 Coder 3B is ready.")).toBeVisible();
    });
    expect(aiClientMock.downloadModel).toHaveBeenCalledWith(
      "qwen2.5-coder-3b",
      expect.stringContaining("Qwen2.5-Coder-3B-Instruct-GGUF"),
      "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Finish/i }));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        setupComplete: true,
        provider: "local",
        modelDownloaded: true,
      }),
    );
  });

  it("surfaces local model download errors", async () => {
    aiClientMock.downloadModel.mockResolvedValue({
      ok: false,
      error: "Download failed",
    });
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    fireEvent.click(
      screen.getByRole("button", { name: /Download Qwen2\.5 Coder 3B/i }),
    );

    expect(await screen.findByText("Download failed")).toBeVisible();
  });

  it("can skip setup before choosing a model", () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "off" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        setupComplete: true,
        provider: "off",
      }),
    );
  });
});
