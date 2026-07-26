import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { AiConfig } from "./aiConfig";
import type { AgentContext, EditProposal } from "./aiTools";
import type {
  ChatMessage,
  GenerateRequest,
  GenerationStep,
  ToolSchema,
} from "./aiTypes";
import { buildSystemPrompt } from "./aiSystemPrompt";
import { buildResearchContext } from "./researcherProfile";
import { generateStep, abortGeneration } from "./aiClient";
import { findLocalModel } from "./aiModels";
import { runAgent, type AgentEvent } from "./aiAgent";
import {
  attachMentionedFiles,
  expandSlashCommand,
  extractFileMentions,
} from "./aiMentions";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Interleaved tool activity for display. */
  activity: { name: string; ok: boolean; summary: string }[];
  pending?: boolean;
}

interface PersistedAiAgentState {
  version: 1;
  messages: UiMessage[];
  history: ChatMessage[];
  updatedAt: number;
}

const maxPersistedUiMessages = 80;
const maxPersistedHistoryMessages = 80;
const maxPersistedContentLength = 12_000;

const accessDenied = (setting: string) =>
  Promise.reject(new Error(`${setting} access is disabled in AI settings.`));

function newId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function providerFor(config: AiConfig): "local" | "ollama" | "cloud" {
  if (config.provider === "off") return "cloud";
  return config.provider === "local" ||
    config.provider === "ollama" ||
    config.provider === "cloud"
    ? config.provider
    : "cloud";
}

function trimText(value: string): string {
  return value.length > maxPersistedContentLength
    ? `${value.slice(0, maxPersistedContentLength)}\n\n[trimmed]`
    : value;
}

function normalizeUiMessage(raw: unknown): UiMessage | null {
  const value = raw as Partial<UiMessage>;
  if (
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.text !== "string"
  ) {
    return null;
  }
  const activity = Array.isArray(value.activity)
    ? value.activity
        .map((item) => {
          const activityItem = item as Partial<UiMessage["activity"][number]>;
          if (
            typeof activityItem.name !== "string" ||
            typeof activityItem.ok !== "boolean" ||
            typeof activityItem.summary !== "string"
          ) {
            return null;
          }
          return {
            name: activityItem.name.slice(0, 120),
            ok: activityItem.ok,
            summary: trimText(activityItem.summary).slice(0, 400),
          };
        })
        .filter((item): item is UiMessage["activity"][number] => item !== null)
    : [];
  return {
    id: value.id,
    role: value.role,
    text: trimText(value.text),
    activity,
    pending: false,
  };
}

function normalizeChatMessage(raw: unknown): ChatMessage | null {
  const value = raw as Partial<ChatMessage>;
  if (
    (value.role !== "system" &&
      value.role !== "user" &&
      value.role !== "assistant" &&
      value.role !== "tool") ||
    typeof value.content !== "string"
  ) {
    return null;
  }
  return {
    role: value.role,
    content: trimText(value.content),
    toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : undefined,
    toolCallId: typeof value.toolCallId === "string" ? value.toolCallId : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
  };
}

function loadPersistedState(storageKey?: string): PersistedAiAgentState | null {
  if (!storageKey) return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as
      | Partial<PersistedAiAgentState>
      | null;
    if (!raw || raw.version !== 1) return null;
    const messages = Array.isArray(raw.messages)
      ? raw.messages
          .map(normalizeUiMessage)
          .filter((message): message is UiMessage => message !== null)
          .slice(-maxPersistedUiMessages)
      : [];
    const history = Array.isArray(raw.history)
      ? raw.history
          .map(normalizeChatMessage)
          .filter((message): message is ChatMessage => message !== null)
          .slice(-maxPersistedHistoryMessages)
      : [];
    return {
      version: 1,
      messages,
      history,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function savePersistedState(
  storageKey: string | undefined,
  messages: UiMessage[],
  history: ChatMessage[],
): void {
  if (!storageKey) return;
  const payload: PersistedAiAgentState = {
    version: 1,
    messages: messages
      .map(normalizeUiMessage)
      .filter((message): message is UiMessage => message !== null)
      .slice(-maxPersistedUiMessages),
    history: history
      .map(normalizeChatMessage)
      .filter((message): message is ChatMessage => message !== null)
      .slice(-maxPersistedHistoryMessages),
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore quota/private-mode failures; chat still works for this session.
  }
}

function clearPersistedState(storageKey?: string): void {
  if (!storageKey) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore localStorage failures.
  }
}

export function supportsNativeTools(config: AiConfig): boolean {
  if (config.provider === "cloud") return true;
  if (config.provider === "ollama") return true;
  // The Electron local-model adapter currently exposes only plain chat text.
  // Even tool-capable GGUF models need the JSON fallback protocol here.
  return false;
}

function buildRequest(
  config: AiConfig,
  requestId: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
): GenerateRequest {
  const model = findLocalModel(config.modelId);
  return {
    requestId,
    provider: providerFor(config),
    messages,
    tools,
    options: {
      modelId: config.modelId,
      fileName: model?.fileName,
      temperature: 0.3,
      maxTokens: 2048,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaModel: config.ollamaModel,
      cloudVendor: config.cloud.vendor,
      cloudBaseUrl: config.cloud.baseUrl,
      cloudModel: config.cloud.model,
      cloudApiKey: config.cloud.apiKey,
    },
  };
}

export function useAiAgent(config: AiConfig, ctx: AgentContext, storageKey?: string) {
  const persistedStateRef = useRef<PersistedAiAgentState | null>(null);
  if (persistedStateRef.current === null) {
    persistedStateRef.current = loadPersistedState(storageKey) ?? {
      version: 1,
      messages: [],
      history: [],
      updatedAt: 0,
    };
  }
  const [messages, setMessagesState] = useState<UiMessage[]>(
    () => persistedStateRef.current?.messages ?? [],
  );
  const messagesRef = useRef<UiMessage[]>(messages);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestId = useRef<string>("");
  // The full model-facing transcript, kept in parallel to the UI messages.
  const historyRef = useRef<ChatMessage[]>(persistedStateRef.current?.history ?? []);

  const setMessages = useCallback((next: SetStateAction<UiMessage[]>) => {
    setMessagesState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      messagesRef.current = resolved;
      return resolved;
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    if (!storageKey) return;
    const timer = window.setTimeout(() => {
      savePersistedState(storageKey, messages, historyRef.current);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [messages, storageKey]);

  // Step-by-step approval: in "ask" mode the agent pauses on each mutating
  // action until the user approves or declines.
  const [pendingApproval, setPendingApproval] = useState<EditProposal | null>(null);
  const approvalResolverRef = useRef<((ok: boolean) => void) | null>(null);

  const resolveApproval = useCallback((ok: boolean) => {
    const resolve = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    resolve?.(ok);
  }, []);

  const requestApprovalInteractive = useCallback(
    (proposal: EditProposal): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        approvalResolverRef.current = resolve;
        setPendingApproval(proposal);
        setStatus("Waiting for your approval…");
      }),
    [],
  );

  const clearPendingApproval = useCallback((approved: boolean) => {
    const resolve = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    resolve?.(approved);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    if (activeRequestId.current) void abortGeneration(activeRequestId.current);
    clearPendingApproval(false);
    setIsRunning(false);
    setStatus("Stopped.");
  }, [clearPendingApproval]);

  const send = useCallback(
    async (userText: string) => {
      const text = userText.trim();
      if (!text || isRunning) return;

      const access = config.access;
      // Give the model the project layout up front so it can answer questions
      // about any file in the project without being told which one.
      let projectFiles: string[] = [];
      if (access.projectFiles) {
        try {
          projectFiles = await ctx.listFiles();
        } catch {
          projectFiles = [];
        }
      }
      const sel = access.currentEditor
        ? ctx.selection()
        : { text: "", hasSelection: false };
      // Small local models are unreliable at tool calling, so inline the open
      // document into the system prompt (replaced each turn, so only one copy
      // ever lives in the transcript). Tool-capable providers read on demand.
      const nativeTools = supportsNativeTools(config);
      const activePath = access.currentEditor ? ctx.activeFilePath() : null;
      const activeDocument =
        !nativeTools && activePath
          ? { path: activePath, text: ctx.documentText() }
          : null;
      const system = buildSystemPrompt({
        userName: config.userName || config.profile.displayName,
        projectName: ctx.projectName(),
        activeFilePath: activePath,
        hasSelection: sel.hasSelection,
        providerSupportsNativeTools: nativeTools,
        access,
        researchContext: access.researcherProfile
          ? buildResearchContext(config.profile)
          : null,
        projectFiles: access.projectFiles ? projectFiles : null,
        activeDocument,
      });

      // `\command` expands to its full instruction; `@file` mentions get the
      // referenced files' contents attached to the model-facing message. The
      // UI keeps showing exactly what the user typed.
      const mentions = extractFileMentions(text, projectFiles);
      const modelText = await attachMentionedFiles(
        expandSlashCommand(text),
        mentions,
        ctx.readFile,
      );

      if (!access.chatHistory) {
        historyRef.current = [];
      }

      if (historyRef.current.length === 0) {
        historyRef.current.push({ role: "system", content: system });
      } else {
        historyRef.current[0] = { role: "system", content: system };
      }
      historyRef.current.push({ role: "user", content: modelText });

      const userMsg: UiMessage = {
        id: newId(),
        role: "user",
        text,
        activity: [],
      };
      const assistantMsg: UiMessage = {
        id: newId(),
        role: "assistant",
        text: "",
        activity: [],
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);
      setStatus("Thinking…");

      const patchAssistant = (patch: (m: UiMessage) => UiMessage) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? patch(m) : m)),
        );

      const generate = async (
        msgs: ChatMessage[],
        tools: ToolSchema[],
        onToken: (t: string) => void,
      ): Promise<GenerationStep> => {
        const requestId = newId();
        activeRequestId.current = requestId;
        const req = buildRequest(config, requestId, msgs, tools);
        return generateStep(req, onToken);
      };

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case "assistant-token":
            patchAssistant((m) => ({ ...m, text: m.text + event.text }));
            break;
          case "assistant-message":
            patchAssistant((m) => ({ ...m, text: event.text, pending: false }));
            break;
          case "tool-start":
            setStatus(`Running ${event.call.name}…`);
            break;
          case "tool-result":
            patchAssistant((m) => ({
              ...m,
              activity: [
                ...m.activity,
                {
                  name: event.name,
                  ok: event.ok,
                  summary: event.content.slice(0, 200),
                },
              ],
            }));
            break;
          case "error":
            patchAssistant((m) => ({
              ...m,
              text: (m.text ? m.text + "\n\n" : "") + `⚠️ ${event.message}`,
              pending: false,
            }));
            break;
          case "done":
            patchAssistant((m) => ({ ...m, pending: false }));
            break;
        }
      };

      // In "ask" mode, route approvals through the sidebar UI. In autonomous
      // mode, autoApprove short-circuits and requestApproval is never called.
      const effectiveCtx: AgentContext = {
        ...ctx,
        activeFilePath: () => (access.currentEditor ? ctx.activeFilePath() : null),
        listFiles: () =>
          access.projectFiles ? ctx.listFiles() : accessDenied("Project files"),
        readFile: (path) =>
          access.projectFiles ? ctx.readFile(path) : accessDenied("Project files"),
        writeFile: (path, content) =>
          access.projectFiles
            ? ctx.writeFile(path, content)
            : accessDenied("Project files"),
        documentText: () => (access.currentEditor ? ctx.documentText() : ""),
        selection: () =>
          access.currentEditor ? ctx.selection() : { text: "", hasSelection: false },
        applyEdit: (proposal) =>
          access.currentEditor
            ? ctx.applyEdit(proposal)
            : accessDenied("Current editor"),
        insertCitation: (query) =>
          access.bibliography
            ? ctx.insertCitation(query)
            : accessDenied("Bibliography"),
        recommendCitations: (passage) =>
          access.bibliography
            ? ctx.recommendCitations(passage)
            : accessDenied("Bibliography"),
        requestApproval: requestApprovalInteractive,
      };

      try {
        const updatedHistory = await runAgent({
          messages: historyRef.current,
          ctx: effectiveCtx,
          generate,
          autoApprove: config.autoApproveEdits,
          maxSteps: config.maxAgentSteps,
          signal: controller.signal,
          onEvent,
        });
        historyRef.current = access.chatHistory ? updatedHistory : [];
        savePersistedState(storageKey, messagesRef.current, historyRef.current);
      } finally {
        setIsRunning(false);
        setStatus("");
        abortRef.current = null;
      }
    },
    [config, ctx, isRunning, requestApprovalInteractive, setMessages, storageKey],
  );

  const reset = useCallback(() => {
    clearPendingApproval(false);
    historyRef.current = [];
    setMessages([]);
    clearPersistedState(storageKey);
    setStatus("");
  }, [clearPendingApproval, setMessages, storageKey]);

  return {
    messages,
    isRunning,
    status,
    send,
    abort,
    reset,
    pendingApproval,
    resolveApproval,
  };
}
