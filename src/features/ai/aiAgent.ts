// Renderer-side agent loop. Provider-agnostic: it drives a single-step
// `generate` function (which talks to main over IPC) and executes any tool
// calls locally, looping until the model produces a plain-text answer or we hit
// the step budget.

import type { ChatMessage, GenerationStep, ToolCall, ToolSchema } from "./aiTypes";
import { agentToolSchemas, executeTool, type AgentContext } from "./aiTools";

export type AgentEvent =
  | { type: "assistant-token"; text: string }
  | { type: "assistant-message"; text: string }
  | { type: "tool-start"; call: ToolCall }
  | {
      type: "tool-result";
      callId: string;
      name: string;
      content: string;
      ok: boolean;
    }
  | { type: "step"; index: number }
  | { type: "done"; reason: "completed" | "max-steps" | "aborted" }
  | { type: "error"; message: string };

export type GenerateStepFn = (
  messages: ChatMessage[],
  tools: ToolSchema[],
  onToken: (text: string) => void,
) => Promise<GenerationStep>;

export interface RunAgentArgs {
  messages: ChatMessage[];
  ctx: AgentContext;
  generate: GenerateStepFn;
  autoApprove: boolean;
  maxSteps: number;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

/**
 * Try to recover a tool call from a plain-text JSON protocol response.
 * Tolerates the shapes small models actually emit: markdown code fences,
 * OpenAI-style {"name": …, "arguments": …}, and prose around the object.
 */
export function parseJsonToolCall(text: string): ToolCall | null {
  // Strip ```json … ``` fences before hunting for the object.
  const unfenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(unfenced.slice(start, end + 1)) as {
      tool?: unknown;
      args?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    const name =
      typeof obj.tool === "string"
        ? obj.tool
        : typeof obj.name === "string"
          ? obj.name
          : null;
    if (!name) return null;
    const rawArgs = obj.tool != null ? obj.args : (obj.arguments ?? obj.args);
    return {
      id: `call_${Math.random().toString(36).slice(2, 10)}`,
      name,
      args:
        rawArgs && typeof rawArgs === "object"
          ? (rawArgs as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

export function looksLikeProjectAccessRefusal(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const deniesAccess =
    /\b(?:do not|don't|dont|cannot|can't|cant|won't|wont)\s+(?:currently\s+)?(?:have\s+)?access\b/i.test(
      normalized,
    ) ||
    /\b(?:cannot|can't|cant)\s+(?:access|read|view|open|inspect)\b/i.test(normalized);

  // Small models often don't refuse outright — they deflect by asking the user
  // to paste content that is already in the project ("Please provide the text
  // of the first paragraph…").
  const asksUserToSupply =
    /\b(?:please|could you|can you|i(?:'| a)m going to need you to|i need you to|i(?:'l| wi)l?l need(?: you)?(?: to)?)\s+(?:share|upload|provide|paste|send)\b/i.test(
      normalized,
    ) ||
    /\b(?:share|upload|provide|paste|send)\s+(?:me\s+)?(?:the|your|that|this)\b/i.test(
      normalized,
    );

  if (!deniesAccess && !asksUserToSupply) return false;

  const projectContext =
    /\b(?:current|conversation|discussion|topic|file|files|document|documents|text|contents?|paragraphs?|sections?|abstract|chapters?|project|workspace|latex|tex|bib|bibliography|publication|publications|paper|papers|citation|citations|reference|references)\b/i.test(
      normalized,
    );

  return projectContext || (deniesAccess && asksUserToSupply);
}

export async function runAgent(args: RunAgentArgs): Promise<ChatMessage[]> {
  const { ctx, generate, autoApprove, maxSteps, signal, onEvent } = args;
  const messages = [...args.messages];
  let retriedProjectAccessRefusal = false;

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal?.aborted) {
      onEvent({ type: "done", reason: "aborted" });
      return messages;
    }
    onEvent({ type: "step", index: step });

    let result: GenerationStep;
    try {
      result = await generate(messages, agentToolSchemas, (token) =>
        onEvent({ type: "assistant-token", text: token }),
      );
    } catch (error) {
      onEvent({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return messages;
    }

    if (signal?.aborted) {
      onEvent({ type: "done", reason: "aborted" });
      return messages;
    }

    if (result.type === "error") {
      onEvent({ type: "error", message: result.content });
      return messages;
    }

    // Some local models signal tools via JSON text instead of the tool channel.
    let toolCalls: ToolCall[] | null = null;
    if (result.type === "tool_calls") {
      toolCalls = result.toolCalls;
    } else if (result.type === "text") {
      const recovered = parseJsonToolCall(result.content);
      if (recovered) toolCalls = [recovered];
    }

    if (!toolCalls || toolCalls.length === 0) {
      const finalText = result.content.trim();
      if (
        !retriedProjectAccessRefusal &&
        step + 1 < maxSteps &&
        looksLikeProjectAccessRefusal(finalText)
      ) {
        retriedProjectAccessRefusal = true;
        messages.push({ role: "assistant", content: finalText });
        messages.push({
          role: "user",
          content:
            "Correction: you are embedded in LatexDo and already have the project context. Never ask me to paste, share, or provide text. If the active document's content is included in your system prompt, answer directly from it now. Otherwise call read_file or get_active_document, then answer from what you read.",
        });
        continue;
      }
      onEvent({ type: "assistant-message", text: finalText });
      messages.push({ role: "assistant", content: finalText });
      onEvent({ type: "done", reason: "completed" });
      return messages;
    }

    // Record the assistant turn that requested tools.
    messages.push({
      role: "assistant",
      content: result.content,
      toolCalls,
    });

    for (const call of toolCalls) {
      if (signal?.aborted) {
        onEvent({ type: "done", reason: "aborted" });
        return messages;
      }
      onEvent({ type: "tool-start", call });
      const toolResult = await executeTool(call.name, call.args, ctx, {
        autoApprove,
      });
      onEvent({
        type: "tool-result",
        callId: call.id,
        name: call.name,
        content: toolResult.content,
        ok: toolResult.ok,
      });
      messages.push({
        role: "tool",
        content: toolResult.content,
        toolCallId: call.id,
        name: call.name,
      });
    }
  }

  onEvent({ type: "done", reason: "max-steps" });
  return messages;
}
