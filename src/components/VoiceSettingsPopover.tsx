// Voice dictation settings popover.
//
// Lets the user point speech-to-text at a local OpenAI-compatible endpoint
// (whisper.cpp, LM Studio, faster-whisper, …) independent of the chat provider.
// Voice dictation defaults to local speech-to-text.

import React from "react";
import { Check, PlugZap, Settings2, X } from "lucide-react";
import {
  detectLocalTranscriptionServers,
  type LocalTranscriptionServer,
} from "../features/voice/localTranscriptionDetection";
import {
  defaultCloudTranscriptionModel,
  normalizeVoiceSettings,
  type VoiceSettings,
  type VoiceSttMode,
} from "../features/voice/voiceSettings";

interface VoiceSettingsPopoverProps {
  settings: VoiceSettings;
  onSave(next: VoiceSettings): void;
  openTrigger?: number;
  aiEnhancementAvailable?: boolean;
}

export const VoiceSettingsPopover: React.FC<VoiceSettingsPopoverProps> = ({
  settings,
  onSave,
  openTrigger = 0,
  aiEnhancementAvailable = true,
}) => {
  const [open, setOpen] = React.useState(false);
  const [sttMode, setSttMode] = React.useState<VoiceSttMode>(settings.sttMode);
  const [endpoint, setEndpoint] = React.useState(settings.sttBaseUrl);
  const [model, setModel] = React.useState(settings.transcriptionModel);
  const [cloudModel, setCloudModel] = React.useState(settings.cloudTranscriptionModel);
  const [aiEnhanced, setAiEnhanced] = React.useState(
    settings.transcriptMode === "clean",
  );
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
    setDetected(null);
  }, [open]);

  React.useEffect(() => {
    if (open) return;
    setSttMode(settings.sttMode);
    setEndpoint(settings.sttBaseUrl);
    setModel(settings.transcriptionModel);
    setCloudModel(settings.cloudTranscriptionModel);
    setAiEnhanced(settings.transcriptMode === "clean");
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
      onSave(
        normalizeVoiceSettings({
          ...settings,
          sttMode,
          sttBaseUrl: endpoint.trim(),
          transcriptionModel: model.trim() || settings.transcriptionModel,
          cloudTranscriptionModel:
            cloudModel.trim() ||
            settings.cloudTranscriptionModel ||
            defaultCloudTranscriptionModel,
          transcriptMode: aiEnhanced && aiEnhancementAvailable ? "clean" : "verbatim",
        }),
      );
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

          <div className="voice-settings-mode" role="group" aria-label="Speech engine">
            <button
              type="button"
              className={sttMode === "local" ? "active" : ""}
              onClick={() => setSttMode("local")}
            >
              Local
            </button>
            <button
              type="button"
              className={sttMode === "openai" ? "active" : ""}
              onClick={() => setSttMode("openai")}
            >
              OpenAI
            </button>
          </div>

          {sttMode === "local" && (
            <>
              <div className="voice-settings-detect">
                <button
                  type="button"
                  className="voice-settings-detect-btn"
                  onClick={() => void runDetection()}
                  disabled={detecting}
                >
                  <PlugZap size={13} />
                  {detecting ? "Checking bundled speech…" : "Check bundled speech"}
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
                      title={
                        server.models.length ? server.models.join(", ") : undefined
                      }
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
                  Bundled local speech was not found in this build. Reinstall LatexDo
                  with speech support.
                </p>
              )}

              <label className="voice-settings-field">
                <span>Bundled speech endpoint</span>
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
            </>
          )}

          {sttMode === "openai" && (
            <>
              <label className="voice-settings-field">
                <span>OpenAI speech model</span>
                <select
                  value={cloudModel}
                  onChange={(e) => setCloudModel(e.target.value)}
                >
                  <option value="gpt-transcribe">gpt-transcribe</option>
                  <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
                  <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
                  <option value="whisper-1">whisper-1</option>
                </select>
              </label>
              <p className="voice-settings-hint">
                Uses your OpenAI API key from AI settings.
              </p>
            </>
          )}

          <label
            className="voice-settings-check"
            title={
              aiEnhancementAvailable
                ? "Enhance the transcription with your AI"
                : "Select a local LatexDo AI model to enable enhancement"
            }
          >
            <input
              type="checkbox"
              aria-label="AI enhanced"
              checked={aiEnhanced && aiEnhancementAvailable}
              disabled={!aiEnhancementAvailable}
              onChange={(e) => setAiEnhanced(e.target.checked)}
            />
            <span>AI enhanced</span>
          </label>

          <p className="voice-settings-hint">
            {sttMode === "local"
              ? "LatexDo starts bundled local speech automatically. AI enhanced cleanup uses the selected local LatexDo AI model."
              : "OpenAI speech sends recordings to OpenAI for transcription. AI enhanced cleanup uses the selected local LatexDo AI model."}
          </p>

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
