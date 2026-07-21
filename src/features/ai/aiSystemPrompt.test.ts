import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./aiSystemPrompt";

const baseContext = {
  userName: "Omar",
  projectName: "Paper",
  activeFilePath: "content/conclusion.tex",
  hasSelection: false,
  providerSupportsNativeTools: true,
  researchContext: null,
};

describe("buildSystemPrompt", () => {
  it("tells the agent to use project tools instead of claiming missing access", () => {
    const prompt = buildSystemPrompt(baseContext);

    expect(prompt).toContain("tool access to the user's currently open LaTeX project");
    expect(prompt).toContain("Do not say you lack access");
    expect(prompt).toContain("Do not ask the user to upload, paste, or share files");
    expect(prompt).toContain("list_files");
    expect(prompt).toContain("read_file");
  });

  it("routes publication questions to profile papers or project bibliographies", () => {
    const prompt = buildSystemPrompt(baseContext);

    expect(prompt).toContain("When the user asks about their publications");
    expect(prompt).toContain("provided researcher profile");
    expect(prompt).toContain("inspect the project bibliography");
  });

  it("describes access settings and current-topic behavior", () => {
    const prompt = buildSystemPrompt({
      ...baseContext,
      access: {
        chatHistory: true,
        currentEditor: true,
        projectFiles: false,
        bibliography: true,
        researcherProfile: false,
      },
    });

    expect(prompt).toContain("project files off");
    expect(prompt).toContain("researcher profile off");
    expect(prompt).toContain("When asked about the current discussion");
    expect(prompt).toContain("call get_active_document first");
  });

  it("names disabled settings instead of pretending capability is missing", () => {
    const prompt = buildSystemPrompt(baseContext);

    expect(prompt).toContain("disabled in AI settings");
    expect(prompt).toContain("Otherwise use the available tools");
  });

  it("includes the JSON tool protocol for local plain-chat providers", () => {
    const prompt = buildSystemPrompt({
      ...baseContext,
      providerSupportsNativeTools: false,
    });

    expect(prompt).toContain("TOOL PROTOCOL");
    expect(prompt).toContain('{"tool": "<name>", "args": { ... }}');
  });
});
