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
  | { type: "tool-result"; callId: string; name: string; content: string; ok: boolean }
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

/** Try to recover a tool call from a plain-text JSON protocol response. */
export function parseJsonToolCall(text: string): ToolCall | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1)) as {
      tool?: unknown;
      args?: unknown;
    };
    if (typeof obj.tool !== "string") return null;
    return {
      id: `call_${Math.random().toString(36).slice(2, 10)}`,
      name: obj.tool,
      args:
        obj.args && typeof obj.args === "object"
          ? (obj.args as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

export async function runAgent(args: RunAgentArgs): Promise<void> {
  const { ctx, generate, autoApprove, maxSteps, signal, onEvent } = args;
  const messages = [...args.messages];

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal?.aborted) {
      onEvent({ type: "done", reason: "aborted" });
      return;
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
      return;
    }

    if (signal?.aborted) {
      onEvent({ type: "done", reason: "aborted" });
      return;
    }

    if (result.type === "error") {
      onEvent({ type: "error", message: result.content });
      return;
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
      onEvent({ type: "assistant-message", text: finalText });
      messages.push({ role: "assistant", content: finalText });
      onEvent({ type: "done", reason: "completed" });
      return;
    }

    // Record the assistant turn that requested tools.
    messages.push({
      role: "assistant",
      content: result.type === "text" ? result.content : result.content,
      toolCalls,
    });

    for (const call of toolCalls) {
      if (signal?.aborted) {
        onEvent({ type: "done", reason: "aborted" });
        return;
      }
      onEvent({ type: "tool-start", call });
      const toolResult = await executeTool(call.name, call.args, ctx, { autoApprove });
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
}
