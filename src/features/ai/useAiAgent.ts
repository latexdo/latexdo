import { useCallback, useRef, useState } from "react";
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

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Interleaved tool activity for display. */
  activity: { name: string; ok: boolean; summary: string }[];
  pending?: boolean;
}

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

export function useAiAgent(config: AiConfig, ctx: AgentContext) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestId = useRef<string>("");
  // The full model-facing transcript, kept in parallel to the UI messages.
  const historyRef = useRef<ChatMessage[]>([]);

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
      const sel = access.currentEditor
        ? ctx.selection()
        : { text: "", hasSelection: false };
      const system = buildSystemPrompt({
        userName: config.userName || config.profile.displayName,
        projectName: ctx.projectName(),
        activeFilePath: access.currentEditor ? ctx.activeFilePath() : null,
        hasSelection: sel.hasSelection,
        providerSupportsNativeTools: supportsNativeTools(config),
        access,
        researchContext: access.researcherProfile
          ? buildResearchContext(config.profile)
          : null,
      });

      if (!access.chatHistory) {
        historyRef.current = [];
      }

      if (historyRef.current.length === 0) {
        historyRef.current.push({ role: "system", content: system });
      } else {
        historyRef.current[0] = { role: "system", content: system };
      }
      historyRef.current.push({ role: "user", content: text });

      const userMsg: UiMessage = { id: newId(), role: "user", text, activity: [] };
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
      } finally {
        setIsRunning(false);
        setStatus("");
        abortRef.current = null;
      }
    },
    [config, ctx, isRunning, requestApprovalInteractive],
  );

  const reset = useCallback(() => {
    clearPendingApproval(false);
    historyRef.current = [];
    setMessages([]);
    setStatus("");
  }, [clearPendingApproval]);

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
