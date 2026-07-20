import { describe, it, expect, vi } from "vitest";
import { parseJsonToolCall, runAgent, type AgentEvent } from "./aiAgent";
import { executeTool, type AgentContext } from "./aiTools";
import type { ChatMessage, GenerationStep, ToolSchema } from "./aiTypes";

function stubContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    projectName: () => "Test",
    activeFilePath: () => "main.tex",
    listFiles: async () => ["main.tex"],
    readFile: async () => "\\documentclass{article}",
    writeFile: async () => {},
    documentText: () => "hello",
    selection: () => ({ text: "world", hasSelection: true }),
    applyEdit: async () => {},
    compile: async () => ({ ok: true, log: "", diagnostics: [] }),
    runChecks: async () => "ok",
    insertCitation: async () => "\\cite{x}",
    requestApproval: async () => true,
    ...overrides,
  };
}

describe("parseJsonToolCall", () => {
  it("extracts a tool call from a JSON protocol reply", () => {
    const call = parseJsonToolCall('{"tool":"read_file","args":{"path":"a.tex"}}');
    expect(call?.name).toBe("read_file");
    expect(call?.args).toEqual({ path: "a.tex" });
  });

  it("returns null for plain prose", () => {
    expect(parseJsonToolCall("Here is your rewritten paragraph.")).toBeNull();
  });
});

describe("runAgent", () => {
  it("executes a tool then finishes on plain text", async () => {
    const steps: GenerationStep[] = [
      {
        type: "tool_calls",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", args: { path: "main.tex" } }],
      },
      { type: "text", content: "Done reading the file." },
    ];
    let i = 0;
    const generate = vi.fn(
      async (
        _m: ChatMessage[],
        _t: ToolSchema[],
        _onToken: (s: string) => void,
      ): Promise<GenerationStep> => steps[i++],
    );

    const readFile = vi.fn(async () => "\\documentclass{article}");
    const events: AgentEvent[] = [];
    await runAgent({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "read main.tex" },
      ],
      ctx: stubContext({ readFile }),
      generate,
      autoApprove: true,
      maxSteps: 6,
      onEvent: (e) => events.push(e),
    });

    expect(readFile).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledTimes(2);
    const done = events.find((e) => e.type === "done");
    expect(done).toEqual({ type: "done", reason: "completed" });
    const finalMsg = events.find((e) => e.type === "assistant-message");
    expect(finalMsg).toMatchObject({ text: "Done reading the file." });
  });

  it("recovers a JSON tool call emitted as plain text", async () => {
    const steps: GenerationStep[] = [
      { type: "text", content: '{"tool":"compile","args":{}}' },
      { type: "text", content: "It compiles." },
    ];
    let i = 0;
    const compile = vi.fn(async () => ({ ok: true, log: "", diagnostics: [] }));
    await runAgent({
      messages: [{ role: "user", content: "does it build?" }],
      ctx: stubContext({ compile }),
      generate: async () => steps[i++],
      autoApprove: true,
      maxSteps: 6,
      onEvent: () => {},
    });
    expect(compile).toHaveBeenCalledOnce();
  });

  it("stops at the step budget", async () => {
    const events: AgentEvent[] = [];
    await runAgent({
      messages: [{ role: "user", content: "loop" }],
      ctx: stubContext(),
      // Always asks for a tool, never finishes.
      generate: async () => ({
        type: "tool_calls",
        content: "",
        toolCalls: [{ id: "c", name: "list_files", args: {} }],
      }),
      autoApprove: true,
      maxSteps: 3,
      onEvent: (e) => events.push(e),
    });
    expect(events.filter((e) => e.type === "step")).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: "done", reason: "max-steps" });
  });
});

describe("step-by-step approval", () => {
  const proposalCtx = (
    approve: boolean,
    applyEdit: () => Promise<void>,
  ): AgentContext => ({
    projectName: () => "Test",
    activeFilePath: () => "main.tex",
    listFiles: async () => [],
    readFile: async () => "old",
    writeFile: async () => {},
    documentText: () => "doc",
    selection: () => ({ text: "old", hasSelection: true }),
    applyEdit,
    compile: async () => ({ ok: true, log: "", diagnostics: [] }),
    runChecks: async () => "",
    insertCitation: async () => "",
    requestApproval: async () => approve,
  });

  it("applies the edit when approved (ask mode)", async () => {
    const applyEdit = vi.fn(async () => {});
    const result = await executeTool(
      "edit_selection",
      { new_text: "new" },
      proposalCtx(true, applyEdit),
      { autoApprove: false },
    );
    expect(applyEdit).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it("does NOT apply the edit when declined (ask mode)", async () => {
    const applyEdit = vi.fn(async () => {});
    const result = await executeTool(
      "edit_selection",
      { new_text: "new" },
      proposalCtx(false, applyEdit),
      { autoApprove: false },
    );
    expect(applyEdit).not.toHaveBeenCalled();
    expect(result.content).toMatch(/declined/i);
  });

  it("skips the approval prompt entirely in autonomous mode", async () => {
    const requestApproval = vi.fn(async () => true);
    const applyEdit = vi.fn(async () => {});
    await executeTool(
      "edit_selection",
      { new_text: "new" },
      { ...proposalCtx(true, applyEdit), requestApproval },
      { autoApprove: true },
    );
    expect(requestApproval).not.toHaveBeenCalled();
    expect(applyEdit).toHaveBeenCalledOnce();
  });
});
