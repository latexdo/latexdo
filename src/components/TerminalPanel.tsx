import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Clipboard,
  Copy,
  Focus,
  Plus,
  RotateCcw,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";

import "@xterm/xterm/css/xterm.css";

type TerminalPanelProps = {
  projectId?: string;
  workspacePath?: string;
  active?: boolean;
};

type TerminalSessionState = "starting" | "ready" | "exited" | "error";

type TerminalSessionMeta = {
  key: string;
  label: string;
  mode: "pty" | "pipe";
  status: string;
  state: TerminalSessionState;
  hasSelection: boolean;
};

type TerminalSessionHandle = {
  clear: () => void;
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  focus: () => void;
  restart: () => void;
};

type TerminalSessionViewProps = {
  sessionKey: string;
  projectId?: string;
  active: boolean;
  onStateChange: (key: string, patch: Partial<TerminalSessionMeta>) => void;
};

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

function defaultTerminalLabel(index: number): string {
  const platform = navigator.platform.toLowerCase();
  const base = platform.includes("win") ? "PowerShell" : "zsh";
  return index === 1 ? base : `${base} ${index}`;
}

function createTerminalSessionMeta(index: number): TerminalSessionMeta {
  return {
    key: `terminal-${index}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    label: defaultTerminalLabel(index),
    mode: "pty",
    status: "Starting shell",
    state: "starting",
    hasSelection: false,
  };
}

const TerminalSessionView = forwardRef<TerminalSessionHandle, TerminalSessionViewProps>(
  function TerminalSessionView({ sessionKey, projectId, active, onStateChange }, ref) {
    const [sessionNonce, setSessionNonce] = useState(0);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const terminalIdRef = useRef<number | null>(null);
    const sessionModeRef = useRef<"pty" | "pipe">("pty");
    const inputBufferRef = useRef("");
    const activeRef = useRef(active);

    useEffect(() => {
      activeRef.current = active;
    }, [active]);

    const patchSession = useCallback(
      (patch: Partial<TerminalSessionMeta>) => {
        onStateChange(sessionKey, patch);
      },
      [onStateChange, sessionKey],
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

    const focusTerminal = useCallback(() => {
      requestAnimationFrame(() => {
        fitAndResize();
        terminalRef.current?.focus();
      });
    }, [fitAndResize]);

    const clearTerminal = useCallback(() => {
      terminalRef.current?.clear();
      focusTerminal();
    }, [focusTerminal]);

    const copySelection = useCallback(async () => {
      const selection = terminalRef.current?.getSelection() ?? "";
      if (!selection) return;

      try {
        await navigator.clipboard.writeText(selection);
        patchSession({ status: "Selection copied" });
      } catch {
        patchSession({ status: "Could not copy selection" });
      } finally {
        focusTerminal();
      }
    }, [focusTerminal, patchSession]);

    const pasteClipboard = useCallback(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          terminalRef.current?.paste(text);
        }
      } catch {
        patchSession({ status: "Could not read clipboard" });
      } finally {
        focusTerminal();
      }
    }, [focusTerminal, patchSession]);

    useImperativeHandle(
      ref,
      () => ({
        clear: clearTerminal,
        copy: copySelection,
        paste: pasteClipboard,
        focus: focusTerminal,
        restart: () => setSessionNonce((current) => current + 1),
      }),
      [clearTerminal, copySelection, focusTerminal, pasteClipboard],
    );

    useEffect(() => {
      if (!containerRef.current) return;

      patchSession({
        mode: "pty",
        state: "starting",
        status: "Starting shell",
        hasSelection: false,
      });

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
        if (activeRef.current) {
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
        patchSession({ hasSelection: Boolean(terminal.getSelection()) });
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
        patchSession({ state: "error", status: "Open a project first" });
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
            patchSession({
              mode,
              state: "ready",
              status: mode === "pty" ? "PTY shell ready" : "Fallback shell ready",
            });

            removeDataListener = window.terminalApi.onData((payload) => {
              if (payload.id === id) {
                terminal.write(payload.data);
              }
            });

            removeExitListener = window.terminalApi.onExit((payload) => {
              if (payload.id === id) {
                inputBufferRef.current = "";
                patchSession({
                  state: "exited",
                  status: `Exited with code ${payload.exitCode}`,
                });
                terminal.writeln("");
                terminal.writeln(`[process exited with code ${payload.exitCode}]`);
              }
            });

            fitAndResize();
          })
          .catch((err) => {
            if (disposed) return;
            patchSession({ state: "error", status: "Failed to start" });
            terminal.writeln("");
            terminal.writeln("[failed to start terminal session]");
            terminal.writeln(err instanceof Error ? err.message : String(err));
            console.error("Failed to create terminal:", err);
          });
      }

      const resizeObserver = new ResizeObserver(() => {
        if (activeRef.current) {
          fitAndResize();
        }
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
    }, [fitAndResize, patchSession, projectId, sessionKey, sessionNonce]);

    useEffect(() => {
      if (!active) return;
      focusTerminal();
    }, [active, focusTerminal]);

    return (
      <div
        className={`terminal-dock ${active ? "active" : "hidden"}`}
        ref={containerRef}
        onMouseDown={focusTerminal}
      />
    );
  },
);

export function TerminalPanel({
  projectId,
  workspacePath,
  active = false,
}: TerminalPanelProps) {
  const sessionCounterRef = useRef(1);
  const [sessions, setSessions] = useState<TerminalSessionMeta[]>(() => [
    createTerminalSessionMeta(1),
  ]);
  const [activeSessionKey, setActiveSessionKey] = useState(() => sessions[0].key);
  const sessionHandlesRef = useRef(new Map<string, TerminalSessionHandle>());
  const projectScopeRef = useRef(`${projectId ?? ""}:${workspacePath ?? ""}`);

  const pathLabel = useMemo(() => compactTerminalPath(workspacePath), [workspacePath]);
  const activeSession = sessions.find((session) => session.key === activeSessionKey);
  const activeHandle = useCallback(
    () => sessionHandlesRef.current.get(activeSessionKey),
    [activeSessionKey],
  );

  useEffect(() => {
    const nextScope = `${projectId ?? ""}:${workspacePath ?? ""}`;
    if (projectScopeRef.current === nextScope) return;

    projectScopeRef.current = nextScope;
    sessionCounterRef.current = 1;
    const initialSession = createTerminalSessionMeta(1);
    setSessions([initialSession]);
    setActiveSessionKey(initialSession.key);
  }, [projectId, workspacePath]);

  const updateSessionState = useCallback(
    (key: string, patch: Partial<TerminalSessionMeta>) => {
      setSessions((current) =>
        current.map((session) =>
          session.key === key ? { ...session, ...patch } : session,
        ),
      );
    },
    [],
  );

  const registerHandle = useCallback(
    (key: string, handle: TerminalSessionHandle | null) => {
      if (handle) {
        sessionHandlesRef.current.set(key, handle);
      } else {
        sessionHandlesRef.current.delete(key);
      }
    },
    [],
  );

  const createSession = useCallback(() => {
    if (!projectId) return;
    const nextIndex = sessionCounterRef.current + 1;
    sessionCounterRef.current = nextIndex;
    const session = createTerminalSessionMeta(nextIndex);
    setSessions((current) => [...current, session]);
    setActiveSessionKey(session.key);
  }, [projectId]);

  const closeSession = useCallback(
    (key: string) => {
      if (sessions.length <= 1) {
        activeHandle()?.restart();
        return;
      }

      setSessions((current) => current.filter((session) => session.key !== key));
      sessionHandlesRef.current.delete(key);
      if (activeSessionKey === key) {
        const currentIndex = sessions.findIndex((session) => session.key === key);
        const nextSession =
          sessions[currentIndex + 1] ?? sessions[currentIndex - 1] ?? sessions[0];
        setActiveSessionKey(nextSession.key);
      }
    },
    [activeHandle, activeSessionKey, sessions],
  );

  return (
    <div className="terminal-panel-shell">
      <div className="terminal-panel-bar">
        <div
          className="terminal-session-tabs"
          role="tablist"
          aria-label="Terminal sessions"
        >
          {sessions.map((session) => {
            const selected = session.key === activeSessionKey;
            const title = `${session.label} · ${pathLabel} · ${session.status}`;
            return (
              <div
                key={session.key}
                className={`terminal-session-tab ${selected ? "active" : ""}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="terminal-session-tab-button"
                  title={title}
                  onClick={() => setActiveSessionKey(session.key)}
                >
                  <TerminalIcon size={13} />
                  <span>{session.label}</span>
                  <span className={`terminal-state-dot state-${session.state}`} />
                </button>
                {sessions.length > 1 ? (
                  <button
                    type="button"
                    className="terminal-session-close"
                    aria-label={`Close ${session.label}`}
                    title={`Close ${session.label}`}
                    onClick={() => closeSession(session.key)}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            className="terminal-icon-action"
            onClick={createSession}
            disabled={!projectId}
            title="New terminal"
            aria-label="New terminal"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="terminal-panel-actions">
          <button
            type="button"
            className="terminal-icon-action"
            onClick={() => void activeHandle()?.copy()}
            disabled={!activeSession?.hasSelection}
            title="Copy selection"
            aria-label="Copy selection"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="terminal-icon-action"
            onClick={() => void activeHandle()?.paste()}
            title="Paste"
            aria-label="Paste"
          >
            <Clipboard size={14} />
          </button>
          <button
            type="button"
            className="terminal-icon-action"
            onClick={() => activeHandle()?.clear()}
            title="Clear terminal"
            aria-label="Clear terminal"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="terminal-icon-action"
            onClick={() => activeHandle()?.focus()}
            title="Focus terminal"
            aria-label="Focus terminal"
          >
            <Focus size={14} />
          </button>
          <button
            type="button"
            className="terminal-icon-action"
            onClick={() => activeHandle()?.restart()}
            title="Restart shell"
            aria-label="Restart shell"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="terminal-stack">
        {sessions.map((session) => (
          <TerminalSessionView
            key={session.key}
            ref={(handle) => registerHandle(session.key, handle)}
            sessionKey={session.key}
            projectId={projectId}
            active={active && session.key === activeSessionKey}
            onStateChange={updateSessionState}
          />
        ))}
      </div>
    </div>
  );
}
