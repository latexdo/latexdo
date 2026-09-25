import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type {
  AiSystemCapabilities,
  DownloadProgress,
  SpeechInstallProgress,
} from "../features/ai/aiTypes";
import { legalPrivacyUrl, legalTermsUrl } from "../features/settings/settings";
import { SetupWizard } from "./SetupWizard";

const aiClientMock = vi.hoisted(() => ({
  downloadModel: vi.fn(),
  installSpeechRuntime: vi.fn(),
  subscribeDownload: vi.fn(),
  subscribeSpeechInstall: vi.fn(),
}));

vi.mock("../features/ai/aiClient", () => ({
  downloadModel: aiClientMock.downloadModel,
  installSpeechRuntime: aiClientMock.installSpeechRuntime,
  subscribeDownload: aiClientMock.subscribeDownload,
  subscribeSpeechInstall: aiClientMock.subscribeSpeechInstall,
}));

type AiConfigOverrides = Omit<Partial<AiConfig>, "cloud" | "profile"> & {
  cloud?: Partial<AiConfig["cloud"]>;
  profile?: Partial<AiConfig["profile"]>;
};

const GB = 1024 ** 3;
const highRamCapabilities: AiSystemCapabilities = {
  totalRamBytes: 32 * GB,
  freeRamBytes: 16 * GB,
  totalStorageBytes: 256 * GB,
  freeStorageBytes: 128 * GB,
  modelStoragePath: "/Users/ada/Library/Application Support/LatexDo/models",
  platform: "darwin",
  arch: "arm64",
  cpuCount: 10,
  localAiAvailable: true,
};
const lowStorageCapabilities: AiSystemCapabilities = {
  ...highRamCapabilities,
  freeStorageBytes: 1 * GB,
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
  fireEvent.click(screen.getByRole("button", { name: /Continue|Set up workspace/i }));
}

function advanceToModelStep() {
  continueSetup();
  continueSetup();
  continueSetup();
  continueSetup();
}

function startSelectedInstall() {
  fireEvent.click(screen.getByRole("button", { name: /Install selected setup/i }));
}

async function completeReadyStep() {
  expect(await screen.findByText("LatexDo is ready")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Start writing/i }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function modelChoiceButton(name: string): HTMLButtonElement {
  return screen.getByRole("button", {
    name: new RegExp(`^Choose ${escapeRegExp(name)}$`, "i"),
  }) as HTMLButtonElement;
}

describe("SetupWizard", () => {
  beforeEach(() => {
    aiClientMock.downloadModel.mockReset();
    aiClientMock.installSpeechRuntime.mockReset();
    aiClientMock.subscribeDownload.mockReset();
    aiClientMock.subscribeSpeechInstall.mockReset();
    aiClientMock.subscribeDownload.mockReturnValue(vi.fn());
    aiClientMock.subscribeSpeechInstall.mockReturnValue(vi.fn());
    aiClientMock.downloadModel.mockResolvedValue({ ok: true });
    aiClientMock.installSpeechRuntime.mockResolvedValue({ ok: true });
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

    expect(
      screen.getByRole("dialog", { name: /set up your latexdo workspace/i }),
    ).toBeVisible();
    expect(screen.getByText("LatexDo Setup")).toBeVisible();
    expect(screen.getByRole("button", { name: /set up workspace/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /skip setup/i })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: /terms of use/i }));
    expect(onOpenExternal).toHaveBeenCalledWith(legalTermsUrl);
    fireEvent.click(screen.getByRole("link", { name: /privacy policy/i }));
    expect(onOpenExternal).toHaveBeenCalledWith(legalPrivacyUrl);

    fireEvent.click(screen.getByLabelText("Accept Terms of Use and Privacy Policy"));
    fireEvent.click(screen.getByRole("button", { name: /set up workspace/i }));

    expect(onAcceptLegal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Tell LatexDo what to call you")).toBeVisible();
  });

  it("allows the legal checkbox to be unchecked and rechecked", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const checkbox = screen.getByLabelText("Accept Terms of Use and Privacy Policy");
    const continueButton = screen.getByRole("button", {
      name: /set up workspace/i,
    });

    expect(checkbox).toBeChecked();
    expect(checkbox).not.toBeDisabled();
    expect(continueButton).toBeEnabled();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(continueButton).toBeDisabled();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(continueButton).toBeEnabled();
  });

  it("lets the setup rail navigate directly between steps after legal acceptance", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Workspace setup step/i }));
    expect(screen.getByText("How do you want your workspace?")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Assistant setup step/i }));
    expect(screen.getByText("Choose your assistant model")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Intro setup step/i }));
    expect(screen.getByText("Set up your LatexDo workspace")).toBeVisible();
  });

  it("keeps later setup rail steps locked until the legal checkbox is accepted", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        legalAccepted={false}
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const workspaceStep = screen.getByRole("button", {
      name: /Workspace setup step/i,
    });
    expect(workspaceStep).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Accept Terms of Use and Privacy Policy"));
    expect(workspaceStep).toBeEnabled();

    fireEvent.click(workspaceStep);
    expect(screen.getByText("How do you want your workspace?")).toBeVisible();
  });

  it("walks through onboarding and completes with a cloud provider", async () => {
    const onApplyTheme = vi.fn();
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "cloud",
          cloud: { credentialConfigured: true },
        })}
        isDesktop={false}
        onApplyTheme={onApplyTheme}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByText("Set up your LatexDo workspace")).toBeVisible();
    continueSetup();

    fireEvent.change(screen.getByPlaceholderText("John"), {
      target: { value: "Ada" },
    });
    continueSetup();

    expect(screen.getByRole("img", { name: /focus workspace preview/i })).toBeVisible();
    expect(
      screen.getByRole("img", { name: /balanced workspace preview/i }),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: /power workspace preview/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Balanced/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const powerWorkspace = screen.getByRole("button", { name: /Power/i });
    fireEvent.click(powerWorkspace);
    expect(powerWorkspace).toHaveAttribute("aria-pressed", "true");
    continueSetup();

    fireEvent.click(screen.getByRole("button", { name: /Studio White/i }));
    expect(onApplyTheme).toHaveBeenCalledWith("studio");
    continueSetup();

    expect(
      screen.getByText(/The browser build can't run local AI tiers/i),
    ).toBeVisible();
    startSelectedInstall();
    await completeReadyStep();

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

  it("saves only a simple local profile from onboarding", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig()}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );

    continueSetup();
    expect(screen.queryByRole("button", { name: /^Overleaf$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Zotero$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /stay anonymous/i })).toHaveAttribute(
      "data-tooltip",
      "No name, title, affiliation, or AI profile will be saved.",
    );

    fireEvent.change(screen.getByPlaceholderText("John"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByPlaceholderText("Doe"), {
      target: { value: "Lovelace" },
    });
    fireEvent.change(screen.getByLabelText("Title optional"), {
      target: { value: "Dr" },
    });
    fireEvent.change(screen.getByPlaceholderText("University, lab, or company"), {
      target: { value: "Analytical Engine Lab" },
    });
    continueSetup();
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));
    await completeReadyStep();

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: "Ada Lovelace",
          profile: expect.objectContaining({
            displayName: "Ada Lovelace",
            title: "Dr",
            affiliation: "Analytical Engine Lab",
            externalProviders: [],
          }),
        }),
      ),
    );
  });

  it("downloads the selected local model during the install step", async () => {
    let progressHandler: ((progress: DownloadProgress) => void) | null = null;
    const unsubscribe = vi.fn();
    aiClientMock.subscribeDownload.mockImplementation((handler) => {
      progressHandler = handler;
      return unsubscribe;
    });
    aiClientMock.downloadModel.mockImplementation(async (_tierId: string) => {
      progressHandler?.({
        modelId: "qwen2.5-coder-3b",
        receivedBytes: 1024,
        totalBytes: 2048,
        done: false,
      });
      progressHandler?.({
        modelId: "qwen2.5-coder-3b",
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

    expect(screen.queryByRole("button", { name: /Download model/i })).toBeNull();
    expect(screen.getByText("Will download during install")).toBeVisible();
    startSelectedInstall();

    expect(await screen.findByText("LatexDo is ready")).toBeVisible();
    expect(aiClientMock.downloadModel).toHaveBeenCalledWith("latexdo-ai-plus");
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Start writing/i }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          setupComplete: true,
          provider: "local",
          modelDownloaded: true,
        }),
      ),
    );
  });

  it("surfaces local model download errors on the install step", async () => {
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

    startSelectedInstall();

    expect(await screen.findByText("Installing your selected setup")).toBeVisible();
    expect(await screen.findByText("Download failed")).toBeVisible();
    expect(screen.getByRole("button", { name: /Retry install/i })).toBeVisible();
  });

  it("shows a resource scanner while local AI capabilities are loading", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={null}
        systemCapabilitiesState="loading"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    expect(
      screen.getByRole("status", { name: /detecting machine resources/i }),
    ).toBeVisible();
    expect(screen.getByText("Detecting this machine")).toBeVisible();
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

    fireEvent.click(screen.getByText(/Show model choices and advanced AI setup/i));
    expect(modelChoiceButton("LatexDo AI")).not.toBeDisabled();
    expect(modelChoiceButton("LatexDo AI Plus")).toBeDisabled();
    expect(modelChoiceButton("LatexDo Pro Max")).toBeDisabled();
  });

  it("blocks local model install when storage is too low", () => {
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: false,
        })}
        isDesktop
        systemCapabilities={lowStorageCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    advanceToModelStep();

    expect(screen.getAllByText(/Not enough storage/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Download model/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Install selected setup/i }),
    ).toBeDisabled();
  });

  it("allows an installed local model to finish setup even when storage is low", async () => {
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({
          provider: "local",
          modelDownloaded: true,
        })}
        isDesktop
        systemCapabilities={lowStorageCapabilities}
        systemCapabilitiesState="ready"
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    expect(screen.getByText("Installed")).toBeVisible();
    startSelectedInstall();
    await completeReadyStep();
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "local",
          modelDownloaded: true,
        }),
      ),
    );
    expect(aiClientMock.downloadModel).not.toHaveBeenCalled();
  });

  it("can skip setup before choosing a model", async () => {
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
    await completeReadyStep();
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          setupComplete: true,
          provider: "off",
        }),
      ),
    );
  });

  it("can install dependencies from the AI model step without enabling AI", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: /i don't need ai/i }));
    await completeReadyStep();
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          setupComplete: true,
          provider: "off",
          selection: { mode: "off" },
          modelDownloaded: false,
        }),
      ),
    );
  });

  it("installs local speech support with progress before completing desktop setup", async () => {
    let speechHandler: ((progress: SpeechInstallProgress) => void) | null = null;
    let resolveInstall!: (result: { ok: boolean; error?: string }) => void;
    const unsubscribe = vi.fn();
    aiClientMock.subscribeSpeechInstall.mockImplementation((handler) => {
      speechHandler = handler;
      return unsubscribe;
    });
    aiClientMock.installSpeechRuntime.mockImplementation(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    const onComplete = vi.fn();
    render(
      <SetupWizard
        initialConfig={makeConfig({ provider: "off" })}
        isDesktop
        onApplyTheme={vi.fn()}
        onComplete={onComplete}
      />,
    );
    advanceToModelStep();

    startSelectedInstall();

    expect(screen.getByText("Installing your selected setup")).toBeVisible();
    expect(screen.getByText("Local speech-to-text")).toBeVisible();
    expect(screen.getByText(/This can take about 5 minutes/i)).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      speechHandler?.({
        stage: "downloading-model",
        receivedBytes: 50,
        totalBytes: 100,
        done: false,
        message: "Downloading speech model",
      });
    });

    expect(screen.getByText("Downloading speech model")).toBeVisible();
    expect(screen.getByText("50 B / 100 B")).toBeVisible();

    act(() => {
      resolveInstall({ ok: true });
    });
    expect(await screen.findByText("LatexDo is ready")).toBeVisible();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Start writing/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("shows the privacy message and a model capability comparison", () => {
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

    expect(screen.getByText(/Private by design/i)).toBeVisible();
    expect(
      screen.queryByRole("table", {
        name: /what each latexdo model can do/i,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Show model choices and advanced AI setup/i));
    expect(
      screen.getByRole("table", {
        name: /what each latexdo model can do/i,
      }),
    ).toBeVisible();
    expect(modelChoiceButton("LatexDo AI Plus")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Selected")).toBeVisible();
    expect(screen.getAllByText("Inline completion").length).toBeGreaterThan(0);
    expect(screen.getByText("Workspace reasoning")).toBeVisible();
    expect(
      screen.getAllByLabelText("LatexDo Pro Max: included").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("LatexDo AI: not included").length).toBeGreaterThan(
      0,
    );
  });

  it("explains how to unlock tiers that do not fit the machine", () => {
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

    expect(screen.getByText(/Memory is currently low/i)).toBeVisible();
    expect(screen.getByText(/Close other applications/i)).toBeVisible();

    fireEvent.click(screen.getByText(/Show model choices and advanced AI setup/i));
    expect(screen.getAllByText(/pick a lighter tier/i).length).toBeGreaterThan(0);
  });
});
