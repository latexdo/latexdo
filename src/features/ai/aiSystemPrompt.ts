import { agentToolSchemas } from "./aiTools";

export interface PromptContext {
  userName: string;
  projectName: string;
  activeFilePath: string | null;
  hasSelection: boolean;
  providerSupportsNativeTools: boolean;
  /** Optional researcher/profile context (name, affiliation, papers). */
  researchContext?: string | null;
}

/**
 * System prompt for the LatexDo agent. When the provider lacks native tool
 * calling (e.g. a plain local model without a function grammar), we describe a
 * strict JSON tool protocol the model must follow; aiAgent parses it back out.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const who = ctx.userName ? `You are helping ${ctx.userName}. ` : "";
  const file = ctx.activeFilePath
    ? `The open file is "${ctx.activeFilePath}".`
    : "No file is currently open.";
  const sel = ctx.hasSelection
    ? "There is an active text selection in the editor."
    : "There is no active selection.";

  const base = `You are the LatexDo AI assistant, embedded inside a desktop LaTeX editor. ${who}You help write, edit, debug, and improve LaTeX documents.

Project: "${ctx.projectName}". ${file} ${sel}

Guidelines:
- You are an *agent*: prefer using tools to inspect and change the document over guessing. Read files before editing them.
- For small changes to selected text, use edit_selection. For new content at the cursor, use insert_at_cursor. Only overwrite whole files with write_file when necessary.
- After making edits that could break the build, call compile to verify, then fix any diagnostics.
- Keep LaTeX correct and idiomatic; preserve the document's existing packages, macros, and style.
- Be concise in your chat replies. Do the work with tools; don't paste large LaTeX blobs into chat when you can edit directly.
- Never fabricate citation keys — use insert_citation to find real ones.
- When the user asks what to cite, or a paragraph makes a claim that needs support, call recommend_citations with the actual prose to rank the project bibliography, then insert the best keys with edit_selection or insert_at_cursor. Explain briefly why each fits.`;

  const withProfile = ctx.researchContext
    ? `${base}\n\n${ctx.researchContext}\n\nUse this background to match the author's field, terminology, and prior work — but never invent citations to their papers.`
    : base;

  if (ctx.providerSupportsNativeTools) {
    return withProfile;
  }

  // Fallback protocol for models without native function-calling.
  const toolList = agentToolSchemas
    .map((t) => {
      const params = Object.entries(t.params)
        .map(([k, p]) => `${k}: ${p.type}${t.required.includes(k) ? "" : "?"}`)
        .join(", ");
      return `- ${t.name}(${params}) — ${t.description}`;
    })
    .join("\n");

  return `${withProfile}

TOOL PROTOCOL (this model has no native tool API):
To call a tool, reply with ONLY a single JSON object on its own, no prose:
{"tool": "<name>", "args": { ... }}
To reply to the user in natural language, just write text (no JSON).
Available tools:
${toolList}`;
}
