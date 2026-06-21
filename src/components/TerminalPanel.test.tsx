import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";

const xtermMocks = vi.hoisted(() => {
  const terminalInstances: any[] = [];
  const fitAddonInstances: any[] = [];

  class MockTerminal {
    dataHandler: ((data: string) => void) | null = null;
    selectionHandler: (() => void) | null = null;
    selection = "";
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    clear = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    paste = vi.fn();
    dispose = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    getSelection = vi.fn(() => this.selection);

    constructor() {
      terminalInstances.push(this);
    }

    onData(callback: (data: string) => void) {
      this.dataHandler = callback;
      return { dispose: vi.fn() };
    }

    onSelectionChange(callback: () => void) {
      this.selectionHandler = callback;
      return { dispose: vi.fn() };
    }

    emitData(data: string) {
      this.dataHandler?.(data);
    }

    emitSelection(selection: string) {
      this.selection = selection;
      this.selectionHandler?.();
    }
  }

  class MockFitAddon {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));

    constructor() {
      fitAddonInstances.push(this);
    }
  }

  return { terminalInstances, fitAddonInstances, MockTerminal, MockFitAddon };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMocks.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: xtermMocks.MockFitAddon,
}));

describe("TerminalPanel", () => {
  let terminalDataCallback:
    | ((payload: { id: number; data: string }) => void)
    | null;
  let terminalExitCallback:
    | ((payload: { id: number; exitCode: number }) => void)
    | null;

  beforeEach(() => {
    terminalDataCallback = null;
    terminalExitCallback = null;
    xtermMocks.terminalInstances.length = 0;
    xtermMocks.fitAddonInstances.length = 0;

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue("pasted command"),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    window.terminalApi = {
      create: vi.fn().mockResolvedValue({ id: 7, mode: "pty" }),
      write: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn((callback) => {
        terminalDataCallback = callback;
        return vi.fn();
      }),
      onExit: vi.fn((callback) => {
        terminalExitCallback = callback;
        return vi.fn();
      }),
    };
  });

  it("does not create a shell without an open project", async () => {
    render(<TerminalPanel active />);

    expect(await screen.findByText("Open a project first")).toBeVisible();
    expect(window.terminalApi.create).not.toHaveBeenCalled();
    expect(xtermMocks.terminalInstances[0].writeln).toHaveBeenCalledWith(
      "[open a project to start a terminal]",
    );
  });

  it("creates, writes to, copies from, and disposes the owned terminal session", async () => {
    const { unmount } = render(
      <TerminalPanel
        projectId="project-1"
        workspacePath="/Users/omar/paper"
        active
      />,
    );

    await waitFor(() => {
      expect(window.terminalApi.create).toHaveBeenCalledWith({
        projectId: "project-1",
      });
    });
    expect(screen.getByText("PTY shell ready")).toBeVisible();
    expect(screen.getByText("paper")).toBeVisible();

    const terminal = xtermMocks.terminalInstances[0];
    act(() => {
      terminal.emitData("ls\n");
    });
    expect(window.terminalApi.write).toHaveBeenCalledWith(7, "ls\n");

    act(() => {
      terminalDataCallback?.({ id: 7, data: "output" });
    });
    expect(terminal.write).toHaveBeenCalledWith("output");

    act(() => {
      terminal.emitSelection("selected output");
    });
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "selected output",
    );

    act(() => {
      terminalExitCallback?.({ id: 7, exitCode: 0 });
    });
    expect(screen.getByText("Exited with code 0")).toBeVisible();

    unmount();
    expect(window.terminalApi.dispose).toHaveBeenCalledWith(7);
  });
});
