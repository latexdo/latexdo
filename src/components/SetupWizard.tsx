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
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import {
  colorThemeOptions,
  type ColorTheme,
} from "../features/settings/settings";
import {
  layoutPresetInfo,
  type AiConfig,
  type LayoutPreset,
  type AiProvider,
} from "../features/ai/aiConfig";
import {
  localModelCatalog,
  tierLabels,
  type LocalModelInfo,
} from "../features/ai/aiModels";
import { downloadModel, subscribeDownload } from "../features/ai/aiClient";
import { CloudProviderForm } from "./CloudProviderForm";

function openExternalUrl(url: string): void {
  const api = (window as { latexdo?: { openExternal?: (u: string) => void } })
    .latexdo;
  if (api?.openExternal) api.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

interface SetupWizardProps {
  initialConfig: AiConfig;
  isDesktop: boolean;
  onApplyTheme: (theme: ColorTheme) => void;
  onComplete: (config: AiConfig) => void;
}

type Step = "welcome" | "name" | "layout" | "theme" | "model";
const steps: Step[] = ["welcome", "name", "layout", "theme", "model"];

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

export const SetupWizard: React.FC<SetupWizardProps> = ({
  initialConfig,
  isDesktop,
  onApplyTheme,
  onComplete,
}) => {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [config, setConfig] = React.useState<AiConfig>(initialConfig);
  const [downloading, setDownloading] = React.useState(false);
  const [progress, setProgress] = React.useState<{ received: number; total: number | null }>({
    received: 0,
    total: null,
  });
  const [downloadError, setDownloadError] = React.useState("");
  const [downloaded, setDownloaded] = React.useState(false);

  const step = steps[stepIndex];
  const patch = (p: Partial<AiConfig>) => setConfig((c) => ({ ...c, ...p }));

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const chooseTheme = (theme: ColorTheme) => {
    onApplyTheme(theme);
  };

  const selectProvider = (provider: AiProvider) => {
    patch({ provider });
    setDownloaded(false);
    setDownloadError("");
  };

  const selectModel = (model: LocalModelInfo) => {
    patch({ provider: "local", modelId: model.id });
    setDownloaded(false);
    setDownloadError("");
  };

  const startDownload = async (model: LocalModelInfo) => {
    setDownloading(true);
    setDownloadError("");
    setProgress({ received: 0, total: null });
    const unsub = subscribeDownload((p) => {
      if (p.modelId !== model.id) return;
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
    const result = await downloadModel(model.id, model.downloadUrl, model.fileName);
    unsub();
    setDownloading(false);
    if (!result.ok) {
      setDownloadError(result.error ?? "Download failed.");
    } else {
      setDownloaded(true);
    }
  };

  const finish = () => {
    onComplete({
      ...config,
      setupComplete: true,
      modelDownloaded: config.provider === "local" ? downloaded : false,
    });
  };

  const selectedModel = localModelCatalog.find((m) => m.id === config.modelId);
  const canFinish =
    config.provider === "cloud"
      ? config.cloud.apiKey.trim().length > 0
      : config.provider === "off" ||
        !isDesktop ||
        downloaded ||
        config.modelDownloaded;

  return (
    <div className="ai-wizard-overlay">
      <div className="ai-wizard">
        <div className="ai-wizard-rail">
          <div className="ai-wizard-brand">
            <Sparkles size={18} />
            <span>LatexDo AI</span>
          </div>
          <ul className="ai-wizard-steps">
            {steps.map((s, i) => (
              <li
                key={s}
                className={
                  i === stepIndex ? "active" : i < stepIndex ? "done" : ""
                }
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
                  LatexDo can run a local AI agent that reads, edits, compiles,
                  and debugs your LaTeX right inside the editor — privately, on
                  your machine. This quick setup gets it ready.
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
                <h2>Choose your AI model</h2>
                <p className="ai-wizard-lead">
                  {isDesktop
                    ? "Pick a local model (runs offline on your machine) or connect a cloud provider."
                    : "The browser build can't run local models. Connect a cloud provider to use AI here."}
                </p>

                {isDesktop && (
                  <div className="ai-wizard-model-list">
                    {localModelCatalog.map((model) => (
                      <button
                        key={model.id}
                        className={`ai-wizard-model ${
                          config.provider === "local" && config.modelId === model.id
                            ? "selected"
                            : ""
                        }`}
                        onClick={() => selectModel(model)}
                      >
                        <div className="ai-wizard-model-head">
                          <span className="ai-wizard-model-name">{model.name}</span>
                          <span className={`ai-wizard-tier tier-${model.tier}`}>
                            {tierLabels[model.tier]}
                          </span>
                        </div>
                        <div className="ai-wizard-model-desc">{model.description}</div>
                        <div className="ai-wizard-model-meta">
                          <span>{model.params}</span>
                          <span>{model.downloadSize} download</span>
                          <span>{model.ramEstimate} RAM</span>
                          {model.strengths.map((s) => (
                            <span key={s} className="ai-wizard-chip">
                              {s}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  className={`ai-wizard-model ai-wizard-cloud ${
                    config.provider === "cloud" ? "selected" : ""
                  }`}
                  onClick={() => selectProvider("cloud")}
                >
                  <div className="ai-wizard-model-head">
                    <span className="ai-wizard-model-name">
                      <Cloud size={14} /> Cloud model (bring your own key)
                    </span>
                  </div>
                  <div className="ai-wizard-model-desc">
                    Connect Claude, ChatGPT, Gemini, and others with your own API
                    key. Works in the browser too.
                  </div>
                </button>

                {config.provider === "cloud" && (
                  <CloudProviderForm
                    cloud={config.cloud}
                    onChange={(cloud) => patch({ cloud })}
                    onOpenExternal={openExternalUrl}
                  />
                )}

                {isDesktop && config.provider === "local" && selectedModel && (
                  <div className="ai-wizard-download">
                    {downloaded || config.modelDownloaded ? (
                      <div className="ai-wizard-download-done">
                        <Check size={16} /> {selectedModel.name} is ready.
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
                        onClick={() => startDownload(selectedModel)}
                      >
                        <Download size={15} /> Download {selectedModel.name} (
                        {selectedModel.downloadSize})
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
                    canFinish ? "" : "Download the model or pick a cloud provider first."
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
