import { ipcMain } from "electron";
import os from "node:os";
import path from "node:path";
import pty from "node-pty";

type TerminalSession = {
  pty: pty.IPty;
};

const terminals = new Map<number, TerminalSession>();
let nextTerminalId = 1;

export function registerTerminalIpc() {
  ipcMain.handle("terminal:create", (event, options?: { cwd?: string }) => {
    const id = nextTerminalId++;

    const shell =
      os.platform() === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "bash";

    const cwd =
      options?.cwd ||
      process.env.HOME ||
      process.cwd();

    const terminalProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    });

    terminals.set(id, { pty: terminalProcess });

    terminalProcess.onData((data) => {
      event.sender.send("terminal:data", { id, data });
    });

    terminalProcess.onExit((res) => {
      const exitCode = (res && (res as any).exitCode) ?? 0;
      event.sender.send("terminal:exit", { id, exitCode });
      terminals.delete(id);
    });

    return { id };
  });

  ipcMain.on("terminal:write", (_event, payload: { id: number; data: string }) => {
    terminals.get(payload.id)?.pty.write(payload.data);
  });

  ipcMain.on(
    "terminal:resize",
    (_event, payload: { id: number; cols: number; rows: number }) => {
      terminals.get(payload.id)?.pty.resize(payload.cols, payload.rows);
    },
  );

  ipcMain.on("terminal:dispose", (_event, payload: { id: number }) => {
    const session = terminals.get(payload.id);
    if (!session) return;

    session.pty.kill();
    terminals.delete(payload.id);
  });
}
