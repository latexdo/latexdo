// Voice dictation settings popover.
//
// Lets the user point speech-to-text at ANY OpenAI-compatible endpoint (a
// local whisper server, Groq, OpenAI, …) independent of the chat provider.
// The API key is stored through the existing OS-vault credential model — never
// a persisted renderer secret. When no endpoint is set, dictation falls back
// to the configured cloud provider if it is OpenAI.

import React from "react";
import { Check, KeyRound, PlugZap, Settings2, X } from "lucide-react";
import {
  loadCloudCredential,
  saveCloudCredential,
} from "../features/ai/cloudCredentials";
import {
  detectLocalTranscriptionServers,
  type LocalTranscriptionServer,
} from "../features/voice/localTranscriptionDetection";
import type { TranscriptMode } from "../features/voice/types";
import {
  voiceSttCredentialId,
  type VoiceSettings,
} from "../features/voice/voiceSettings";

interface VoiceSettingsPopoverProps {
  settings: VoiceSettings;
  onSave(next: VoiceSettings): void;
  openTrigger?: number;
}

export const VoiceSettingsPopover: React.FC<VoiceSettingsPopoverProps> = ({
  settings,
  onSave,
  openTrigger = 0,
}) => {
  const [open, setOpen] = React.useState(false);
  const [transcriptMode, setTranscriptMode] = React.useState<TranscriptMode>(
    settings.transcriptMode,
  );
  const [endpoint, setEndpoint] = React.useState(settings.sttBaseUrl);
  const [model, setModel] = React.useState(settings.transcriptionModel);
  const [apiKey, setApiKey] = React.useState("");
  const [keyStored, setKeyStored] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [detecting, setDetecting] = React.useState(false);
  const [detected, setDetected] = React.useState<LocalTranscriptionServer[] | null>(
    null,
  );

  React.useEffect(() => {
    if (openTrigger > 0) setOpen(true);
  }, [openTrigger]);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setApiKey("");
    setKeyStored(false);
    setDetected(null);
    void loadCloudCredential(voiceSttCredentialId).then((existing) => {
      if (!active) return;
      setKeyStored(Boolean(existing));
    });
    return () => {
      active = false;
    };
  }, [open]);

  React.useEffect(() => {
    if (open) return;
    setTranscriptMode(settings.transcriptMode);
    setEndpoint(settings.sttBaseUrl);
    setModel(settings.transcriptionModel);
  }, [open, settings]);

  const runDetection = async () => {
    setDetecting(true);
    setDetected(null);
    try {
      setDetected(await detectLocalTranscriptionServers());
    } finally {
      setDetecting(false);
    }
  };

  const applyDetected = (server: LocalTranscriptionServer) => {
    setEndpoint(server.baseUrl);
    setModel(server.speechModel ?? model);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (apiKey.trim()) {
        await saveCloudCredential(voiceSttCredentialId, apiKey.trim());
      }
      onSave({
        ...settings,
        transcriptMode,
        sttBaseUrl: endpoint.trim(),
        transcriptionModel: model.trim() || settings.transcriptionModel,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="voice-settings-wrap">
      <button
        type="button"
        className="voice-button voice-settings-toggle"
        onClick={() => setOpen((o) => !o)}
        title="Voice settings"
        aria-label="Voice settings"
        aria-expanded={open}
      >
        <Settings2 size={14} />
      </button>
      {open && (
        <div
          className="voice-settings-popover"
          role="dialog"
          aria-label="Voice settings"
        >
          <div className="voice-settings-head">
            <span>Voice dictation settings</span>
            <button
              type="button"
              className="voice-settings-close"
              onClick={() => setOpen(false)}
              aria-label="Close voice settings"
            >
              <X size={13} />
            </button>
          </div>

          <div className="voice-settings-detect">
            <button
              type="button"
              className="voice-settings-detect-btn"
              onClick={() => void runDetection()}
              disabled={detecting}
            >
              <PlugZap size={13} />
              {detecting ? "Scanning local servers…" : "Detect local speech server"}
            </button>
          </div>

          {detected && detected.length > 0 && (
            <div className="voice-settings-detected">
              {detected.map((server) => (
                <button
                  key={server.baseUrl}
                  type="button"
                  className="voice-settings-detected-row"
                  onClick={() => applyDetected(server)}
                  title={server.models.length ? server.models.join(", ") : undefined}
                >
                  <Check size={12} />
                  <span>
                    {server.label}
                    {server.speechModel ? ` · ${server.speechModel}` : ""}
                  </span>
                  <span className="voice-settings-detected-use">Use</span>
                </button>
              ))}
            </div>
          )}
          {detected && detected.length === 0 && !detecting && (
            <p className="voice-settings-hint">
              No local speech server found. Start one (whisper.cpp's <code>server</code>
              , LM Studio, or faster-whisper) and try again.
            </p>
          )}

          <label className="voice-settings-field">
            <span>Speech-to-text endpoint</span>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://localhost:8080/v1"
              spellCheck={false}
            />
          </label>

          <label className="voice-settings-field">
            <span>Model</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="whisper-large-v3"
              spellCheck={false}
            />
          </label>

          <label className="voice-settings-field">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyStored ? "Key stored in the OS vault" : "Optional"}
              autoComplete="off"
            />
          </label>

          <label className="voice-settings-field">
            <span>Outcome</span>
            <select
              value={transcriptMode}
              onChange={(e) => setTranscriptMode(e.target.value as TranscriptMode)}
            >
              <option value="clean">Clean up and format as LaTeX</option>
              <option value="verbatim">Insert exactly as spoken</option>
            </select>
          </label>

          <p className="voice-settings-hint">
            Speech-to-text runs on the server above; the LaTeX cleanup uses the AI model
            you picked during setup (LatexDo AI works locally). Local servers need no
            API key.
          </p>

          {keyStored && (
            <p className="voice-settings-key-ok">
              <KeyRound size={12} /> Speech-to-text key is stored.
            </p>
          )}

          <div className="voice-settings-actions">
            <button
              type="button"
              className="voice-settings-save"
              onClick={() => void save()}
              disabled={saving}
            >
              <Check size={13} /> Save voice settings
            </button>
          </div>
        </div>
      )}
    </span>
  );
};
