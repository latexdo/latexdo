// Cloud provider, implemented entirely in the renderer via fetch so it works in
// BOTH the Electron and browser builds (the browser build has no Node runtime
// for a local model). Supports Anthropic Messages and OpenAI-compatible chat.

import type {
  ChatMessage,
  GenerateRequest,
  GenerationStep,
  ToolCall,
  ToolSchema,
} from "./aiTypes";

function toJsonSchema(tool: ToolSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(tool.params)) {
    properties[key] = param.enum
      ? { type: param.type, description: param.description, enum: param.enum }
      : { type: param.type, description: param.description };
  }
  return { type: "object", properties, required: tool.required };
}

// ---- Anthropic ----------------------------------------------------------

async function generateAnthropic(
  req: GenerateRequest,
  onToken: (t: string) => void,
): Promise<GenerationStep> {
  const { cloudApiKey, cloudModel, cloudBaseUrl } = req.options;
  const base = cloudBaseUrl || "https://api.anthropic.com";
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => anthropicMessage(m));

  const tools = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toJsonSchema(t),
  }));

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cloudApiKey ?? "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cloudModel || "claude-haiku-4-5",
      max_tokens: req.options.maxTokens ?? 2048,
      temperature: req.options.temperature ?? 0.3,
      system,
      tools,
      messages,
    }),
  });

  if (!res.ok) {
    return { type: "error", content: `Anthropic API ${res.status}: ${await res.text()}` };
  }
  const data = (await res.json()) as {
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >;
  };

  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text") {
      textParts.push(block.text);
      onToken(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
    }
  }
  if (toolCalls.length) {
    return { type: "tool_calls", content: textParts.join(""), toolCalls };
  }
  return { type: "text", content: textParts.join("") };
}

function anthropicMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: m.toolCallId, content: m.content },
      ],
    };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    const content: unknown[] = [];
    if (m.content.trim()) content.push({ type: "text", text: m.content });
    for (const call of m.toolCalls) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.args,
      });
    }
    return { role: "assistant", content };
  }
  return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
}

// ---- OpenAI-compatible --------------------------------------------------

async function generateOpenAi(
  req: GenerateRequest,
  onToken: (t: string) => void,
): Promise<GenerationStep> {
  const { cloudApiKey, cloudModel, cloudBaseUrl } = req.options;
  const base = cloudBaseUrl || "https://api.openai.com/v1";

  const messages = req.messages.map((m) => openAiMessage(m));
  const tools = req.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t),
    },
  }));

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cloudApiKey ?? ""}`,
    },
    body: JSON.stringify({
      model: cloudModel || "gpt-4o-mini",
      temperature: req.options.temperature ?? 0.3,
      max_tokens: req.options.maxTokens ?? 2048,
      tools: tools.length ? tools : undefined,
      messages,
    }),
  });

  if (!res.ok) {
    return { type: "error", content: `OpenAI API ${res.status}: ${await res.text()}` };
  }
  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  const text = message?.content ?? "";
  if (text) onToken(text);
  if (message?.tool_calls?.length) {
    const toolCalls: ToolCall[] = message.tool_calls.map((c) => ({
      id: c.id,
      name: c.function.name,
      args: safeParse(c.function.arguments),
    }));
    return { type: "tool_calls", content: text, toolCalls };
  }
  return { type: "text", content: text };
}

function openAiMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function generateStepCloud(
  req: GenerateRequest,
  onToken: (t: string) => void,
): Promise<GenerationStep> {
  const vendor = req.options.cloudVendor ?? "anthropic";
  if (vendor === "anthropic") return generateAnthropic(req, onToken);
  return generateOpenAi(req, onToken);
}
