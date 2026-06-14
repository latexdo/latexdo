import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import "@xterm/xterm/css/xterm.css";

type TerminalPanelProps = {
  cwd?: string;
};

export function TerminalPanel({ cwd }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<number | null>(null);

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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let removeDataListener: (() => void) | undefined;
    let removeExitListener: (() => void) | undefined;

    window.terminalApi.create({ cwd }).then(({ id }) => {
      terminalIdRef.current = id;

      removeDataListener = window.terminalApi.onData((payload) => {
        if (payload.id === id) {
          terminal.write(payload.data);
        }
      });

      removeExitListener = window.terminalApi.onExit((payload) => {
        if (payload.id === id) {
          terminal.writeln("");
          terminal.writeln(`[process exited with code ${payload.exitCode}]`);
        }
      });

      terminal.onData((data) => {
        window.terminalApi.write(id, data);
      });

      const dimensions = fitAddon.proposeDimensions();
      if (dimensions) {
        window.terminalApi.resize(id, dimensions.cols, dimensions.rows);
      }
    }).catch((err) => {
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
  }, [cwd]);

  return (
    <div className="terminal-panel-shell">
      <div className="terminal-panel-meta">
        <span>Interactive shell</span>
        <span className="terminal-panel-path">{cwd || "No workspace open"}</span>
      </div>
      <div className="terminal-dock" ref={containerRef} />
    </div>
  );
}
