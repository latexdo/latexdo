import React from "react";
import {
  Sparkles,
  Send,
  Square,
  Plus,
  Maximize2,
  Minimize2,
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
import { findCloudProvider } from "../features/ai/cloudProviders";
import { useAiAgent } from "../features/ai/useAiAgent";
import {
  detectTrigger,
  filterCommandSuggestions,
  filterFileSuggestions,
  type MentionTrigger,
} from "../features/ai/aiMentions";

interface Suggestion {
  /** Text inserted after the trigger character. */
  value: string;
  /** Secondary line (command hint or file directory). */
  hint?: string;
}

interface SuggestState {
  trigger: MentionTrigger;
  items: Suggestion[];
}

interface AiSidebarProps {
  config: AiConfig;
  ctx: AgentContext;
  isDesktop: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenSettings: () => void;
  onUpdateConfig: (config: AiConfig) => void;
  onOpenExternal?: (url: string) => void;
  storageKey?: string;
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
  expanded,
  onToggleExpanded,
  onOpenSettings,
  onUpdateConfig,
  onOpenExternal,
  storageKey,
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
  } = useAiAgent(config, ctx, storageKey);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const configured = isConfigured(config, isDesktop);
  const autonomous = config.autoApproveEdits;
  const cloudProvider =
    config.provider === "cloud" ? findCloudProvider(config.cloud.providerId) : null;

  // `@` file mentions and `\` quick commands: an autocomplete popup driven by
  // the caret position. Project files are (re)fetched when a file popup opens.
  const [suggest, setSuggest] = React.useState<SuggestState | null>(null);
  const [highlight, setHighlight] = React.useState(0);
  const filesRef = React.useRef<string[]>([]);
  const filesLoading = React.useRef(false);

  const refreshFiles = React.useCallback(() => {
    if (filesLoading.current) return;
    filesLoading.current = true;
    ctx
      .listFiles()
      .then((files) => {
        filesRef.current = files;
      })
      .catch(() => {
        filesRef.current = [];
      })
      .finally(() => {
        filesLoading.current = false;
      });
  }, [ctx]);

  const updateSuggestions = React.useCallback(
    (value: string, caret: number) => {
      const trigger = detectTrigger(value, caret);
      if (!trigger) {
        setSuggest(null);
        return;
      }
      let items: Suggestion[];
      if (trigger.kind === "file") {
        if (filesRef.current.length === 0) refreshFiles();
        items = filterFileSuggestions(filesRef.current, trigger.query).map((path) => ({
          value: path,
        }));
      } else {
        items = filterCommandSuggestions(trigger.query).map((c) => ({
          value: c.name,
          hint: c.hint,
        }));
      }
      setSuggest(items.length ? { trigger, items } : null);
      setHighlight(0);
    },
    [refreshFiles],
  );

  const acceptSuggestion = React.useCallback(
    (item: Suggestion, trigger: MentionTrigger) => {
      const mark = trigger.kind === "file" ? "@" : "\\";
      const prefix = `${input.slice(0, trigger.start)}${mark}${item.value} `;
      setInput(prefix + input.slice(trigger.end));
      setSuggest(null);
      requestAnimationFrame(() => {
        const ta = inputRef.current;
        if (!ta) return;
        ta.focus();
        ta.selectionStart = ta.selectionEnd = prefix.length;
      });
    },
    [input],
  );

  const toggleAutonomy = () =>
    onUpdateConfig({ ...config, autoApproveEdits: !config.autoApproveEdits });

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");
    setSuggest(null);
    void send(text);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + delta + suggest.items.length) % suggest.items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(suggest.items[highlight], suggest.trigger);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="ai-sidebar">
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <Sparkles size={15} />
          <span>AI Assistant</span>
        </div>
        <div className="ai-sidebar-actions">
          <button
            className="small-icon"
            title={expanded ? "Collapse AI chat" : "Expand AI chat"}
            aria-label={expanded ? "Collapse AI chat" : "Expand AI chat"}
            aria-pressed={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
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
          {config.provider === "cloud" && cloudProvider?.apiKeyUrl ? (
            <button
              type="button"
              className="cloud-form-link"
              onClick={() => onOpenExternal?.(cloudProvider.apiKeyUrl)}
            >
              Get API key
            </button>
          ) : null}
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
                <p className="ai-sidebar-hints-tip">
                  Type <code>@</code> to attach a project file, or <code>\</code> for
                  quick commands. I can read every file in the project either way.
                </p>
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
                <div className="ai-msg-text">{m.text || (m.pending ? "…" : "")}</div>
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
            {suggest && (
              <div className="ai-mention-popup" role="listbox">
                <div className="ai-mention-popup-title">
                  {suggest.trigger.kind === "file"
                    ? "Attach a project file"
                    : "Quick commands"}
                </div>
                {suggest.items.map((item, i) => (
                  <button
                    key={item.value}
                    role="option"
                    aria-selected={i === highlight}
                    className={`ai-mention-item ${i === highlight ? "active" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    // onMouseDown so the textarea keeps focus.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      acceptSuggestion(item, suggest.trigger);
                    }}
                  >
                    <span className="ai-mention-value">
                      {suggest.trigger.kind === "file" ? "@" : "\\"}
                      {item.value}
                    </span>
                    {item.hint && <span className="ai-mention-hint">{item.hint}</span>}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              placeholder="Ask the AI… @ attaches a file, \ for commands"
              rows={2}
              onChange={(e) => {
                setInput(e.target.value);
                updateSuggestions(e.target.value, e.target.selectionStart ?? 0);
              }}
              onSelect={(e) => {
                const ta = e.currentTarget;
                updateSuggestions(ta.value, ta.selectionStart ?? 0);
              }}
              onBlur={() => setSuggest(null)}
              onKeyDown={onInputKeyDown}
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
