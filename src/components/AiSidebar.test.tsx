import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAiConfig, type AiConfig } from "../features/ai/aiConfig";
import type { AgentContext, EditProposal } from "../features/ai/aiTools";
import type { UiMessage } from "../features/ai/useAiAgent";

const agentMock = vi.hoisted(() => ({
  state: {
    messages: [] as UiMessage[],
    isRunning: false,
    status: "",
    send: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    pendingApproval: null as EditProposal | null,
    resolveApproval: vi.fn(),
  },
}));

vi.mock("../features/ai/useAiAgent", () => ({
  useAiAgent: vi.fn(() => agentMock.state),
}));

import { AiSidebar } from "./AiSidebar";

const ctx: AgentContext = {
  projectName: () => "Paper",
  activeFilePath: () => "main.tex",
  listFiles: vi.fn().mockResolvedValue(["main.tex"]),
  readFile: vi.fn().mockResolvedValue("\\section{Intro}"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  documentText: () => "\\section{Intro}",
  selection: () => ({ text: "Intro", hasSelection: true }),
  applyEdit: vi.fn().mockResolvedValue(undefined),
  compile: vi.fn().mockResolvedValue({ ok: true, log: "", diagnostics: [] }),
  runChecks: vi.fn().mockResolvedValue("ok"),
  insertCitation: vi.fn().mockResolvedValue("\\cite{smith2026}"),
  recommendCitations: vi.fn().mockResolvedValue("1. \\cite{smith2026} (score 0.5)"),
  requestApproval: vi.fn().mockResolvedValue(true),
};

type AiConfigOverrides = Omit<Partial<AiConfig>, "cloud" | "profile"> & {
  cloud?: Partial<AiConfig["cloud"]>;
  profile?: Partial<AiConfig["profile"]>;
};

function makeConfig(overrides: AiConfigOverrides = {}): AiConfig {
  return {
    ...defaultAiConfig,
    ...overrides,
    cloud: {
      ...defaultAiConfig.cloud,
      ...overrides.cloud,
    },
    profile: {
      ...defaultAiConfig.profile,
      ...overrides.profile,
    },
  };
}

function resetAgent(overrides: Partial<typeof agentMock.state> = {}) {
  agentMock.state.messages = [];
  agentMock.state.isRunning = false;
  agentMock.state.status = "";
  agentMock.state.send = vi.fn().mockResolvedValue(undefined);
  agentMock.state.abort = vi.fn();
  agentMock.state.reset = vi.fn();
  agentMock.state.pendingApproval = null;
  agentMock.state.resolveApproval = vi.fn();
  Object.assign(agentMock.state, overrides);
}

function renderSidebar(config = makeConfig(), isDesktop = true) {
  const onOpenSettings = vi.fn();
  const onUpdateConfig = vi.fn();
  render(
    <AiSidebar
      config={config}
      ctx={ctx}
      isDesktop={isDesktop}
      onOpenSettings={onOpenSettings}
      onUpdateConfig={onUpdateConfig}
    />,
  );
  return { onOpenSettings, onUpdateConfig };
}

describe("AiSidebar", () => {
  beforeEach(() => {
    resetAgent();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("shows the empty setup state for unconfigured providers", () => {
    const { onOpenSettings } = renderSidebar(
      makeConfig({ provider: "cloud", cloud: { apiKey: "" } }),
    );

    expect(screen.getByText("Cloud · claude-haiku-4-5")).toBeVisible();
    expect(screen.getByText("AI isn't ready yet.")).toBeVisible();
    expect(screen.getByText("Add your API key in AI settings.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Open AI settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("explains desktop-only local setup in the browser", () => {
    renderSidebar(makeConfig({ provider: "local", modelDownloaded: true }), false);

    expect(screen.getByText("Qwen2.5 Coder 3B")).toBeVisible();
    expect(
      screen.getByText(
        "Local models need the desktop app. Switch to a cloud provider for the browser.",
      ),
    ).toBeVisible();
  });

  it("sends trimmed prompts and toggles autonomous edits", () => {
    const config = makeConfig({
      provider: "ollama",
      ollamaModel: "qwen2.5-coder:3b",
    });
    const { onOpenSettings, onUpdateConfig } = renderSidebar(config);

    expect(screen.getByText("Ollama · qwen2.5-coder:3b")).toBeVisible();
    expect(screen.getByText("Ask me to…")).toBeVisible();

    fireEvent.click(screen.getByTitle("AI settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("New chat"));
    expect(agentMock.state.reset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Ask each step/i }));
    expect(onUpdateConfig).toHaveBeenCalledWith({
      ...config,
      autoApproveEdits: true,
    });

    const input = screen.getByPlaceholderText(/Ask the AI to edit/i);
    fireEvent.change(input, { target: { value: "  Fix the compile errors  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(agentMock.state.send).toHaveBeenCalledWith("Fix the compile errors");
    expect(input).toHaveValue("");
  });

  it("renders activity, running status, abort, and edit approval controls", () => {
    resetAgent({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "I found a problem.",
          activity: [
            { name: "read_file", ok: true, summary: "Read main.tex" },
            { name: "compile", ok: false, summary: "Compile failed" },
          ],
        },
      ],
      isRunning: true,
      status: "Waiting for your approval...",
      pendingApproval: {
        path: "main.tex",
        kind: "replace-selection",
        oldText: "old text",
        newText: "new text",
      },
    });

    renderSidebar(makeConfig({ provider: "local", modelDownloaded: true }));

    expect(screen.getByText("I found a problem.")).toBeVisible();
    expect(screen.getByText("read_file")).toBeVisible();
    expect(screen.getByText("compile")).toBeVisible();
    expect(screen.getByText("Waiting for your approval...")).toBeVisible();
    expect(screen.getByText(/Replace selection/)).toBeVisible();
    expect(screen.getByText("old text")).toBeVisible();
    expect(screen.getByText("new text")).toBeVisible();

    fireEvent.click(screen.getByTitle("Stop"));
    expect(agentMock.state.abort).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /Decline/i }));
    expect(agentMock.state.resolveApproval).toHaveBeenNthCalledWith(1, true);
    expect(agentMock.state.resolveApproval).toHaveBeenNthCalledWith(2, false);
  });
});
