import React from "react";
import {
  Sparkles,
  Send,
  Square,
  Plus,
  Settings2,
  Wrench,
  Check,
  X,
  Zap,
  ShieldCheck,
  AlertTriangle,
  CircleSlash,
} from "lucide-react";
import type { AiConfig } from "../features/ai/aiConfig";
import type { AgentContext } from "../features/ai/aiTools";
import { findLocalModel } from "../features/ai/aiModels";
import { useAiAgent } from "../features/ai/useAiAgent";

interface AiSidebarProps {
  config: AiConfig;
  ctx: AgentContext;
  isDesktop: boolean;
  onOpenSettings: () => void;
  onUpdateConfig: (config: AiConfig) => void;
}

const editKindLabel: Record<string, string> = {
  "replace-selection": "Replace selection",
  "insert-at-cursor": "Insert at cursor",
  "replace-file": "Overwrite file",
};

function providerLabel(config: AiConfig): string {
  switch (config.provider) {
    case "local":
      return findLocalModel(config.modelId)?.name ?? "Local model";
    case "ollama":
      return `Ollama · ${config.ollamaModel}`;
    case "cloud":
      return `Cloud · ${config.cloud.model}`;
    default:
      return "AI off";
  }
}

function isConfigured(config: AiConfig, isDesktop: boolean): boolean {
  if (config.provider === "off") return false;
  if (config.provider === "cloud") return config.cloud.apiKey.trim().length > 0;
  if (!isDesktop) return false; // local/ollama need desktop
  if (config.provider === "local") return config.modelDownloaded;
  return true; // ollama
}

export const AiSidebar: React.FC<AiSidebarProps> = ({
  config,
  ctx,
  isDesktop,
  onOpenSettings,
  onUpdateConfig,
}) => {
  const {
    messages,
    isRunning,
    status,
    send,
    abort,
    reset,
    pendingApproval,
    resolveApproval,
  } = useAiAgent(config, ctx);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const configured = isConfigured(config, isDesktop);
  const autonomous = config.autoApproveEdits;

  const toggleAutonomy = () =>
    onUpdateConfig({ ...config, autoApproveEdits: !config.autoApproveEdits });

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");
    void send(text);
  };

  return (
    <div className="ai-sidebar">
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <Sparkles size={15} />
          <span>AI Assistant</span>
        </div>
        <div className="ai-sidebar-actions">
          <button className="small-icon" title="New chat" onClick={reset}>
            <Plus size={15} />
          </button>
          <button className="small-icon" title="AI settings" onClick={onOpenSettings}>
            <Settings2 size={15} />
          </button>
        </div>
      </div>
      <div className="ai-sidebar-model">
        <span>{providerLabel(config)}</span>
        <button
          className={`ai-autonomy-toggle ${autonomous ? "auto" : "ask"}`}
          onClick={toggleAutonomy}
          title={
            autonomous
              ? "Fully autonomous: the agent applies changes without asking. Click to require step-by-step approval."
              : "Step-by-step: the agent asks before each change. Click to let it run fully autonomously."
          }
        >
          {autonomous ? <Zap size={12} /> : <ShieldCheck size={12} />}
          <span>{autonomous ? "Autonomous" : "Ask each step"}</span>
        </button>
      </div>

      {!configured ? (
        <div className="ai-sidebar-empty">
          <CircleSlash size={30} />
          <p>AI isn't ready yet.</p>
          <p className="sub-text">
            {config.provider === "cloud"
              ? "Add your API key in AI settings."
              : !isDesktop
                ? "Local models need the desktop app. Switch to a cloud provider for the browser."
                : "Download a model to get started."}
          </p>
          <button className="ai-wizard-primary" onClick={onOpenSettings}>
            Open AI settings
          </button>
        </div>
      ) : (
        <>
          <div className="ai-sidebar-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="ai-sidebar-hints">
                <p>Ask me to…</p>
                <ul>
                  <li>“Fix the compile errors”</li>
                  <li>“Rewrite the selection to be more concise”</li>
                  <li>“Add a related-work paragraph with a citation”</li>
                  <li>“Run the reproducibility checklist”</li>
                </ul>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`ai-msg ai-msg-${m.role}`}>
                {m.role === "assistant" && m.activity.length > 0 && (
                  <div className="ai-msg-activity">
                    {m.activity.map((a, i) => (
                      <div
                        key={i}
                        className={`ai-tool-chip ${a.ok ? "" : "error"}`}
                        title={a.summary}
                      >
                        {a.ok ? <Wrench size={11} /> : <AlertTriangle size={11} />}
                        <span>{a.name}</span>
                        {a.ok && <Check size={11} />}
                      </div>
                    ))}
                  </div>
                )}
                <div className="ai-msg-text">
                  {m.text || (m.pending ? "…" : "")}
                </div>
              </div>
            ))}
            {isRunning && status && <div className="ai-sidebar-status">{status}</div>}
          </div>

          {pendingApproval && (
            <div className="ai-approval">
              <div className="ai-approval-head">
                <ShieldCheck size={14} />
                <span>
                  {editKindLabel[pendingApproval.kind] ?? "Apply change"} ·{" "}
                  {pendingApproval.path}
                </span>
              </div>
              {pendingApproval.oldText != null &&
                pendingApproval.kind !== "insert-at-cursor" && (
                  <pre className="ai-approval-diff old">
                    {pendingApproval.oldText.slice(0, 600)}
                  </pre>
                )}
              <pre className="ai-approval-diff new">
                {pendingApproval.newText.slice(0, 600)}
              </pre>
              <div className="ai-approval-actions">
                <button
                  className="ai-approval-decline"
                  onClick={() => resolveApproval(false)}
                >
                  <X size={13} /> Decline
                </button>
                <button
                  className="ai-approval-approve"
                  onClick={() => resolveApproval(true)}
                >
                  <Check size={13} /> Approve
                </button>
              </div>
            </div>
          )}

          <div className="ai-sidebar-input">
            <textarea
              value={input}
              placeholder="Ask the AI to edit, fix, or explain…"
              rows={2}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {isRunning ? (
              <button className="ai-send-button stop" onClick={abort} title="Stop">
                <Square size={15} />
              </button>
            ) : (
              <button
                className="ai-send-button"
                onClick={submit}
                disabled={!input.trim()}
                title="Send"
              >
                <Send size={15} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
