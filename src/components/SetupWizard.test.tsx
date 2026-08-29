import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type { AiSystemCapabilities, DownloadProgress } from "../features/ai/aiTypes";
import { legalPrivacyUrl, legalTermsUrl } from "../features/settings/settings";
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

const GB = 1024 ** 3;
const highRamCapabilities: AiSystemCapabilities = {
  totalRamBytes: 32 * GB,
  freeRamBytes: 16 * GB,
  platform: "darwin",
  arch: "arm64",
  cpuCount: 10,
  localAiAvailable: true,
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

  it("starts with a LatexDo intro and accepts legal policies before profile setup", () => {
    const onAcceptLegal = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted={false}
        onAcceptLegal={onAcceptLegal}
        onOpenExternal={onOpenExternal}
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: /set up latexdo/i })).toBeVisible();
    expect(screen.getByText("LatexDo Setup")).toBeVisible();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /skip setup/i })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: /terms of use/i }));
    expect(onOpenExternal).toHaveBeenCalledWith(legalTermsUrl);
    fireEvent.click(screen.getByRole("link", { name: /privacy policy/i }));
    expect(onOpenExternal).toHaveBeenCalledWith(legalPrivacyUrl);

    fireEvent.click(screen.getByLabelText("Accept Terms of Use and Privacy Policy"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onAcceptLegal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("What should LatexDo call you?")).toBeVisible();
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

    expect(screen.getByText("Set up LatexDo")).toBeVisible();
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

    expect(
      screen.getByText(/The browser build can't run local AI tiers/i),
    ).toBeVisible();
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

  it("can continue from profile setup without storing a name", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({ userName: "Ada" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    continueSetup();
    fireEvent.click(screen.getByRole("button", { name: /stay anonymous/i }));

    expect(screen.getByText("How do you want your workspace?")).toBeVisible();
    expect(screen.queryByDisplayValue("Ada")).not.toBeInTheDocument();
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
        systemCapabilities={highRamCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    fireEvent.click(screen.getByRole("button", { name: /Download LatexDo AI Plus/i }));

    await waitFor(() => {
      expect(screen.getByText("LatexDo AI Plus is ready.")).toBeVisible();
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
        systemCapabilities={highRamCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    fireEvent.click(screen.getByRole("button", { name: /Download LatexDo AI Plus/i }));

    expect(await screen.findByText("Download failed")).toBeVisible();
  });

  it("disables local AI tiers that do not fit the current machine", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={{
          ...highRamCapabilities,
          totalRamBytes: 8 * GB,
          freeRamBytes: 3.5 * GB,
        }}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    expect(
      screen
        .getByText("LatexDo AI", { selector: ".ai-wizard-model-name" })
        .closest("button"),
    ).not.toBeDisabled();
    expect(
      screen
        .getByText("LatexDo AI Plus", { selector: ".ai-wizard-model-name" })
        .closest("button"),
    ).toBeDisabled();
    expect(
      screen
        .getByText("LatexDo Pro Max", { selector: ".ai-wizard-model-name" })
        .closest("button"),
    ).toBeDisabled();
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

    continueSetup();
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        setupComplete: true,
        provider: "off",
      }),
    );
  });
});
