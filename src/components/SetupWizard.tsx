import React from "react";
import {
  Sparkles,
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
} from "lucide-react";
import { colorThemeOptions, type ColorTheme } from "../features/settings/settings";
import {
  layoutPresetInfo,
  type AiConfig,
  type LayoutPreset,
  type AiProvider,
} from "../features/ai/aiConfig";
import {
  fastTierAvailability,
  latexDoAiTiers,
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
  productName?: string;
  productAiName?: string;
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
  productName = defaultProductName,
  productAiName = `${defaultProductName} AI`,
}) => {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [config, setConfig] = React.useState<AiConfig>(initialConfig);
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

  const step = steps[stepIndex];
  const patch = (p: Partial<AiConfig>) => setConfig((c) => ({ ...c, ...p }));

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

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
        reason: "Checking this machine's memory.",
      };
    }
    return {
      state: "unsupported",
      reason: "LatexDo could not check this machine's memory.",
    };
  };

  const selectTier = (tier: LatexDoAiTierDefinition) => {
    const availability = tierAvailability(tier);
    if (availability.state !== "available") {
      setDownloadError(availabilityLabel(availability));
      return;
    }
    patch({
      provider: "local",
      selection: { mode: "latexdo", tier: tier.id },
      modelId: tier.runtime.modelId,
      modelDownloaded: false,
    });
    setDownloaded(false);
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
    const result = await downloadModel(
      tier.runtime.modelId,
      tier.runtime.downloadUrl,
      tier.runtime.fileName,
    );
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

  const selectedTierId =
    config.provider === "local" && config.selection.mode === "latexdo"
      ? config.selection.tier
      : null;
  const latexDoTierSelected = selectedTierId !== null;
  const selectedTier = selectedTierId
    ? (latexDoAiTiers.find((tier) => tier.id === selectedTierId) ?? latexDoAiTiers[1])
    : latexDoAiTiers[1];
  const selectedTierAvailability = tierAvailability(selectedTier);
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
      ? config.cloud.apiKey.trim().length > 0
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
      <div className="ai-wizard">
        <div className="ai-wizard-rail">
          <div className="ai-wizard-brand">
            <Sparkles size={18} />
            <span>{productAiName}</span>
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
                    ? "Welcome"
                    : s === "name"
                      ? "Your name"
                      : s === "layout"
                        ? "Layout"
                        : s === "theme"
                          ? "Theme"
                          : "AI model"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="ai-wizard-main">
          <div className="ai-wizard-body">
            {step === "welcome" && (
              <div className="ai-wizard-section">
                <Sparkles size={40} className="ai-wizard-hero-icon" />
                <h2>Let's set up your AI assistant</h2>
                <p className="ai-wizard-lead">
                  {productName} can run a local AI agent that reads, edits, compiles,
                  and debugs your LaTeX right inside the editor, privately on your
                  machine. This quick setup gets it ready.
                </p>
              </div>
            )}

            {step === "name" && (
              <div className="ai-wizard-section">
                <User size={28} className="ai-wizard-hero-icon" />
                <h2>What should the assistant call you?</h2>
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
              </div>
            )}

            {step === "layout" && (
              <div className="ai-wizard-section">
                <LayoutGrid size={28} className="ai-wizard-hero-icon" />
                <h2>How do you want your workspace?</h2>
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
                <h2>Pick a theme</h2>
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
                <h2>Choose your LatexDo AI</h2>
                <p className="ai-wizard-lead">
                  {isDesktop
                    ? systemCapabilities
                      ? `${formatRam(systemCapabilities.totalRamBytes)} RAM detected, ${formatRam(systemCapabilities.freeRamBytes)} currently available.`
                      : "LatexDo is checking whether each local AI tier can run on this machine."
                    : "The browser build can't run local AI tiers. Use Customize to connect an API provider."}
                </p>

                <div className="ai-wizard-model-list">
                  {latexDoAiTiers.map((tier) => {
                    const availability = tierAvailability(tier);
                    const available = availability.state === "available";
                    const selected =
                      config.selection.mode === "latexdo" &&
                      config.selection.tier === tier.id;
                    return (
                      <button
                        key={tier.id}
                        className={`ai-wizard-model ${
                          selected ? "selected" : ""
                        } ${available ? "" : "unavailable"}`}
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
                        <div className="ai-wizard-model-meta">
                          <span>{availabilityLabel(availability)}</span>
                        </div>
                      </button>
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
                        onOpenExternal={openExternalUrl}
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

                {config.selection.mode === "latexdo" && selectedTier && (
                  <div className="ai-wizard-download">
                    {selectedTierAvailability.state === "memory-pressure" ? (
                      <button
                        type="button"
                        className="ai-wizard-ghost"
                        onClick={() => void onRefreshSystemCapabilities?.()}
                      >
                        <RefreshCw size={13} /> Check again
                      </button>
                    ) : null}
                    {selectedTierAvailability.state === "unsupported" ? (
                      <div className="ai-wizard-error">
                        <AlertCircle size={13} />{" "}
                        {availabilityLabel(selectedTierAvailability)}
                      </div>
                    ) : downloaded || config.modelDownloaded ? (
                      <div className="ai-wizard-download-done">
                        <Check size={16} /> {selectedTier.name} is ready.
                      </div>
                    ) : downloading ? (
                      <div className="ai-wizard-download-progress">
                        <Loader2 size={16} className="spin" />
                        <div className="ai-wizard-progress-bar">
                          <div
                            className="ai-wizard-progress-fill"
                            style={{
                              width: progress.total
                                ? `${Math.round((progress.received / progress.total) * 100)}%`
                                : "40%",
                            }}
                          />
                        </div>
                        <span>
                          {formatBytes(progress.received)}
                          {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                        </span>
                      </div>
                    ) : (
                      <button
                        className="ai-wizard-primary"
                        onClick={() => startDownload(selectedTier)}
                        disabled={selectedTierAvailability.state !== "available"}
                      >
                        <Download size={15} /> Download {selectedTier.name}
                      </button>
                    )}
                    {downloadError && (
                      <div className="ai-wizard-error">{downloadError}</div>
                    )}
                  </div>
                )}
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
              {step !== "model" && (
                <button className="ai-wizard-ghost" onClick={finish}>
                  Skip setup
                </button>
              )}
              {step === "model" ? (
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
              ) : (
                <button className="ai-wizard-primary" onClick={goNext}>
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
