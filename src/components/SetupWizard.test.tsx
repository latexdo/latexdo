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
    expect(screen.getByText("Choose your research identity")).toBeVisible();
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

  it("walks through onboarding and completes with a cloud provider", () => {
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

    fireEvent.change(screen.getByPlaceholderText("Your name"), {
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
    fireEvent.click(screen.getByRole("tab", { name: /anonymous reviewer/i }));
    continueSetup();

    expect(screen.getByText("How do you want your workspace?")).toBeVisible();
    expect(screen.queryByDisplayValue("Ada")).not.toBeInTheDocument();
  });

  it("saves named identity destinations for research providers from onboarding", () => {
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
    fireEvent.change(screen.getByPlaceholderText("Your name"), {
      target: { value: "Ada Lovelace" },
    });
    expect(screen.getByRole("button", { name: /^Overleaf$/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Mendeley$/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^ReadCube$/i })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^Overleaf$/i }));
    fireEvent.change(screen.getByLabelText("Overleaf username or local account name"), {
      target: { value: "ada-overleaf" },
    });
    fireEvent.change(screen.getByLabelText("Overleaf Git URL (optional)"), {
      target: { value: "https://git.overleaf.com/ada-paper" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Zotero$/i }));
    fireEvent.change(screen.getByLabelText("Zotero username or local account name"), {
      target: { value: "ada-zotero" },
    });
    continueSetup();
    fireEvent.click(screen.getByRole("button", { name: /Skip setup/i }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: "Ada Lovelace",
        profile: expect.objectContaining({
          displayName: "Ada Lovelace",
          externalProviders: expect.arrayContaining([
            expect.objectContaining({
              provider: "overleaf",
              username: "ada-overleaf",
              displayName: "Ada Lovelace",
              projectFetchUrl: "https://git.overleaf.com/ada-paper",
            }),
            expect.objectContaining({
              provider: "zotero",
              username: "ada-zotero",
              displayName: "Ada Lovelace",
            }),
          ]),
        }),
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
    aiClientMock.downloadModel.mockImplementation(async (tierId: string) => {
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

    fireEvent.click(screen.getByRole("button", { name: /Download LatexDo AI Plus/i }));

    await waitFor(() => {
      expect(screen.getByText("Installed")).toBeVisible();
    });
    expect(aiClientMock.downloadModel).toHaveBeenCalledWith("latexdo-ai-plus");
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

    expect(modelChoiceButton("LatexDo AI")).not.toBeDisabled();
    expect(modelChoiceButton("LatexDo AI Plus")).toBeDisabled();
    expect(modelChoiceButton("LatexDo Pro Max")).toBeDisabled();
  });

  it("blocks local model downloads when storage is too low", () => {
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
    expect(
      screen.getByRole("button", { name: /Download LatexDo AI Plus/i }),
    ).toBeDisabled();
  });

  it("allows an installed local model to finish setup even when storage is low", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Finish/i }));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "local",
        modelDownloaded: true,
      }),
    );
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

  it("can finish from the AI model step without enabling AI", () => {
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
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        setupComplete: true,
        provider: "off",
        selection: { mode: "off" },
        modelDownloaded: false,
      }),
    );
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

    expect(screen.getAllByText(/memory floor/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/connect your own model via customize/i).length,
    ).toBeGreaterThan(0);
  });
});
