// Ollama backend: talks to a local Ollama daemon over HTTP. Routed through the
// main process (not the renderer) so hosted/browser builds don't hit
// mixed-content blocking. Uses Ollama's native tool-calling.

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  toolCallId?: string;
}

interface ToolSchema {
  name: string;
  description: string;
  params: Record<string, { type: string; description: string; enum?: string[] }>;
  required: string[];
}

type GenerationStep =
  | { type: "text"; content: string }
  | {
      type: "tool_calls";
      content: string;
      toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
    }
  | { type: "error"; content: string };

export async function detectOllama(
  baseUrl: string,
): Promise<{ available: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { available: false, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { available: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { available: false, models: [] };
  }
}

function toOllamaTools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.params).map(([k, p]) => [
            k,
            p.enum
              ? { type: p.type, description: p.description, enum: p.enum }
              : { type: p.type, description: p.description },
          ]),
        ),
        required: t.required,
      },
    },
  }));
}

function toOllamaMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({
          function: { name: c.name, arguments: c.args },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export async function generateOllamaStep(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<GenerationStep> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: toOllamaMessages(messages),
        tools: tools.length ? toOllamaTools(tools) : undefined,
        options: { temperature: 0.3 },
      }),
    });
    if (!res.ok) {
      return { type: "error", content: `Ollama ${res.status}: ${await res.text()}` };
    }
    const data = (await res.json()) as {
      message?: {
        content?: string;
        tool_calls?: {
          function: { name: string; arguments: Record<string, unknown> };
        }[];
      };
    };
    const text = data.message?.content ?? "";
    if (text) onToken(text);
    const calls = data.message?.tool_calls ?? [];
    if (calls.length) {
      return {
        type: "tool_calls",
        content: text,
        toolCalls: calls.map((c, i) => ({
          id: `call_${Date.now()}_${i}`,
          name: c.function.name,
          args: c.function.arguments ?? {},
        })),
      };
    }
    return { type: "text", content: text };
  } catch (error) {
    return {
      type: "error",
      content: `Ollama error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
