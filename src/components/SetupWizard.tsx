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
  Loader2,
  RefreshCw,
  AlertCircle,
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
import {
  capabilityById,
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
  const [showCompare, setShowCompare] = React.useState(false);

  const step = steps[stepIndex];
  const patch = (p: Partial<AiConfig>) => setConfig((c) => ({ ...c, ...p }));

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));
  const legalReady = legalConsent;

  React.useEffect(() => {
    if (legalAccepted) {
      setLegalConsent(true);
    }
  }, [legalAccepted]);

  const openPolicy = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    onOpenExternal(url);
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
  const customSelected = !latexDoTierSelected;
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
            {steps.map((s, i) => (
              <li
                key={s}
                className={i === stepIndex ? "active" : i < stepIndex ? "done" : ""}
              >
                <span className="ai-wizard-step-dot">
                  {i < stepIndex ? <Check size={12} /> : i + 1}
                </span>
                <span className="ai-wizard-step-label">
                  {s === "welcome"
                    ? "Intro"
                    : s === "name"
                      ? "Profile"
                      : s === "layout"
                        ? "Workspace"
                        : s === "theme"
                          ? "Theme"
                          : "Assistant"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="ai-wizard-main">
          <div className="ai-wizard-body">
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
                <h2 id="ai-wizard-title">Set up {productName}</h2>
                <p className="ai-wizard-lead">
                  {productName} is a local-first LaTeX workspace for writing, compiling,
                  reviewing, and managing research projects in one place.
                </p>
                <div className="setup-intro-points">
                  <span>Write structured LaTeX</span>
                  <span>Compile and preview PDFs</span>
                  <span>Enable project tools when you need them</span>
                </div>
                <label className="setup-legal-check">
                  <input
                    type="checkbox"
                    checked={legalConsent}
                    onChange={(event) => setLegalConsent(event.target.checked)}
                    aria-label="Accept Terms of Use and Privacy Policy"
                  />
                  <span>
                    I accept the{" "}
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
              <div className="ai-wizard-section">
                <User size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">What should {productName} call you?</h2>
                <p className="ai-wizard-lead">
                  Used to personalize responses. Stored locally, never uploaded.
                </p>
                <input
                  className="ai-wizard-input"
                  autoFocus
                  placeholder="Your name"
                  value={config.userName}
                  maxLength={80}
                  onChange={(e) => patch({ userName: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && goNext()}
                />
                <button
                  type="button"
                  className="ai-wizard-anonymous"
                  onClick={() => {
                    patch({ userName: "" });
                    goNext();
                  }}
                >
                  Stay anonymous
                </button>
              </div>
            )}

            {step === "layout" && (
              <div className="ai-wizard-section">
                <LayoutGrid size={28} className="ai-wizard-hero-icon" />
                <h2 id="ai-wizard-title">How do you want your workspace?</h2>
                <div className="ai-wizard-cards">
                  {layoutPresetInfo.map((preset) => (
                    <button
                      key={preset.id}
                      className={`ai-wizard-card ${
                        config.layoutPreset === preset.id ? "selected" : ""
                      }`}
                      onClick={() => patch({ layoutPreset: preset.id as LayoutPreset })}
                    >
                      <div className="ai-wizard-card-title">{preset.name}</div>
                      <div className="ai-wizard-card-desc">{preset.description}</div>
                    </button>
                  ))}
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

                <button
                  type="button"
                  className="ai-wizard-ghost ai-wizard-compare-toggle"
                  aria-expanded={showCompare}
                  onClick={() => setShowCompare((value) => !value)}
                >
                  <GitCompareArrows size={13} />
                  {showCompare
                    ? "Hide the model comparison"
                    : "What can each model do?"}
                </button>

                {showCompare && (
                  <div className="ai-wizard-compare">
                    <table className="ai-wizard-compare-table">
                      <caption className="sr-only">
                        What each LatexDo model can do
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Capability</th>
                          {latexDoAiTiers.map((tier) => (
                            <th
                              key={tier.id}
                              scope="col"
                              className={
                                tier.id === "latexdo-ai-plus"
                                  ? "ai-wizard-compare-recommended"
                                  : undefined
                              }
                            >
                              <span className="ai-wizard-compare-tier">
                                {tier.name}
                              </span>
                              <span className="ai-wizard-compare-tagline">
                                {tier.tagline}
                              </span>
                            </th>
                          ))}
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
                              return (
                                <td
                                  key={tier.id}
                                  className={
                                    tier.id === "latexdo-ai-plus"
                                      ? "ai-wizard-compare-recommended"
                                      : undefined
                                  }
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
                )}

                <div className="ai-wizard-model-list">
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
                    return (
                      <div
                        key={tier.id}
                        className={`ai-wizard-model ${
                          selected ? "selected" : ""
                        } ${available ? "" : "unavailable"}`}
                      >
                        <button
                          type="button"
                          className="ai-wizard-model-choice"
                          onClick={() => selectTier(tier)}
                          disabled={!available}
                        >
                          <div className="ai-wizard-model-head">
                            <span className="ai-wizard-model-name">{tier.name}</span>
                            <span
                              className={`ai-wizard-tier ${
                                available ? "tier-recommended" : "tier-unavailable"
                              }`}
                            >
                              {available ? "Available" : "Unavailable"}
                            </span>
                          </div>
                          <div className="ai-wizard-model-desc">{tier.description}</div>
                          <div className="ai-wizard-model-capabilities">
                            {tier.capabilities.slice(0, 3).map((capabilityId) => {
                              const capability = capabilityById(capabilityId);
                              if (!capability) return null;
                              return (
                                <span
                                  key={capabilityId}
                                  className="ai-wizard-capability"
                                >
                                  {capability.label}
                                </span>
                              );
                            })}
                          </div>
                          {tier.capabilities.length > 3 ? (
                            <div className="ai-wizard-capability-more">
                              +{tier.capabilities.length - 3} more — see the comparison
                              below
                            </div>
                          ) : null}
                          <div className="ai-wizard-model-meta">
                            <span>{availabilityLabel(availability)}</span>
                          </div>
                          {(() => {
                            const guidance = tierUnlockGuidance(availability);
                            if (!guidance) return null;
                            return (
                              <div className="ai-wizard-unlock">
                                <div className="ai-wizard-unlock-heading">
                                  {guidance.heading}
                                </div>
                                <ol className="ai-wizard-unlock-steps">
                                  {guidance.steps.map((stepText, index) => (
                                    <li key={`${guidance.heading}-${index}`}>
                                      {stepText}
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            );
                          })()}
                        </button>
                        {selected && (
                          <div className="ai-wizard-model-action">
                            {availability.state === "memory-pressure" ||
                            availability.state === "storage-pressure" ? (
                              <button
                                type="button"
                                className="ai-wizard-ghost"
                                onClick={() => void onRefreshSystemCapabilities?.()}
                              >
                                <RefreshCw size={13} /> Check again
                              </button>
                            ) : null}
                            {availability.state === "unsupported" ? (
                              <div className="ai-wizard-error">
                                <AlertCircle size={13} />{" "}
                                {availabilityLabel(availability)}
                              </div>
                            ) : tierInstalled ? (
                              <div className="ai-wizard-download-done">
                                <Check size={16} /> {tier.name} is ready.
                              </div>
                            ) : downloading ? (
                              <div className="ai-wizard-download-progress">
                                <Loader2 size={16} className="spin" />
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
                                onClick={() => startDownload(tier)}
                                disabled={availability.state !== "available"}
                              >
                                <Download size={15} /> Download {tier.name}
                              </button>
                            )}
                            {downloadError && (
                              <div className="ai-wizard-error">{downloadError}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

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
                                importedManifest?.compatibility.state !== "unsupported",
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
                            <span>{formatBytes(importedManifest.fileSizeBytes)}</span>
                            <span>
                              {importedManifest.compatibility.state === "compatible"
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
                  <button className="ai-wizard-ghost" onClick={skipAiSetup}>
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
                  Continue <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
