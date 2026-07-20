import React from "react";
import { Cloud, ExternalLink, Check, Loader2, AlertTriangle } from "lucide-react";
import type { CloudConfig } from "../features/ai/aiConfig";
import { cloudProviders, findCloudProvider } from "../features/ai/cloudProviders";
import { generateStepCloud } from "../features/ai/aiCloud";

interface CloudProviderFormProps {
  cloud: CloudConfig;
  onChange: (cloud: CloudConfig) => void;
  onOpenExternal?: (url: string) => void;
}

export const CloudProviderForm: React.FC<CloudProviderFormProps> = ({
  cloud,
  onChange,
  onOpenExternal,
}) => {
  const preset = findCloudProvider(cloud.providerId);
  const [testState, setTestState] = React.useState<"idle" | "testing" | "ok" | "error">(
    "idle",
  );
  const [testMessage, setTestMessage] = React.useState("");

  const selectProvider = (providerId: string) => {
    const next = findCloudProvider(providerId);
    if (!next) return;
    onChange({
      ...cloud,
      providerId,
      vendor: next.apiShape,
      baseUrl: next.baseUrl,
      model: next.defaultModel || cloud.model,
    });
    setTestState("idle");
  };

  const patch = (part: Partial<CloudConfig>) => {
    onChange({ ...cloud, ...part });
    setTestState("idle");
  };

  const testConnection = async () => {
    setTestState("testing");
    setTestMessage("");
    const step = await generateStepCloud(
      {
        requestId: "test",
        provider: "cloud",
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        tools: [],
        options: {
          cloudVendor: cloud.vendor,
          cloudBaseUrl: cloud.baseUrl,
          cloudModel: cloud.model,
          cloudApiKey: cloud.apiKey,
          maxTokens: 16,
          temperature: 0,
        },
      },
      () => {},
    );
    if (step.type === "error") {
      setTestState("error");
      setTestMessage(step.content);
    } else {
      setTestState("ok");
      setTestMessage(step.content.trim().slice(0, 80) || "Connected.");
    }
  };

  const showBaseUrl = preset?.custom || cloud.baseUrl.length > 0;

  return (
    <div className="cloud-form">
      <label className="cloud-form-field">
        <span>Provider</span>
        <select
          value={cloud.providerId}
          onChange={(e) => selectProvider(e.target.value)}
        >
          {cloudProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <label className="cloud-form-field">
        <span>API key</span>
        <input
          type="password"
          placeholder="Paste your API key"
          value={cloud.apiKey}
          autoComplete="off"
          onChange={(e) => patch({ apiKey: e.target.value })}
        />
      </label>
      {preset?.apiKeyUrl && (
        <button
          type="button"
          className="cloud-form-link"
          onClick={() => onOpenExternal?.(preset.apiKeyUrl)}
        >
          <ExternalLink size={12} /> Get a key from {preset.label}
        </button>
      )}

      <label className="cloud-form-field">
        <span>Model</span>
        <input
          type="text"
          list="cloud-model-suggestions"
          placeholder="Model id"
          value={cloud.model}
          onChange={(e) => patch({ model: e.target.value })}
        />
        <datalist id="cloud-model-suggestions">
          {(preset?.models ?? []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>

      {showBaseUrl && (
        <label className="cloud-form-field">
          <span>Base URL{preset?.custom ? "" : " (optional)"}</span>
          <input
            type="text"
            placeholder="https://api.example.com/v1"
            value={cloud.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </label>
      )}

      <div className="cloud-form-test">
        <button
          type="button"
          className="ai-wizard-ghost"
          onClick={testConnection}
          disabled={!cloud.apiKey || testState === "testing"}
        >
          {testState === "testing" ? (
            <>
              <Loader2 size={13} className="spin" /> Testing…
            </>
          ) : (
            <>
              <Cloud size={13} /> Test connection
            </>
          )}
        </button>
        {testState === "ok" && (
          <span className="cloud-form-ok">
            <Check size={13} /> {testMessage}
          </span>
        )}
        {testState === "error" && (
          <span className="cloud-form-error">
            <AlertTriangle size={13} /> {testMessage}
          </span>
        )}
      </div>
    </div>
  );
};
