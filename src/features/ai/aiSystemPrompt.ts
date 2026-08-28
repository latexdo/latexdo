import { agentToolSchemas } from "./aiTools";
import type { AiAccessConfig } from "./aiConfig";

export interface PromptContext {
  userName: string;
  projectName: string;
  activeFilePath: string | null;
  hasSelection: boolean;
  providerSupportsNativeTools: boolean;
  access?: AiAccessConfig;
  /** Optional researcher/profile context (name, affiliation, papers). */
  researchContext?: string | null;
  /**
   * Relative paths of every file in the open project, so the model knows the
   * project layout up front instead of having to call list_files first.
   * Null/empty when project-file access is disabled or no project is open.
   */
  projectFiles?: string[] | null;
  /**
   * Full text of the open document, inlined for providers that are unreliable
   * at tool calling (small local models) so they can answer content questions
   * without a tool round trip. Null for providers with native tool support.
   */
  activeDocument?: { path: string; text: string } | null;
}

const maxListedFiles = 200;

function fileListing(files: string[] | null | undefined): string {
  if (!files || files.length === 0) return "";
  const shown = files.slice(0, maxListedFiles);
  const more =
    files.length > shown.length
      ? `\n… and ${files.length - shown.length} more (use list_files for the rest).`
      : "";
  return `\n\nProject files (relative paths — read any of them with read_file):\n${shown.join("\n")}${more}`;
}

const maxInlineDocChars = 12000;

function activeDocSection(
  doc: { path: string; text: string } | null | undefined,
): string {
  if (!doc || !doc.text.trim()) return "";
  const clipped =
    doc.text.length > maxInlineDocChars
      ? `${doc.text.slice(0, maxInlineDocChars)}\n… (truncated — use read_file for the rest)`
      : doc.text;
  return `\n\nActive document — the current full content of "${doc.path}" is included below. Answer questions about the open document, its sections, paragraphs, or prose DIRECTLY from this content. Never ask the user to paste or provide text that appears here.\n"""\n${clipped}\n"""`;
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
  const access = ctx.access;
  const accessSummary = access
    ? `AI access from Settings: chat history ${access.chatHistory ? "on" : "off"}, current editor ${access.currentEditor ? "on" : "off"}, project files ${access.projectFiles ? "on" : "off"}, bibliography/citations ${access.bibliography ? "on" : "off"}, researcher profile ${access.researcherProfile ? "on" : "off"}.`
    : "AI access from Settings: full project context is available.";

  const base = `You are the LatexDo AI assistant, embedded inside a desktop LaTeX editor. ${who}You help write, edit, debug, and improve LaTeX documents.

Project: "${ctx.projectName}". ${file} ${sel}
${accessSummary}${fileListing(ctx.projectFiles)}${activeDocSection(ctx.activeDocument)}

Guidelines:
- You are an *agent* with tool access to the user's currently open LaTeX project. You can list project files, read .tex/.bib files, inspect the active document, edit text, and compile.
- Do not say you lack access to the user's files, document, bibliography, publications, or current project. Do not ask the user to upload, paste, or share files that are already in the project. Use list_files, read_file, get_active_document, insert_citation, or recommend_citations to inspect the available context.
- If a requested context source is disabled in AI settings, say exactly that and name the setting. Otherwise use the available tools.
- Files the user referenced with @ are attached to their message; use them directly. For any other file in the listing above, call read_file — never claim a listed file is unavailable.
- Questions about "this project" mean the open project, whatever it is: consult the file listing, read the relevant files, and answer from their actual contents.
- Never describe or summarize the project from file names alone — that produces vague guesses. When asked what the project/paper is about, first read the main .tex file (and the abstract/introduction) with read_file or get_active_document, then answer with concrete specifics: the actual topic, claims, and section contents.
- Read files before editing them.
- For small changes to selected text, use edit_selection. For new content at the cursor, use insert_at_cursor. Only overwrite whole files with write_file when necessary.
- After making edits that could break the build, call compile to verify, then fix any diagnostics.
- Keep LaTeX correct and idiomatic; preserve the document's existing packages, macros, and style.
- Be concise in your chat replies. Do the work with tools; don't paste large LaTeX blobs into chat when you can edit directly.
- The messages in this chat are the current conversation. When asked about the current discussion, use the visible transcript. When asked what the current document, file, paper, section, work, or "current" is about, call get_active_document first and summarize the inspected content.
- Never fabricate citation keys. Citation keys must come from bibliography tools.
- When the user asks about their publications, papers, bibliography, references, or citations, first use the provided researcher profile if it lists papers. If the profile is empty or insufficient, inspect the project bibliography by listing files and reading relevant .bib/.tex files, then answer only from what you found.
- When asked what to cite, call recommend_citations with the exact passage.
- A citation recommendation is a source choice, not permission to rewrite prose.
- Preserve the user's existing citation command and citation package conventions.
- Never replace \\citep with \\cite, \\parencite with \\cite, or otherwise normalize citation commands.
- When adding a citation, make the smallest possible editor change.
- Do not change prose, punctuation, or existing citations unless required for the requested operation.
- If citation relevance is uncertain, present candidates instead of inserting one.`;

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

Rules:
- One JSON object per reply, nothing else — no prose before or after it, no markdown fences.
- After each tool result arrives, either call another tool or write your final prose answer.
- Prefer calling a tool over asking the user for anything that could be in the project.

Example session:
User: what is the introduction about?
You: {"tool": "read_file", "args": {"path": "main.tex"}}
Tool read_file result: \\section{Introduction} We study …
You: The introduction presents … (prose answer based on the file contents)

Available tools:
${toolList}`;
}
