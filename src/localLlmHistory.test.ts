import { describe, expect, it, vi } from "vitest";

// localLlm imports models.js which touches Electron's app paths at call time;
// mock the module so this pure-function test runs under vitest.
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

import { toHistory } from "../electron/ai/localLlm.js";

describe("toHistory (node-llama-cpp chat history mapping)", () => {
  it("maps assistant turns to model items with a response array", () => {
    const { history, lastPrompt } = toHistory([
      { role: "system", content: "sys" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "follow-up" },
    ]);

    // Regression: `{type: "model", text}` crashes node-llama-cpp with
    // "Cannot read properties of undefined (reading 'filter')".
    expect(history).toEqual([
      { type: "user", text: "first question" },
      { type: "model", response: ["first answer"] },
    ]);
    expect(lastPrompt).toBe("follow-up");
  });

  it("merges system messages into the system prompt", () => {
    const { systemPrompt } = toHistory([
      { role: "system", content: "a" },
      { role: "system", content: "b" },
      { role: "user", content: "q" },
    ]);
    expect(systemPrompt).toBe("a\n\nb");
  });

  it("labels tool results as user turns and promotes the last one to the prompt", () => {
    const { history, lastPrompt } = toHistory([
      { role: "user", content: "fix it" },
      { role: "assistant", content: '{"tool":"compile","args":{}}' },
      { role: "tool", content: "Compiled successfully.", name: "compile" },
    ]);

    expect(history).toEqual([
      { type: "user", text: "fix it" },
      { type: "model", response: ['{"tool":"compile","args":{}}'] },
    ]);
    expect(lastPrompt).toBe("Tool compile result:\nCompiled successfully.");
  });

  it("leaves lastPrompt empty when the transcript ends on a model turn", () => {
    const { history, lastPrompt } = toHistory([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
    expect(history).toHaveLength(2);
    expect(lastPrompt).toBe("");
  });
});
