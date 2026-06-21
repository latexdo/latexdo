import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Clipboard,
  Copy,
  Focus,
  RotateCcw,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";

import "@xterm/xterm/css/xterm.css";

type TerminalPanelProps = {
  projectId?: string;
  workspacePath?: string;
  active?: boolean;
};

type TerminalSessionState = "starting" | "ready" | "exited" | "error";

const terminalFontFamily =
  "'SFMono-Regular', 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace";

const terminalTheme = {
  background: "#0f131a",
  foreground: "#d6deeb",
  cursor: "#d6deeb",
  cursorAccent: "#0f131a",
  selectionBackground: "#2f4f76",
  black: "#1f2430",
  red: "#ff6b7a",
  green: "#7ee787",
  yellow: "#f4c95d",
  blue: "#79a8ff",
  magenta: "#c792ea",
  cyan: "#6bdfff",
  white: "#d6deeb",
  brightBlack: "#5f6b7a",
  brightRed: "#ff8b98",
  brightGreen: "#9ef0a8",
  brightYellow: "#ffe08a",
  brightBlue: "#9ec1ff",
  brightMagenta: "#d7a7ff",
  brightCyan: "#9df0ff",
  brightWhite: "#ffffff",
};

function compactTerminalPath(path?: string): string {
  if (!path) {
    return "No workspace open";
  }

  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) {
    return normalized;
  }

  return `${parts[0]}/.../${parts.slice(-2).join("/")}`;
}

function terminalWorkspaceLabel(path?: string): string {
  if (!path) {
    return "Home shell";
  }

  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

export function TerminalPanel({
  projectId,
  workspacePath,
  active = false,
}: TerminalPanelProps) {
  const [sessionMode, setSessionMode] = useState<"pty" | "pipe">("pty");
  const [sessionStatus, setSessionStatus] = useState("Starting shell");
  const [sessionState, setSessionState] =
    useState<TerminalSessionState>("starting");
  const [hasSelection, setHasSelection] = useState(false);
  const [sessionNonce, setSessionNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<number | null>(null);
  const sessionModeRef = useRef<"pty" | "pipe">("pty");
  const inputBufferRef = useRef("");

  const pathLabel = useMemo(
    () => compactTerminalPath(workspacePath),
    [workspacePath],
  );
  const workspaceLabel = useMemo(
    () => terminalWorkspaceLabel(workspacePath),
    [workspacePath],
  );

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    try {
      fitAddon.fit();
    } catch {
      return;
    }

    const id = terminalIdRef.current;
    const dimensions = fitAddon.proposeDimensions();
    if (id && dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
      window.terminalApi.resize(id, dimensions.cols, dimensions.rows);
    }
  }, []);

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  }, []);

  const copySelection = useCallback(async () => {
    const selection = terminalRef.current?.getSelection() ?? "";
    if (!selection) return;

    try {
      await navigator.clipboard.writeText(selection);
      setSessionStatus("Selection copied");
    } catch {
      setSessionStatus("Could not copy selection");
    } finally {
      terminalRef.current?.focus();
    }
  }, []);

  const pasteClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        terminalRef.current?.paste(text);
      }
    } catch {
      setSessionStatus("Could not read clipboard");
    } finally {
      terminalRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    setSessionMode("pty");
    setSessionState("starting");
    setSessionStatus("Starting shell");
    setHasSelection(false);

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      convertEol: true,
      fontFamily: terminalFontFamily,
      fontSize: 13,
      fontWeight: "400",
      fontWeightBold: "700",
      lineHeight: 1.2,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      scrollback: 10000,
      tabStopWidth: 2,
      theme: terminalTheme,
    });

    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    requestAnimationFrame(() => {
      fitAndResize();
      if (active) {
        terminal.focus();
      }
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let removeDataListener: (() => void) | undefined;
    let removeExitListener: (() => void) | undefined;
    let disposed = false;
    const initialFitTimer = window.setTimeout(fitAndResize, 80);
    const dataDisposable = terminal.onData((data) => {
      const id = terminalIdRef.current;
      if (!id) return;

      if (sessionModeRef.current === "pipe") {
        const chunks = Array.from(data);

        for (const chunk of chunks) {
          if (chunk === "\r") {
            const command = inputBufferRef.current;
            terminal.write("\r\n");
            window.terminalApi.write(id, `${command}\n`);
            inputBufferRef.current = "";
            continue;
          }

          if (chunk === "\u007f") {
            if (inputBufferRef.current.length > 0) {
              inputBufferRef.current = inputBufferRef.current.slice(0, -1);
              terminal.write("\b \b");
            }
            continue;
          }

          if (chunk === "\u0003") {
            inputBufferRef.current = "";
            terminal.write("^C\r\n");
            window.terminalApi.write(id, "\u0003");
            continue;
          }

          if (chunk >= " " && chunk !== "\u007f") {
            inputBufferRef.current += chunk;
            terminal.write(chunk);
          }
        }
        return;
      }

      window.terminalApi.write(id, data);
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      setHasSelection(Boolean(terminal.getSelection()));
    });

    terminal.attachCustomKeyEventHandler((event) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "k") {
        if (event.type === "keydown") {
          terminal.clear();
        }
        return false;
      }
      return true;
    });

    if (!projectId) {
      setSessionState("error");
      setSessionStatus("Open a project first");
      terminal.writeln("[open a project to start a terminal]");
    } else {
      window.terminalApi
        .create({ projectId })
        .then(({ id, mode }) => {
          if (disposed) {
            window.terminalApi.dispose(id);
            return;
          }

          terminalIdRef.current = id;
          sessionModeRef.current = mode;
          setSessionMode(mode);
          setSessionState("ready");
          setSessionStatus(
            mode === "pty" ? "PTY shell ready" : "Fallback shell ready",
          );

          removeDataListener = window.terminalApi.onData((payload) => {
            if (payload.id === id) {
              terminal.write(payload.data);
            }
          });

          removeExitListener = window.terminalApi.onExit((payload) => {
            if (payload.id === id) {
              inputBufferRef.current = "";
              setSessionState("exited");
              setSessionStatus(`Exited with code ${payload.exitCode}`);
              terminal.writeln("");
              terminal.writeln(
                `[process exited with code ${payload.exitCode}]`,
              );
            }
          });

          fitAndResize();
        })
        .catch((err) => {
          if (disposed) return;
          setSessionState("error");
          setSessionStatus("Failed to start");
          terminal.writeln("");
          terminal.writeln("[failed to start terminal session]");
          terminal.writeln(err instanceof Error ? err.message : String(err));
          console.error("Failed to create terminal:", err);
        });
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      window.clearTimeout(initialFitTimer);
      resizeObserver.disconnect();

      removeDataListener?.();
      removeExitListener?.();
      dataDisposable.dispose();
      selectionDisposable.dispose();

      const id = terminalIdRef.current;
      if (id) {
        window.terminalApi.dispose(id);
      }
      terminalIdRef.current = null;

      terminal.dispose();
    };
  }, [fitAndResize, projectId, sessionNonce]);

  useEffect(() => {
    if (!active) return;

    const terminal = terminalRef.current;
    if (!terminal) return;

    requestAnimationFrame(() => {
      fitAndResize();
      terminal.focus();
    });
  }, [active, fitAndResize]);

  return (
    <div className="terminal-panel-shell">
      <div className="terminal-panel-meta">
        <div className="terminal-panel-summary">
          <span className="terminal-title">
            <TerminalIcon size={14} />
            <span>{workspaceLabel}</span>
          </span>
          <span className={`terminal-state-dot state-${sessionState}`} />
          <span className={`terminal-mode-badge mode-${sessionMode}`}>
            {sessionMode === "pty" ? "PTY" : "Shell"}
          </span>
          <span className="terminal-session-status">{sessionStatus}</span>
        </div>
        <div className="terminal-panel-actions">
          <button
            type="button"
            className="terminal-action"
            onClick={() => void copySelection()}
            disabled={!hasSelection}
            title="Copy selection"
          >
            <Copy size={13} />
            <span>Copy</span>
          </button>
          <button
            type="button"
            className="terminal-action"
            onClick={() => void pasteClipboard()}
            title="Paste"
          >
            <Clipboard size={13} />
            <span>Paste</span>
          </button>
          <button
            type="button"
            className="terminal-action"
            onClick={clearTerminal}
            title="Clear terminal"
          >
            <Trash2 size={13} />
            <span>Clear</span>
          </button>
          <button
            type="button"
            className="terminal-action"
            onClick={() => {
              terminalRef.current?.focus();
            }}
            title="Focus terminal"
          >
            <Focus size={13} />
            <span>Focus</span>
          </button>
          <button
            type="button"
            className="terminal-action"
            onClick={() => setSessionNonce((current) => current + 1)}
            title="Restart shell"
          >
            <RotateCcw size={13} />
            <span>Restart</span>
          </button>
        </div>
      </div>
      <div className="terminal-panel-submeta">
        <span className="terminal-panel-path">{pathLabel}</span>
        <span className="terminal-panel-hint">
          {sessionMode === "pty"
            ? "Truecolor PTY, persistent session, 10k lines scrollback"
            : "Fallback shell, press Enter to run commands"}
        </span>
      </div>
      <div
        className="terminal-dock"
        ref={containerRef}
        onMouseDown={() => terminalRef.current?.focus()}
      />
    </div>
  );
}
