// Tool definitions + dispatcher for the AI agent.
//
// Tools are what make this an *integrated* agent rather than a chat box: the
// model reads and edits the LaTeX, compiles, reads diagnostics, and calls the
// existing rule-based checkers. Tool implementations are injected via
// AgentContext so this module stays decoupled from App internals and testable.

import type { AiAccessConfig } from "./aiConfig";
import type { ToolResult, ToolSchema } from "./aiTypes";

export interface EditProposal {
  /** File the edit targets (relative path). */
  path: string;
  /** Whole-file replacement or a selection replacement. */
  kind: "replace-selection" | "insert-at-cursor" | "replace-file";
  newText: string;
  /** For diff UI. */
  oldText?: string;
}

/**
 * The bridge between abstract tools and the concrete editor/project. App wires
 * real implementations; tests can pass fakes.
 */
export interface AgentContext {
  /** True only when a real LatexDo project/workspace is open. */
  hasProject?: () => boolean;
  projectName: () => string;
  activeFilePath: () => string | null;
  listFiles: () => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  documentText: () => string;
  selection: () => { text: string; hasSelection: boolean };
  applyEdit: (proposal: EditProposal) => Promise<void>;
  compile: () => Promise<{ ok: boolean; log: string; diagnostics: string[] }>;
  runChecks: (kind: string) => Promise<string>;
  insertCitation: (query: string) => Promise<string>;
  /**
   * Rank the project bibliography against a passage of prose and return source
   * keys and evidence. The editor layer chooses the LaTeX citation command.
   */
  recommendCitations: (passage: string) => Promise<string>;
  /** Returns true if the user approved the proposed edit. */
  requestApproval: (proposal: EditProposal) => Promise<boolean>;
}

export interface AgentToolCapabilities {
  hasProject: boolean;
  hasActiveDocument: boolean;
  hasSelection: boolean;
  access: AiAccessConfig;
}

export const agentToolSchemas: ToolSchema[] = [
  {
    name: "list_files",
    description: "List the relative paths of files in the current LaTeX project.",
    params: {},
    required: [],
  },
  {
    name: "read_file",
    description: "Read the full contents of a file in the project by relative path.",
    params: {
      path: {
        type: "string",
        description: "Relative path, e.g. sections/intro.tex",
      },
    },
    required: ["path"],
  },
  {
    name: "get_selection",
    description:
      "Get the text currently selected in the editor (or note that nothing is selected).",
    params: {},
    required: [],
  },
  {
    name: "get_active_document",
    description: "Get the full text of the file currently open in the editor.",
    params: {},
    required: [],
  },
  {
    name: "edit_selection",
    description:
      "Replace the current editor selection with new LaTeX. Use for rewriting, fixing, or translating the selected passage.",
    params: {
      new_text: {
        type: "string",
        description: "Replacement LaTeX for the selection.",
      },
      explanation: {
        type: "string",
        description: "One short sentence describing the change for the user.",
      },
    },
    required: ["new_text"],
  },
  {
    name: "insert_at_cursor",
    description:
      "Insert LaTeX at the current cursor position (e.g. a generated table, figure, or paragraph).",
    params: {
      text: { type: "string", description: "LaTeX to insert." },
      explanation: {
        type: "string",
        description: "Short description of the insertion.",
      },
    },
    required: ["text"],
  },
  {
    name: "write_file",
    description:
      "Overwrite a whole file with new contents. Prefer edit_selection for small changes.",
    params: {
      path: { type: "string", description: "Relative path to write." },
      content: { type: "string", description: "Full new file contents." },
      explanation: {
        type: "string",
        description: "Short description of the change.",
      },
    },
    required: ["path", "content"],
  },
  {
    name: "compile",
    description:
      "Compile the project to PDF and return whether it succeeded plus any error diagnostics. Use this to verify your edits.",
    params: {},
    required: [],
  },
  {
    name: "run_checks",
    description: "Run LatexDo's built-in checkers and return their findings as text.",
    params: {
      kind: {
        type: "string",
        description: "Which checker to run.",
        enum: [
          "conference",
          "citations",
          "structure",
          "reproducibility",
          "acronyms",
          "notation",
          "pdf-compliance",
        ],
      },
    },
    required: ["kind"],
  },
  {
    name: "insert_citation",
    description:
      "Search the project bibliography for a real reference matching a query. Returns bibliography keys and metadata; citation LaTeX syntax is chosen separately from the user's document style.",
    params: {
      query: {
        type: "string",
        description: "Author, title words, or topic to match.",
      },
    },
    required: ["query"],
  },
  {
    name: "recommend_citations",
    description:
      "Given paper prose, rank real references from the project's bibliography. Returns bibliography keys and relevance evidence only. Citation LaTeX syntax is chosen separately from the user's document style.",
    params: {
      passage: {
        type: "string",
        description:
          "The exact sentence or paragraph needing support. Pass actual prose.",
      },
    },
    required: ["passage"],
  },
];

const mutatingToolNames = new Set(["edit_selection", "insert_at_cursor", "write_file"]);

export function isMutatingAgentTool(name: string): boolean {
  return mutatingToolNames.has(name);
}

export function availableAgentToolSchemas(caps: AgentToolCapabilities): ToolSchema[] {
  if (!caps.hasProject) return [];
  return agentToolSchemas.filter((tool) => {
    switch (tool.name) {
      case "list_files":
      case "read_file":
      case "write_file":
      case "compile":
      case "run_checks":
        return caps.hasProject && caps.access.projectFiles;
      case "insert_citation":
      case "recommend_citations":
        return caps.hasProject && caps.access.bibliography;
      case "get_selection":
        return caps.hasActiveDocument && caps.access.currentEditor;
      case "get_active_document":
      case "insert_at_cursor":
        return caps.hasActiveDocument && caps.access.currentEditor;
      case "edit_selection":
        return caps.hasActiveDocument && caps.hasSelection && caps.access.currentEditor;
      default:
        return false;
    }
  });
}

export function unavailableToolMessage(
  toolName: string,
  caps: AgentToolCapabilities,
): string {
  if (!caps.hasProject) {
    return "No LatexDo project is open, so I do not have project tools for that action. Open or create a project first, then I can inspect files or propose edits.";
  }
  if (
    (toolName === "list_files" ||
      toolName === "read_file" ||
      toolName === "write_file" ||
      toolName === "compile" ||
      toolName === "run_checks") &&
    !caps.access.projectFiles
  ) {
    return "Project file tools are disabled in AI settings. Enable Project files access before asking me to inspect, compile, or write project files.";
  }
  if (
    (toolName === "get_selection" ||
      toolName === "get_active_document" ||
      toolName === "edit_selection" ||
      toolName === "insert_at_cursor") &&
    !caps.access.currentEditor
  ) {
    return "Current editor tools are disabled in AI settings. Enable Current editor access before asking me to inspect or edit the open document.";
  }
  if (
    (toolName === "insert_citation" || toolName === "recommend_citations") &&
    !caps.access.bibliography
  ) {
    return "Bibliography tools are disabled in AI settings. Enable Bibliography and citations access before asking me to inspect references.";
  }
  if (!caps.hasActiveDocument) {
    return "No document is open, so I do not have editor tools for that action. Open a document first, or tell me which project file to inspect.";
  }
  if (toolName === "edit_selection" && !caps.hasSelection) {
    return "No text is selected, so I cannot replace a selection yet. Select the text to change, or tell me the file and exact change you want.";
  }
  return `The ${toolName} tool is not available for this request. I can continue in chat, or you can enable the needed project/editor access in AI settings.`;
}

function ok(content: string, ui?: unknown): ToolResult {
  return { ok: true, content, ui };
}
function fail(content: string): ToolResult {
  return { ok: false, content };
}

function argStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

function toolFailureMessage(name: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no (?:latexdo )?project (?:is )?open/i.test(message)) {
    return "No LatexDo project is open. Ask the user to open or create a project before using project tools.";
  }
  if (/access is disabled in AI settings/i.test(message)) {
    return message;
  }
  if (/no document is open/i.test(message)) {
    return "No document is open. Ask the user to open a document before using editor tools.";
  }
  return `The ${name} tool could not complete: ${message}`;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
  opts: { autoApprove: boolean },
): Promise<ToolResult> {
  void opts;
  try {
    switch (name) {
      case "list_files": {
        const files = await ctx.listFiles();
        return ok(files.length ? files.join("\n") : "(no files)");
      }
      case "read_file": {
        const path = argStr(args, "path");
        if (!path) return fail("Missing 'path'.");
        const content = await ctx.readFile(path);
        return ok(content);
      }
      case "get_selection": {
        const sel = ctx.selection();
        return sel.hasSelection ? ok(sel.text) : ok("(nothing selected)");
      }
      case "get_active_document": {
        const path = ctx.activeFilePath();
        if (!path)
          return ok("No document is open. Ask the user to open a document first.");
        return ok(ctx.documentText());
      }
      case "edit_selection": {
        const sel = ctx.selection();
        if (!sel.hasSelection) {
          return ok("No selection to edit. Ask the user to select text first.");
        }
        const path = ctx.activeFilePath();
        if (!path)
          return ok("No document is open. Ask the user to open a document first.");
        const proposal: EditProposal = {
          path,
          kind: "replace-selection",
          newText: argStr(args, "new_text"),
          oldText: sel.text,
        };
        if (!(await ctx.requestApproval(proposal))) {
          return ok("The user declined this edit.");
        }
        await ctx.applyEdit(proposal);
        return ok("Selection replaced.");
      }
      case "insert_at_cursor": {
        const path = ctx.activeFilePath();
        if (!path)
          return ok("No document is open. Ask the user to open a document first.");
        const proposal: EditProposal = {
          path,
          kind: "insert-at-cursor",
          newText: argStr(args, "text"),
        };
        if (!(await ctx.requestApproval(proposal))) {
          return ok("The user declined this insertion.");
        }
        await ctx.applyEdit(proposal);
        return ok("Inserted at cursor.");
      }
      case "write_file": {
        const path = argStr(args, "path");
        const content = argStr(args, "content");
        if (!path) return fail("Missing 'path'.");
        let oldText = "";
        try {
          oldText = await ctx.readFile(path);
        } catch {
          /* new file */
        }
        const proposal: EditProposal = {
          path,
          kind: "replace-file",
          newText: content,
          oldText,
        };
        if (!(await ctx.requestApproval(proposal))) {
          return ok("The user declined this write.");
        }
        await ctx.writeFile(path, content);
        return ok(`Wrote ${path}.`);
      }
      case "compile": {
        const result = await ctx.compile();
        if (result.ok) return ok("Compiled successfully. No errors.");
        const diag = result.diagnostics.slice(0, 20).join("\n");
        return ok(
          `Compilation FAILED.\nDiagnostics:\n${diag || "(none parsed)"}\n\nLog tail:\n${result.log.slice(-1500)}`,
        );
      }
      case "run_checks": {
        const kind = argStr(args, "kind");
        if (!kind) return fail("Missing 'kind'.");
        const report = await ctx.runChecks(kind);
        return ok(report || "No issues found.");
      }
      case "insert_citation": {
        const query = argStr(args, "query");
        if (!query) return fail("Missing 'query'.");
        const key = await ctx.insertCitation(query);
        return ok(key);
      }
      case "recommend_citations": {
        const passage = argStr(args, "passage");
        if (!passage.trim()) return fail("Missing 'passage'.");
        const report = await ctx.recommendCitations(passage);
        return ok(report);
      }
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(toolFailureMessage(name, error));
  }
}
