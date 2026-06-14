import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import "@xterm/xterm/css/xterm.css";

type TerminalPanelProps = {
  cwd?: string;
  active?: boolean;
};

export function TerminalPanel({ cwd, active = false }: TerminalPanelProps) {
  const [sessionMode, setSessionMode] = useState<"pty" | "pipe">("pty");
  const [sessionStatus, setSessionStatus] = useState("Starting shell…");
  const [sessionNonce, setSessionNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<number | null>(null);
  const sessionModeRef = useRef<"pty" | "pipe">("pty");
  const inputBufferRef = useRef("");

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "monospace",
      fontSize: 13,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
      },
    });

    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.focus();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let removeDataListener: (() => void) | undefined;
    let removeExitListener: (() => void) | undefined;

    window.terminalApi.create({ cwd }).then(({ id, mode }) => {
      terminalIdRef.current = id;
      sessionModeRef.current = mode;
      setSessionMode(mode);
      setSessionStatus(mode === "pty" ? "Shell ready" : "Shell ready");

      removeDataListener = window.terminalApi.onData((payload) => {
        if (payload.id === id) {
          terminal.write(payload.data);
        }
      });

      removeExitListener = window.terminalApi.onExit((payload) => {
        if (payload.id === id) {
          inputBufferRef.current = "";
          setSessionStatus(`Shell exited (${payload.exitCode})`);
          terminal.writeln("");
          terminal.writeln(`[process exited with code ${payload.exitCode}]`);
        }
      });

      terminal.onData((data) => {
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

      const dimensions = fitAddon.proposeDimensions();
      if (dimensions) {
        window.terminalApi.resize(id, dimensions.cols, dimensions.rows);
      }
    }).catch((err) => {
      setSessionStatus("Failed to start");
      terminal.writeln("");
      terminal.writeln("[failed to start terminal session]");
      terminal.writeln(err instanceof Error ? err.message : String(err));
      console.error("Failed to create terminal:", err);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();

      const id = terminalIdRef.current;
      const dimensions = fitAddon.proposeDimensions();

      if (id && dimensions) {
        window.terminalApi.resize(id, dimensions.cols, dimensions.rows);
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();

      removeDataListener?.();
      removeExitListener?.();

      const id = terminalIdRef.current;
      if (id) {
        window.terminalApi.dispose(id);
      }

      terminal.dispose();
    };
  }, [cwd, sessionNonce]);

  useEffect(() => {
    if (!active) return;

    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    requestAnimationFrame(() => {
      fitAddon.fit();
      terminal.focus();

      const id = terminalIdRef.current;
      const dimensions = fitAddon.proposeDimensions();
      if (id && dimensions) {
        window.terminalApi.resize(id, dimensions.cols, dimensions.rows);
      }
    });
  }, [active]);

  return (
    <div className="terminal-panel-shell">
      <div className="terminal-panel-meta">
        <div className="terminal-panel-summary">
          <span>Terminal</span>
          <span className={`terminal-mode-badge mode-${sessionMode}`}>
            {sessionMode === "pty" ? "PTY" : "Shell"}
          </span>
          <span className="terminal-session-status">{sessionStatus}</span>
        </div>
        <div className="terminal-panel-actions">
          <button
            type="button"
            className="terminal-action"
            onClick={() => terminalRef.current?.clear()}
          >
            Clear
          </button>
          <button
            type="button"
            className="terminal-action"
            onClick={() => {
              terminalRef.current?.focus();
            }}
          >
            Focus
          </button>
          <button
            type="button"
            className="terminal-action"
            onClick={() => setSessionNonce((current) => current + 1)}
          >
            Restart
          </button>
        </div>
      </div>
      <div className="terminal-panel-submeta">
        <span className="terminal-panel-path">{cwd || "No workspace open"}</span>
        <span className="terminal-panel-hint">
          {sessionMode === "pty"
            ? "Type commands directly"
            : "Press Enter to run commands"}
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
