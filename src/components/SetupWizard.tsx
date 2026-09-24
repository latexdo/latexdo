import React from "react";
import {
  User,
  LayoutGrid,
  Palette,
  Cpu,
  Check,
  Download,
  Cloud,
  FileUp,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  BookOpenCheck,
  FileText,
  ShieldCheck,
  GitCompareArrows,
} from "lucide-react";
import {
  colorThemeOptions,
  legalPrivacyUrl,
  legalTermsUrl,
  type ColorTheme,
} from "../features/settings/settings";
import {
  layoutPresetInfo,
  type AiConfig,
  type LayoutPreset,
  type AiProvider,
} from "../features/ai/aiConfig";
import type { AcademicTitle, ResearcherProfile } from "../features/ai/researcherProfile";
import {
  fastTierAvailability,
  fastTierRuntimeAvailability,
  latexDoAiTiers,
  tierCapabilityCatalog,
  tierUnlockGuidance,
  type LatexDoAiTierDefinition,
} from "../features/ai/product/latexDoAiTiers";
import {
  detectOllama,
  downloadModel,
  importModel,
  subscribeDownload,
} from "../features/ai/aiClient";
import type {
  AiSystemCapabilities,
  ImportedModelManifest,
  TierAvailability,
} from "../features/ai/aiTypes";
import { CloudProviderForm } from "./CloudProviderForm";

function openExternalUrl(url: string): void {
  const api = (
    window as {
      latexdo?: {
        openExternalUrl?: (u: string) => unknown;
        openExternal?: (u: string) => unknown;
      };
    }
  ).latexdo;
  const openInBrowser = () => window.open(url, "_blank", "noopener,noreferrer");
  void (async () => {
    if (api?.openExternalUrl) {
      try {
        await api.openExternalUrl(url);
        return;
      } catch {
        // Fall back below so provider links never fail silently.
      }
    }
    if (api?.openExternal) {
      try {
        await api.openExternal(url);
        return;
      } catch {
        // Fall back to the browser runtime.
      }
    }
    openInBrowser();
  })();
}

interface SetupWizardProps {
  initialConfig: AiConfig;
  isDesktop: boolean;
  onApplyTheme: (theme: ColorTheme) => void;
  onComplete: (config: AiConfig) => void;
  systemCapabilities?: AiSystemCapabilities | null;
  systemCapabilitiesState?: "idle" | "loading" | "ready" | "unavailable";
  onRefreshSystemCapabilities?: () => Promise<AiSystemCapabilities | null>;
  onImportedModel?: (model: ImportedModelManifest) => void;
  legalAccepted?: boolean;
  onAcceptLegal?: () => void;
  onOpenExternal?: (url: string) => void;
  productName?: string;
  productSetupName?: string;
}

type Step = "welcome" | "name" | "layout" | "theme" | "model";
const steps: Step[] = ["welcome", "name", "layout", "theme", "model"];
const defaultProductName = "LatexDo";
const academicTitleOptions: AcademicTitle[] = ["", "Dr", "Prof", "Prof. Dr", "Mx"];

type ProfileNameParts = {
  firstName: string;
  lastName: string;
};

function splitDisplayName(displayName: string): ProfileNameParts {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function displayNameFromParts(parts: ProfileNameParts): string {
  return [parts.firstName, parts.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatRam(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function importedModelId(fileName: string): string {
  return `imported-gguf:${fileName}`;
}

function labelForGgufFile(fileName: string): string {
  return (
    fileName
      .replace(/\.gguf$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || fileName
  );
}

function WorkspacePresetFigure({ preset }: { preset: LayoutPreset }) {
  const hasSidebar = preset !== "focus";
  const hasPanel = preset === "power";
  const hasMinimap = preset !== "focus";

  return (
    <div
      className={`workspace-preset-figure workspace-preset-${preset}`}
      role="img"
      aria-label={`${preset} workspace preview`}
    >
      <div className="workspace-preset-titlebar">
        <span />
        <span />
        <span />
      </div>
      <div className="workspace-preset-shell">
        {hasSidebar ? (
          <div className="workspace-preset-sidebar">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <div className="workspace-preset-main">
          <div className="workspace-preset-split">
            <div className="workspace-preset-editor">
              <span className="wide" />
              <span />
              <span className="short" />
              <span />
              <span className="medium" />
              {hasMinimap ? <i /> : null}
            </div>
            <div className="workspace-preset-pdf">
              <em />
              <span />
              <span className="short" />
              <span />
            </div>
          </div>
          {hasPanel ? (
            <div className="workspace-preset-bottom">
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function availabilityLabel(availability: TierAvailability): string {
  if (availability.state === "available") return "Available on this machine";
  if (availability.state === "memory-pressure") {
    return `Temporarily unavailable. Needs ${formatRam(
      availability.requiredAvailableBytes,
    )} available; ${formatRam(availability.availableBytes)} available now.`;
  }
  if (availability.state === "storage-pressure") {
    return `Not enough storage. Needs ${formatRam(
      availability.requiredAvailableStorageBytes,
    )} free; ${formatRam(availability.availableStorageBytes)} free now.`;
  }
  if (
    typeof availability.requiredSystemRamBytes === "number" &&
    typeof availability.detectedSystemRamBytes === "number"
  ) {
    return `Not supported. Requires ${formatRam(
      availability.requiredSystemRamBytes,
    )} RAM; detected ${formatRam(availability.detectedSystemRamBytes)}.`;
  }
  return availability.reason;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  initialConfig,
  isDesktop,
  onApplyTheme,
  onComplete,
  systemCapabilities = null,
  systemCapabilitiesState = isDesktop ? "loading" : "unavailable",
  onRefreshSystemCapabilities,
  onImportedModel,
  legalAccepted = true,
  onAcceptLegal,
  onOpenExternal = openExternalUrl,
  productName = defaultProductName,
  productSetupName = `${productName} Setup`,
}) => {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [config, setConfig] = React.useState<AiConfig>(initialConfig);
  const [legalConsent, setLegalConsent] = React.useState(legalAccepted);
  const [downloading, setDownloading] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    received: number;
    total: number | null;
  }>({
    received: 0,
    total: null,
  });
  const [downloadError, setDownloadError] = React.useState("");
  const [downloaded, setDownloaded] = React.useState(false);
  const [ollamaModels, setOllamaModels] = React.useState<string[]>([]);
  const [ollamaMessage, setOllamaMessage] = React.useState("");
  const [ollamaLoading, setOllamaLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importedManifest, setImportedManifest] =
    React.useState<ImportedModelManifest | null>(null);
  const [profileNameParts, setProfileNameParts] = React.useState<ProfileNameParts>(() =>
    splitDisplayName(initialConfig.profile.displayName || initialConfig.userName),
  );

  const step = steps[stepIndex];
  const patch = (p: Partial<AiConfig>) => setConfig((c) => ({ ...c, ...p }));

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));
  const legalReady = legalConsent;
  const canNavigateToStep = (targetIndex: number) => targetIndex === 0 || legalReady;
  const navigateToStep = (targetIndex: number) => {
    if (!canNavigateToStep(targetIndex)) return;
    if (stepIndex === 0 && targetIndex > 0 && !legalAccepted) {
      onAcceptLegal?.();
    }
    setStepIndex(targetIndex);
  };

  React.useEffect(() => {
    if (legalAccepted) {
      setLegalConsent(true);
    }
  }, [legalAccepted]);

  const openPolicy = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    onOpenExternal(url);
  };

  const updateKnownProfile = (part: Partial<ResearcherProfile>) => {
    const displayName = (part.displayName ?? config.profile.displayName).trim();
    const nextProfile: ResearcherProfile = {
      ...config.profile,
      ...part,
      mode: displayName ? "orcid" : "anonymous",
      displayName,
      includeInContext: Boolean(displayName),
    };
    patch({
      profile: nextProfile,
      userName: nextProfile.displayName,
      access: {
        ...config.access,
        researcherProfile: Boolean(displayName),
      },
    });
  };

  const chooseAnonymousProfile = () => {
    setProfileNameParts({ firstName: "", lastName: "" });
    patch({
      userName: "",
      access: {
        ...config.access,
        researcherProfile: false,
      },
      profile: {
        ...config.profile,
        mode: "anonymous",
        displayName: "",
        title: "",
        affiliation: "",
        includeInContext: false,
      },
    });
  };

  const updateProfileName = (part: Partial<ProfileNameParts>) => {
    setProfileNameParts((current) => {
      const next = { ...current, ...part };
      updateKnownProfile({ displayName: displayNameFromParts(next) });
      return next;
    });
  };

  const stayAnonymousAndContinue = () => {
    chooseAnonymousProfile();
    goNext();
  };

  const continueFromIntro = () => {
    if (!legalReady) return;
    if (!legalAccepted) {
      onAcceptLegal?.();
    }
    goNext();
  };

  const chooseTheme = (theme: ColorTheme) => {
    onApplyTheme(theme);
  };

  const selectProvider = (provider: AiProvider) => {
    if (provider === "cloud") {
      patch({
        provider,
        selection: {
          mode: "custom",
          custom: {
            kind: "cloud",
            providerId: config.cloud.providerId,
            model: config.cloud.model,
            baseUrl: config.cloud.baseUrl,
            credentialId: `credential-${config.cloud.providerId}-primary`,
          },
        },
      });
    } else if (provider === "ollama") {
      patch({
        provider,
        selection: {
          mode: "custom",
          custom: {
            kind: "ollama",
            baseUrl: config.ollamaBaseUrl,
            model: config.ollamaModel,
          },
        },
      });
    } else if (provider === "off") {
      patch({ provider, selection: { mode: "off" } });
    } else {
      patch({ provider });
    }
    setDownloaded(false);
    setDownloadError("");
  };

  const tierAvailability = (tier: LatexDoAiTierDefinition): TierAvailability => {
    if (!isDesktop) {
      return {
        state: "unsupported",
        reason: "Local AI requires the LatexDo desktop app.",
      };
    }
    if (systemCapabilities) return fastTierAvailability(tier, systemCapabilities);
    if (systemCapabilitiesState === "loading") {
      return {
        state: "unsupported",
        reason: "Checking this machine's memory and storage.",
      };
    }
    return {
      state: "unsupported",
      reason: "LatexDo could not check this machine's memory and storage.",
    };
  };

  const tierRunAvailability = (tier: LatexDoAiTierDefinition): TierAvailability => {
    if (!isDesktop) {
      return {
        state: "unsupported",
        reason: "Local AI requires the LatexDo desktop app.",
      };
    }
    if (systemCapabilities) {
      return fastTierRuntimeAvailability(tier, systemCapabilities);
    }
    if (systemCapabilitiesState === "loading") {
      return {
        state: "unsupported",
        reason: "Checking this machine's memory.",
      };
    }
    return {
      state: "unsupported",
      reason: "LatexDo could not check this machine's memory.",
    };
  };

  const selectTier = (tier: LatexDoAiTierDefinition) => {
    const tierInstalled =
      config.provider === "local" &&
      config.modelId === tier.runtime.modelId &&
      (downloaded || config.modelDownloaded);
    const availability = tierInstalled
      ? tierRunAvailability(tier)
      : tierAvailability(tier);
    if (availability.state !== "available") {
      setDownloadError(availabilityLabel(availability));
      return;
    }
    patch({
      provider: "local",
      selection: { mode: "latexdo", tier: tier.id },
      modelId: tier.runtime.modelId,
      modelDownloaded: tierInstalled,
    });
    setDownloaded(tierInstalled);
    setDownloadError("");
  };

  const selectCustomize = () => {
    if (config.selection.mode === "custom") return;
    selectProvider("cloud");
  };

  const startDownload = async (tier: LatexDoAiTierDefinition) => {
    const capabilities =
      systemCapabilities ?? (await onRefreshSystemCapabilities?.()) ?? null;
    if (capabilities) {
      const availability = fastTierAvailability(tier, capabilities);
      if (availability.state !== "available") {
        setDownloadError(availabilityLabel(availability));
        return;
      }
    }
    setDownloading(true);
    setDownloadError("");
    setProgress({ received: 0, total: null });
    const unsub = subscribeDownload((p) => {
      if (p.modelId !== tier.runtime.modelId) return;
      if (p.stage === "verifying") {
        setDownloadError("");
        return;
      }
      if (p.error) {
        setDownloadError(p.error);
        return;
      }
      if (p.done) {
        setDownloaded(true);
      } else {
        setProgress({ received: p.receivedBytes, total: p.totalBytes });
      }
    });
    const result = await downloadModel(tier.id);
    unsub();
    setDownloading(false);
    if (!result.ok) {
      setDownloadError(result.error ?? "Download failed.");
    } else {
      setDownloaded(true);
      patch({
        provider: "local",
        selection: { mode: "latexdo", tier: tier.id },
        modelId: tier.runtime.modelId,
        modelDownloaded: true,
      });
    }
  };

  const refreshOllamaModels = async () => {
    if (!isDesktop) {
      setOllamaModels([]);
      setOllamaMessage("Ollama requires the LatexDo desktop app.");
      return;
    }
    setOllamaLoading(true);
    setOllamaMessage("");
    const result = await detectOllama(config.ollamaBaseUrl);
    setOllamaLoading(false);
    if (!result.available) {
      setOllamaModels([]);
      setOllamaMessage("Ollama is not reachable at this base URL.");
      return;
    }
    setOllamaModels(result.models);
    setOllamaMessage(
      result.models.length
        ? `Found ${result.models.length} model(s).`
        : "No models found.",
    );
  };

  const importGguf = async () => {
    if (!isDesktop) {
      setDownloadError("GGUF model import requires the LatexDo desktop app.");
      return;
    }
    setImporting(true);
    setDownloadError("");
    try {
      const manifest = await importModel();
      if (!manifest) return;
      setImportedManifest(manifest);
      onImportedModel?.(manifest);
      patch({
        provider: "local",
        selection: {
          mode: "custom",
          custom: { kind: "gguf", modelId: importedModelId(manifest.fileName) },
        },
        modelId: importedModelId(manifest.fileName),
        modelDownloaded:
          manifest.compatibility.state === "compatible" ||
          manifest.compatibility.state === "unknown",
      });
      setDownloaded(
        manifest.compatibility.state === "compatible" ||
          manifest.compatibility.state === "unknown",
      );
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  const finish = () => {
    onComplete({
      ...config,
      setupComplete: true,
      modelDownloaded:
        config.provider === "local" ? downloaded || config.modelDownloaded : false,
    });
  };

  const skipAiSetup = () => {
    onComplete({
      ...config,
      provider: "off",
      selection: { mode: "off" },
      setupComplete: true,
      modelDownloaded: false,
    });
  };

  const selectedTierId =
    config.provider === "local" && config.selection.mode === "latexdo"
      ? config.selection.tier
      : null;
  const latexDoTierSelected = selectedTierId !== null;
  const selectedTier = selectedTierId
    ? (latexDoAiTiers.find((tier) => tier.id === selectedTierId) ?? latexDoAiTiers[1])
    : latexDoAiTiers[1];
  const selectedTierInstalled =
    config.provider === "local" &&
    config.modelId === selectedTier.runtime.modelId &&
    (downloaded || config.modelDownloaded);
  const selectedTierAvailability = selectedTierInstalled
    ? tierRunAvailability(selectedTier)
    : tierAvailability(selectedTier);
  const selectedTierGuidance = tierUnlockGuidance(selectedTierAvailability);
  const customSelected = !latexDoTierSelected;
  const [modelDetailsOpen, setModelDetailsOpen] = React.useState(customSelected);
  React.useEffect(() => {
    if (customSelected) {
      setModelDetailsOpen(true);
    }
  }, [customSelected]);
  const customProvider =
    config.provider === "ollama"
      ? "ollama"
      : config.provider === "local" && config.selection.mode === "custom"
        ? "gguf"
        : config.provider === "off"
          ? "off"
          : "cloud";
  const importedCompatibility = importedManifest?.compatibility ?? null;
  const canFinish = latexDoTierSelected
    ? selectedTierAvailability.state === "available" &&
      (downloaded || config.modelDownloaded)
    : config.provider === "cloud"
      ? config.cloud.credentialConfigured
      : config.provider === "ollama"
        ? isDesktop && config.ollamaModel.trim().length > 0
        : config.provider === "local"
          ? isDesktop &&
            (downloaded || config.modelDownloaded) &&
            (!importedCompatibility ||
              importedCompatibility.state === "compatible" ||
              importedCompatibility.state === "unknown")
          : true;

  return (
    <div className="ai-wizard-overlay">
      <div
        className="ai-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-wizard-title"
      >
        <div className="ai-wizard-rail">
          <div className="ai-wizard-brand">
            <ShieldCheck size={18} />
            <span>{productSetupName}</span>
          </div>
          <ul className="ai-wizard-steps">
            {steps.map((s, i) => {
              const label =
                s === "welcome"
                  ? "Intro"
                  : s === "name"
                    ? "Profile"
                    : s === "layout"
                      ? "Workspace"
                      : s === "theme"
                        ? "Theme"
                        : "Assistant";
              return (
                <li
                  key={s}
                  className={i === stepIndex ? "active" : i < stepIndex ? "done" : ""}
                >
                  <button
                    type="button"
                    className="ai-wizard-step"
                    onClick={() => navigateToStep(i)}
                    disabled={!canNavigateToStep(i)}
                    aria-current={i === stepIndex ? "step" : undefined}
                    aria-label={`${label} setup step`}
                    title={
                      canNavigateToStep(i)
                        ? ""
                        : "Accept the Terms of Use and Privacy Policy first."
                    }
                  >
                    <span className="ai-wizard-step-dot">
                      {i < stepIndex ? <Check size={12} /> : i + 1}
                    </span>
                    <span className="ai-wizard-step-label">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="ai-wizard-main">
          <div className={`ai-wizard-body step-${step}`}>
            {step === "welcome" && (
              <div className="ai-wizard-section setup-intro-section">
                <div className="setup-intro-visual" aria-hidden="true">
                  <div className="setup-intro-window">
                    <div className="setup-intro-window-head">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="setup-intro-document">
                      <div className="setup-intro-line wide" />
                      <div className="setup-intro-line medium" />
                      <div className="setup-intro-line short" />
                      <div className="setup-intro-cursor" />
                    </div>
                  </div>
                  <div className="setup-intro-compile">
                    <FileText size={17} />
                    <div>
                      <span />
                      <span />
                    </div>
                    <BookOpenCheck size={17} />
                  </div>
                </div>
                <h2 id="ai-wizard-title">Set up your {productName} workspace</h2>
                <p className="ai-wizard-lead">
                  A few quick choices, then you can start writing. Pick the layout,
                  theme, profile, and optional AI.
                </p>
                <div className="setup-intro-points" aria-label="What setup configures">
                  <div>
                    <strong>Writing workspace</strong>
                    <span>
                      Choose where source, PDF preview, files, and output appear.
                    </span>
                  </div>
                  <div>
                    <strong>PDF builder</strong>
                    <span>
                      If this computer has no TeX install yet, {productName} will guide
                      you.
                    </span>
                  </div>
                  <div>
                    <strong>Optional AI</strong>
                    <span>Use local or cloud AI.</span>
                  </div>
                </div>
                <details className="setup-toolchain-details">
                  <summary>PDF builder details</summary>
                  <div>
                    <span>PDF compile needs a free TeX install once per computer.</span>
                    <button
                      type="button"
                      onClick={() => onOpenExternal("https://www.tug.org/mactex/")}
                    >
                      MacTeX <ExternalLink size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenExternal("https://miktex.org/download")}
                    >
                      MiKTeX <ExternalLink size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenExternal("https://www.tug.org/texlive/")}
                    >
                      TeX Live <ExternalLink size={12} />
                    </button>
                  </div>
                </details>
                <label className="setup-legal-check">
                  <input
                    type="checkbox"
                    checked={legalConsent}
                    onChange={(event) => setLegalConsent(event.target.checked)}
                    aria-label="Accept Terms of Use and Privacy Policy"
                  />
                  <span>
                    Required once before using {productName}. I accept the{" "}
                    <a
                      href={legalTermsUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => openPolicy(event, legalTermsUrl)}
                    >
                      Terms of Use
                    </a>{" "}
                    and{" "}
                    <a
                      href={legalPrivacyUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => openPolicy(event, legalPrivacyUrl)}
                    >
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              </div>
            )}

            {step === "name" && (
              <div className="ai-wizard-section ai-wizard-identity-step">
                <User size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">Tell {productName} what to call you</h2>
                <p className="ai-wizard-lead">
                  This is optional. You can use a simple name like John Doe, or stay
                  anonymous and continue.
                </p>

                <div className="ai-wizard-known-profile">
                  <div className="ai-wizard-profile-grid">
                    <label className="cloud-form-field">
                      <span>First name</span>
                      <input
                        className="ai-wizard-input"
                        autoFocus
                        placeholder="John"
                        value={profileNameParts.firstName}
                        maxLength={60}
                        onChange={(event) =>
                          updateProfileName({ firstName: event.target.value })
                        }
                        onKeyDown={(event) => event.key === "Enter" && goNext()}
                      />
                    </label>
                    <label className="cloud-form-field">
                      <span>Last name</span>
                      <input
                        className="ai-wizard-input"
                        placeholder="Doe"
                        value={profileNameParts.lastName}
                        maxLength={80}
                        onChange={(event) =>
                          updateProfileName({ lastName: event.target.value })
                        }
                        onKeyDown={(event) => event.key === "Enter" && goNext()}
                      />
                    </label>
                    <label className="cloud-form-field">
                      <span>Title optional</span>
                      <select
                        value={config.profile.title}
                        onChange={(event) =>
                          updateKnownProfile({
                            title: event.target.value as AcademicTitle,
                          })
                        }
                      >
                        {academicTitleOptions.map((title) => (
                          <option key={title || "none"} value={title}>
                            {title || "No title"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="cloud-form-field">
                    <span>Affiliation optional</span>
                    <input
                      className="ai-wizard-input"
                      placeholder="University, lab, or company"
                      value={config.profile.affiliation}
                      maxLength={120}
                      onChange={(event) =>
                        updateKnownProfile({
                          affiliation: event.target.value,
                        })
                      }
                      onKeyDown={(event) => event.key === "Enter" && goNext()}
                    />
                  </label>

                  <div className="ai-wizard-anonymous-choice">
                    <button
                      type="button"
                      className="ai-wizard-ghost"
                      onClick={stayAnonymousAndContinue}
                      data-tooltip="No name, title, affiliation, or AI profile will be saved."
                    >
                      <ShieldCheck size={14} /> Stay anonymous
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === "layout" && (
              <div className="ai-wizard-section">
                <LayoutGrid size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">How do you want your workspace?</h2>
                <div className="ai-wizard-workspace-grid">
                  {layoutPresetInfo.map((preset) => {
                    const selected = config.layoutPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`ai-wizard-card ai-wizard-workspace-card ${
                          selected ? "selected" : ""
                        }`}
                        onClick={() =>
                          patch({ layoutPreset: preset.id as LayoutPreset })
                        }
                        aria-pressed={selected}
                      >
                        <WorkspacePresetFigure preset={preset.id} />
                        <div className="ai-wizard-card-title">
                          <span>{preset.name}</span>
                          {selected ? (
                            <span className="ai-wizard-workspace-selected">
                              <Check size={12} /> Selected
                            </span>
                          ) : null}
                        </div>
                        <div className="ai-wizard-card-desc">{preset.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === "theme" && (
              <div className="ai-wizard-section">
                <Palette size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">Pick a theme</h2>
                <div className="ai-wizard-theme-grid">
                  {colorThemeOptions.map((theme) => (
                    <button
                      key={theme.id}
                      className="ai-wizard-theme-swatch"
                      onClick={() => chooseTheme(theme.id)}
                      title={theme.description}
                    >
                      <div className="ai-wizard-swatch-row">
                        {theme.swatches.map((c) => (
                          <span key={c} style={{ background: c }} />
                        ))}
                      </div>
                      <span className="ai-wizard-theme-name">{theme.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === "model" && (
              <div className="ai-wizard-section ai-wizard-model-step">
                <Cpu size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">Choose your assistant model</h2>
                <p className="ai-wizard-lead">
                  {isDesktop
                    ? systemCapabilities
                      ? `${formatRam(systemCapabilities.totalRamBytes)} RAM detected, ${formatRam(systemCapabilities.freeRamBytes)} currently available. ${
                          systemCapabilities.freeStorageBytes === null
                            ? "Storage check unavailable."
                            : `${formatRam(systemCapabilities.freeStorageBytes)} storage available for AI models.`
                        }`
                      : "LatexDo is checking whether each local AI tier can run and fit on this machine."
                    : "The browser build can't run local AI tiers. Use Customize to connect an API provider."}
                </p>

                {isDesktop &&
                systemCapabilitiesState === "loading" &&
                !systemCapabilities ? (
                  <div
                    className="ai-wizard-resource-scan"
                    role="status"
                    aria-label="Detecting machine resources"
                  >
                    <div className="ai-wizard-resource-scan-head">
                      <Cpu size={15} />
                      <strong>Detecting this machine</strong>
                      <span>RAM, storage, and local AI runtime</span>
                    </div>
                    <div className="ai-wizard-resource-grid" aria-hidden="true">
                      {["RAM", "Storage", "Runtime"].map((label, index) => (
                        <div
                          key={label}
                          className="ai-wizard-resource-tile"
                          style={
                            {
                              "--scan-delay": `${index * 140}ms`,
                            } as React.CSSProperties
                          }
                        >
                          <span>{label}</span>
                          <div className="ai-wizard-resource-track" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="ai-wizard-privacy">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <div>
                    <strong>Private by design.</strong> Local AI runs 100% on your
                    machine — no account, no uploads, and never trained on your work.
                    {isDesktop
                      ? " Nothing leaves your computer unless you choose to connect a provider."
                      : ""}
                  </div>
                </div>

                <div className="ai-wizard-ai-optional">
                  <strong>AI is optional.</strong>
                  <span>
                    {productName} works without an assistant. To use AI, install one
                    local model or connect your own provider. To skip it, click{" "}
                    <strong>I don't need AI</strong>.
                  </span>
                </div>

                {latexDoTierSelected ? (
                  <div className="ai-wizard-selected-model">
                    <div>
                      <span className="ai-wizard-selected-label">
                        Recommended assistant
                      </span>
                      <strong>{selectedTier.name}</strong>
                      <p>{selectedTier.description}</p>
                      {selectedTierGuidance ? (
                        <small>
                          {selectedTierGuidance.heading}{" "}
                          {selectedTierGuidance.steps.join(" ")}
                        </small>
                      ) : null}
                    </div>
                    <div className="ai-wizard-selected-action">
                      <span
                        className={`ai-wizard-compare-status ${
                          selectedTierInstalled
                            ? "is-checked"
                            : selectedTierAvailability.state === "available"
                              ? "is-available"
                              : "is-unavailable"
                        }`}
                      >
                        {selectedTierInstalled ? <Check size={12} /> : null}
                        {selectedTierInstalled
                          ? "Installed"
                          : selectedTierAvailability.state === "available"
                            ? "Download needed"
                            : availabilityLabel(selectedTierAvailability)}
                      </span>
                      {!selectedTierInstalled &&
                      selectedTierAvailability.state === "available" ? (
                        downloading ? (
                          <div className="ai-wizard-download-progress compact">
                            <Loader2 size={13} className="spin" />
                            <div className="ai-wizard-progress-bar">
                              <div
                                className="ai-wizard-progress-fill"
                                style={{
                                  width: progress.total
                                    ? `${Math.round(
                                        (progress.received / progress.total) * 100,
                                      )}%`
                                    : "40%",
                                }}
                              />
                            </div>
                            <span>
                              {formatBytes(progress.received)}
                              {progress.total
                                ? ` / ${formatBytes(progress.total)}`
                                : ""}
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="ai-wizard-primary ai-wizard-model-download"
                            onClick={() => startDownload(selectedTier)}
                          >
                            <Download size={13} /> Download model
                          </button>
                        )
                      ) : null}
                      {downloadError && !customSelected ? (
                        <span className="ai-wizard-compare-warning">
                          {downloadError}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="ai-wizard-selected-model">
                    <div>
                      <span className="ai-wizard-selected-label">Custom assistant</span>
                      <strong>Bring your own AI</strong>
                      <p>
                        Use an API provider, Ollama, or an imported local model. You can
                        also skip AI entirely.
                      </p>
                    </div>
                  </div>
                )}

                <details
                  className="ai-wizard-model-details"
                  open={modelDetailsOpen}
                >
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      setModelDetailsOpen((open) => !open);
                    }}
                  >
                    <GitCompareArrows size={14} />
                    <span>Show model choices and advanced AI setup</span>
                  </summary>

                  {modelDetailsOpen ? (
                    <>
                      <div className="ai-wizard-compare">
                        <table className="ai-wizard-compare-table">
                          <caption className="sr-only">
                            What each LatexDo model can do
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Capability</th>
                              {latexDoAiTiers.map((tier) => {
                                const tierInstalled =
                                  config.provider === "local" &&
                                  config.modelId === tier.runtime.modelId &&
                                  (downloaded || config.modelDownloaded);
                                const availability = tierInstalled
                                  ? tierRunAvailability(tier)
                                  : tierAvailability(tier);
                                const available = availability.state === "available";
                                const selected =
                                  config.selection.mode === "latexdo" &&
                                  config.selection.tier === tier.id;
                                const guidance = tierUnlockGuidance(availability);
                                return (
                                  <th
                                    key={tier.id}
                                    scope="col"
                                    className={[
                                      tier.id === "latexdo-ai-plus"
                                        ? "ai-wizard-compare-recommended"
                                        : "",
                                      selected ? "ai-wizard-compare-selected" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                  >
                                    <button
                                      type="button"
                                      className="ai-wizard-compare-model-button"
                                      onClick={() => selectTier(tier)}
                                      disabled={!available}
                                      aria-label={`Choose ${tier.name}`}
                                      aria-pressed={selected}
                                    >
                                      <span className="ai-wizard-compare-tier">
                                        {tier.name}
                                      </span>
                                      <span className="ai-wizard-compare-description">
                                        {tier.description}
                                      </span>
                                    </button>
                                    <div className="ai-wizard-compare-model-meta">
                                      <span
                                        className={`ai-wizard-compare-status ${
                                          tierInstalled || selected
                                            ? "is-checked"
                                            : available
                                              ? "is-available"
                                              : "is-unavailable"
                                        }`}
                                      >
                                        {tierInstalled || selected ? (
                                          <Check size={12} aria-hidden="true" />
                                        ) : null}
                                        {tierInstalled
                                          ? "Installed"
                                          : selected
                                            ? "Selected"
                                            : available
                                              ? "Available"
                                              : "Unavailable"}
                                      </span>

                                      {selected &&
                                      (availability.state === "memory-pressure" ||
                                        availability.state === "storage-pressure") ? (
                                        <button
                                          type="button"
                                          className="ai-wizard-mini-action"
                                          onClick={() =>
                                            void onRefreshSystemCapabilities?.()
                                          }
                                        >
                                          <RefreshCw size={12} /> Check again
                                        </button>
                                      ) : null}

                                      {selected &&
                                      !tierInstalled &&
                                      availability.state !== "unsupported" ? (
                                        downloading ? (
                                          <div className="ai-wizard-download-progress compact">
                                            <Loader2 size={13} className="spin" />
                                            <div className="ai-wizard-progress-bar">
                                              <div
                                                className="ai-wizard-progress-fill"
                                                style={{
                                                  width: progress.total
                                                    ? `${Math.round(
                                                        (progress.received /
                                                          progress.total) *
                                                          100,
                                                      )}%`
                                                    : "40%",
                                                }}
                                              />
                                            </div>
                                            <span>
                                              {formatBytes(progress.received)}
                                              {progress.total
                                                ? ` / ${formatBytes(progress.total)}`
                                                : ""}
                                            </span>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            className="ai-wizard-primary ai-wizard-model-download compact"
                                            onClick={() => startDownload(tier)}
                                            disabled={
                                              availability.state !== "available"
                                            }
                                            aria-label={`Download ${tier.name}`}
                                          >
                                            <Download size={13} /> Download
                                          </button>
                                        )
                                      ) : null}

                                      {!available ? (
                                        <span className="ai-wizard-compare-warning">
                                          {availabilityLabel(availability)}
                                        </span>
                                      ) : null}
                                      {selected && downloadError ? (
                                        <span className="ai-wizard-compare-warning">
                                          {downloadError}
                                        </span>
                                      ) : null}
                                      {guidance ? (
                                        <span className="ai-wizard-compare-guidance">
                                          <strong>{guidance.heading}</strong>{" "}
                                          {guidance.steps.join(" ")}
                                        </span>
                                      ) : null}
                                    </div>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {tierCapabilityCatalog.map((capability) => (
                              <tr key={capability.id}>
                                <th scope="row">
                                  <strong>{capability.label}</strong>
                                  <span className="ai-wizard-compare-detail">
                                    {capability.detail}
                                  </span>
                                </th>
                                {latexDoAiTiers.map((tier) => {
                                  const included = tier.capabilities.includes(
                                    capability.id,
                                  );
                                  const selected =
                                    config.selection.mode === "latexdo" &&
                                    config.selection.tier === tier.id;
                                  return (
                                    <td
                                      key={tier.id}
                                      className={[
                                        tier.id === "latexdo-ai-plus"
                                          ? "ai-wizard-compare-recommended"
                                          : "",
                                        selected ? "ai-wizard-compare-selected" : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    >
                                      {included ? (
                                        <Check
                                          size={14}
                                          className="ai-wizard-compare-yes"
                                          aria-label={`${tier.name}: included`}
                                        />
                                      ) : (
                                        <span
                                          className="ai-wizard-compare-no"
                                          aria-label={`${tier.name}: not included`}
                                        >
                                          —
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="ai-wizard-custom-choice">
                        <button
                          className={`ai-wizard-model ai-wizard-cloud ${
                            customSelected ? "selected" : ""
                          }`}
                          onClick={selectCustomize}
                        >
                          <div className="ai-wizard-model-head">
                            <span className="ai-wizard-model-name">
                              <Cloud size={14} /> Customize
                            </span>
                          </div>
                          <div className="ai-wizard-model-desc">
                            Bring your own model or AI provider.
                          </div>
                        </button>
                      </div>

                      {customSelected && (
                        <div className="ai-wizard-custom-form">
                          <label className="cloud-form-field">
                            <span>Customize AI</span>
                            <select
                              value={customProvider}
                              onChange={(event) => {
                                const provider = event.target.value;
                                if (provider === "cloud") selectProvider("cloud");
                                if (provider === "ollama") selectProvider("ollama");
                                if (provider === "off") selectProvider("off");
                                if (provider === "gguf") {
                                  const modelId = importedManifest
                                    ? importedModelId(importedManifest.fileName)
                                    : "";
                                  patch({
                                    provider: "local",
                                    selection: {
                                      mode: "custom",
                                      custom: {
                                        kind: "gguf",
                                        modelId,
                                      },
                                    },
                                    modelId,
                                    modelDownloaded:
                                      Boolean(importedManifest) &&
                                      importedManifest?.compatibility.state !==
                                        "memory-pressure" &&
                                      importedManifest?.compatibility.state !==
                                        "unsupported",
                                  });
                                  setDownloaded(false);
                                }
                              }}
                            >
                              <option value="cloud">API Provider</option>
                              <option value="ollama" disabled={!isDesktop}>
                                Ollama{isDesktop ? "" : " (desktop only)"}
                              </option>
                              <option value="gguf" disabled={!isDesktop}>
                                Local GGUF Model{isDesktop ? "" : " (desktop only)"}
                              </option>
                              <option value="off">Off</option>
                            </select>
                          </label>

                          {config.provider === "cloud" && (
                            <CloudProviderForm
                              cloud={config.cloud}
                              onChange={(cloud) =>
                                patch({
                                  cloud,
                                  provider: "cloud",
                                  selection: {
                                    mode: "custom",
                                    custom: {
                                      kind: "cloud",
                                      providerId: cloud.providerId,
                                      model: cloud.model,
                                      baseUrl: cloud.baseUrl,
                                      credentialId: `credential-${cloud.providerId}-primary`,
                                    },
                                  },
                                })
                              }
                              onOpenExternal={onOpenExternal}
                            />
                          )}

                          {config.provider === "ollama" && (
                            <div className="ai-wizard-custom-group">
                              <label className="cloud-form-field">
                                <span>Server URL</span>
                                <input
                                  type="url"
                                  value={config.ollamaBaseUrl}
                                  onChange={(event) =>
                                    patch({
                                      ollamaBaseUrl: event.target.value,
                                      selection: {
                                        mode: "custom",
                                        custom: {
                                          kind: "ollama",
                                          baseUrl: event.target.value,
                                          model: config.ollamaModel,
                                        },
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label className="cloud-form-field">
                                <span>Model</span>
                                <select
                                  value={config.ollamaModel}
                                  onChange={(event) =>
                                    patch({
                                      ollamaModel: event.target.value,
                                      selection: {
                                        mode: "custom",
                                        custom: {
                                          kind: "ollama",
                                          baseUrl: config.ollamaBaseUrl,
                                          model: event.target.value,
                                        },
                                      },
                                    })
                                  }
                                >
                                  <option value="">Select model</option>
                                  {config.ollamaModel &&
                                  !ollamaModels.includes(config.ollamaModel) ? (
                                    <option value={config.ollamaModel}>
                                      {config.ollamaModel}
                                    </option>
                                  ) : null}
                                  {ollamaModels.map((model) => (
                                    <option key={model} value={model}>
                                      {model}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                className="ai-wizard-ghost"
                                onClick={() => void refreshOllamaModels()}
                                disabled={ollamaLoading}
                              >
                                {ollamaLoading ? (
                                  <>
                                    <Loader2 size={13} className="spin" /> Refreshing
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw size={13} /> Refresh models
                                  </>
                                )}
                              </button>
                              {ollamaMessage && (
                                <span className="cloud-form-ok">{ollamaMessage}</span>
                              )}
                            </div>
                          )}

                          {config.provider === "local" &&
                          config.selection.mode === "custom" &&
                          config.selection.custom.kind === "gguf" ? (
                            <div className="ai-wizard-custom-group">
                              <button
                                type="button"
                                className="ai-wizard-ghost"
                                onClick={() => void importGguf()}
                                disabled={importing}
                              >
                                {importing ? (
                                  <>
                                    <Loader2 size={13} className="spin" /> Importing
                                  </>
                                ) : (
                                  <>
                                    <FileUp size={13} /> Import .gguf
                                  </>
                                )}
                              </button>
                              {importedManifest ? (
                                <div className="ai-wizard-imported-model">
                                  <strong>
                                    {labelForGgufFile(importedManifest.fileName)}
                                  </strong>
                                  <span>
                                    {formatBytes(importedManifest.fileSizeBytes)}
                                  </span>
                                  <span>
                                    {importedManifest.compatibility.state ===
                                    "compatible"
                                      ? "Compatible with this machine"
                                      : importedManifest.compatibility.state ===
                                          "memory-pressure"
                                        ? "Temporarily unavailable because of memory pressure"
                                        : importedManifest.compatibility.state ===
                                            "unsupported"
                                          ? "Not supported on this machine"
                                          : "Compatibility unknown"}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {customSelected && downloadError ? (
                        <div className="ai-wizard-error">{downloadError}</div>
                      ) : null}
                    </>
                  ) : null}
                </details>
              </div>
            )}
          </div>

          <div className="ai-wizard-footer">
            <div>
              {stepIndex > 0 && (
                <button className="ai-wizard-ghost" onClick={goBack}>
                  <ArrowLeft size={14} /> Back
                </button>
              )}
            </div>
            <div className="ai-wizard-footer-right">
              {step !== "welcome" && step !== "model" && (
                <button className="ai-wizard-ghost" onClick={finish}>
                  Skip setup
                </button>
              )}
              {step === "model" ? (
                <>
                  <button
                    className="ai-wizard-ghost"
                    onClick={skipAiSetup}
                    title="Skip AI. LatexDo will still edit and compile projects."
                  >
                    I don't need AI
                  </button>
                  <button
                    className="ai-wizard-primary"
                    onClick={finish}
                    disabled={!canFinish}
                    title={
                      canFinish
                        ? ""
                        : "Download the model or pick a cloud provider first."
                    }
                  >
                    Finish <Check size={15} />
                  </button>
                </>
              ) : (
                <button
                  className="ai-wizard-primary"
                  onClick={step === "welcome" ? continueFromIntro : goNext}
                  disabled={step === "welcome" && !legalReady}
                  title={
                    step === "welcome" && !legalReady
                      ? "Accept the Terms of Use and Privacy Policy to continue."
                      : ""
                  }
                >
                  {step === "welcome" ? "Set up workspace" : "Continue"}{" "}
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
