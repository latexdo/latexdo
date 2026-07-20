// Tool definitions + dispatcher for the AI agent.
//
// Tools are what make this an *integrated* agent rather than a chat box: the
// model reads and edits the LaTeX, compiles, reads diagnostics, and calls the
// existing rule-based checkers. Tool implementations are injected via
// AgentContext so this module stays decoupled from App internals and testable.

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
  /** Returns true if the user approved the edit (bypassed when auto-approve). */
  requestApproval: (proposal: EditProposal) => Promise<boolean>;
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
      path: { type: "string", description: "Relative path, e.g. sections/intro.tex" },
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
      new_text: { type: "string", description: "Replacement LaTeX for the selection." },
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
      explanation: { type: "string", description: "Short description of the change." },
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
      "Search the project bibliography for a reference matching a query and return a \\cite-ready key.",
    params: {
      query: { type: "string", description: "Author, title words, or topic to match." },
    },
    required: ["query"],
  },
];

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

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
  opts: { autoApprove: boolean },
): Promise<ToolResult> {
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
        if (!path) return fail("No document is open.");
        return ok(ctx.documentText());
      }
      case "edit_selection": {
        const sel = ctx.selection();
        if (!sel.hasSelection) {
          return fail("No selection to edit. Ask the user to select text first.");
        }
        const path = ctx.activeFilePath();
        if (!path) return fail("No document is open.");
        const proposal: EditProposal = {
          path,
          kind: "replace-selection",
          newText: argStr(args, "new_text"),
          oldText: sel.text,
        };
        if (!opts.autoApprove && !(await ctx.requestApproval(proposal))) {
          return ok("The user declined this edit.");
        }
        await ctx.applyEdit(proposal);
        return ok("Selection replaced.");
      }
      case "insert_at_cursor": {
        const path = ctx.activeFilePath();
        if (!path) return fail("No document is open.");
        const proposal: EditProposal = {
          path,
          kind: "insert-at-cursor",
          newText: argStr(args, "text"),
        };
        if (!opts.autoApprove && !(await ctx.requestApproval(proposal))) {
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
        if (!opts.autoApprove && !(await ctx.requestApproval(proposal))) {
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
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(
      `Tool '${name}' threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
