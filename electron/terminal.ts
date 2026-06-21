import { app, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import pty from "node-pty";

type PtySession = {
  kind: "pty";
  process: pty.IPty;
};

type PipeSession = {
  kind: "pipe";
  process: ChildProcessWithoutNullStreams;
};

type TerminalSession = PtySession | PipeSession;

type TerminalProjectRegistry = {
  getProjectRoot: (projectId: string) => string;
};

const terminals = new Map<number, TerminalSession>();
let nextTerminalId = 1;

async function canUseDirectory(target: string | undefined): Promise<boolean> {
  if (!target) return false;

  try {
    const details = await stat(target);
    return details.isDirectory();
  } catch {
    return false;
  }
}

async function pickWorkingDirectory(preferred?: string): Promise<string> {
  const candidates = [
    preferred,
    process.env.HOME,
    app.getPath("home"),
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (await canUseDirectory(candidate)) {
      return candidate!;
    }
  }

  return os.homedir();
}

async function canExecute(filePath: string | undefined): Promise<boolean> {
  if (!filePath) return false;

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pickShell(): Promise<string> {
  if (os.platform() === "win32") {
    return "powershell.exe";
  }

  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ];

  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      return candidate!;
    }
  }

  return "sh";
}

async function pickFallbackShell(): Promise<string> {
  if (os.platform() === "win32") {
    return "powershell.exe";
  }

  const candidates = ["/bin/bash", "/bin/sh"];
  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      return candidate;
    }
  }

  return await pickShell();
}

function buildTerminalEnv(shell: string, cwd: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.TERM = "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";
  env.TERM_PROGRAM = "LatexDo";
  env.CLICOLOR = env.CLICOLOR || "1";
  env.FORCE_COLOR = env.FORCE_COLOR || "1";
  env.HOME = env.HOME || app.getPath("home");
  env.PWD = cwd;
  env.HISTFILE = env.HISTFILE || `${app.getPath("temp")}/latexdo-shell-history`;
  env.ZDOTDIR = env.ZDOTDIR || env.HOME;
  env.BASH_SILENCE_DEPRECATION_WARNING =
    env.BASH_SILENCE_DEPRECATION_WARNING || "1";
  env.LSCOLORS = env.LSCOLORS || "ExGxBxDxCxEgEdxbxgxcxd";
  env.LS_COLORS =
    env.LS_COLORS ||
    "di=1;34:ln=36:so=35:pi=33:ex=1;32:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43";

  if (!env.PS1) {
    const shellName = shell.split("/").pop() ?? "";
    env.PS1 =
      shellName === "zsh"
        ? "%F{75}LatexDo%f %F{108}%~%f %# "
        : "\u001b[38;5;75mLatexDo\u001b[0m \u001b[38;5;108m\\w\u001b[0m \\$ ";
  }

  if (os.platform() !== "win32") {
    env.SHELL = shell;
    env.PATH =
      env.PATH ||
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }

  return env;
}

function shellArgs(shell: string, mode: "pty" | "pipe"): string[] {
  if (os.platform() === "win32") {
    return [];
  }

  const shellName = shell.split("/").pop() ?? shell;
  if (mode === "pty") {
    return ["-l"];
  }

  if (shellName === "bash") {
    return ["--noprofile", "--norc", "-i"];
  }

  if (shellName === "sh") {
    return [];
  }

  return [];
}

function sendTerminalExit(
  sender: Electron.WebContents,
  id: number,
  exitCode: number,
) {
  sender.send("terminal:exit", { id, exitCode });
  terminals.delete(id);
}

export function registerTerminalIpc(projects: TerminalProjectRegistry) {
  ipcMain.handle(
    "terminal:create",
    async (event, options?: { projectId?: string }) => {
      const id = nextTerminalId++;
      const shell = await pickShell();
      const projectRoot = options?.projectId
        ? projects.getProjectRoot(options.projectId)
        : undefined;
      const cwd = await pickWorkingDirectory(projectRoot);
      const env = buildTerminalEnv(shell, cwd);

      try {
        const terminalProcess = pty.spawn(shell, shellArgs(shell, "pty"), {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd,
          env,
        });

        terminals.set(id, { kind: "pty", process: terminalProcess });

        terminalProcess.onData((data) => {
          event.sender.send("terminal:data", { id, data });
        });

        terminalProcess.onExit((res) => {
          const exitCode = (res && (res as any).exitCode) ?? 0;
          sendTerminalExit(event.sender, id, exitCode);
        });
      } catch (error) {
        const fallbackShell = await pickFallbackShell();
        const fallbackEnv = buildTerminalEnv(fallbackShell, cwd);
        const child = spawn(fallbackShell, shellArgs(fallbackShell, "pipe"), {
          cwd,
          env: fallbackEnv,
          stdio: "pipe",
        });

        terminals.set(id, { kind: "pipe", process: child });

        child.stdout.on("data", (data: Buffer) => {
          event.sender.send("terminal:data", {
            id,
            data: data.toString("utf8"),
          });
        });

        child.stderr.on("data", (data: Buffer) => {
          event.sender.send("terminal:data", {
            id,
            data: data.toString("utf8"),
          });
        });

        child.on("exit", (exitCode) => {
          sendTerminalExit(event.sender, id, exitCode ?? 0);
        });

        child.on("error", (childError) => {
          event.sender.send("terminal:data", {
            id,
            data: `[terminal failed to start] ${childError.message}\r\n`,
          });
          sendTerminalExit(event.sender, id, 1);
        });
      }

      return { id, mode: terminals.get(id)?.kind === "pty" ? "pty" : "pipe" };
    },
  );

  ipcMain.on("terminal:write", (_event, payload: { id: number; data: string }) => {
    const session = terminals.get(payload.id);
    if (!session) return;

    if (session.kind === "pty") {
      session.process.write(payload.data);
      return;
    }

    session.process.stdin.write(payload.data);
  });

  ipcMain.on(
    "terminal:resize",
    (_event, payload: { id: number; cols: number; rows: number }) => {
      const session = terminals.get(payload.id);
      if (!session || session.kind !== "pty") return;

      session.process.resize(payload.cols, payload.rows);
    },
  );

  ipcMain.on("terminal:dispose", (_event, payload: { id: number }) => {
    const session = terminals.get(payload.id);
    if (!session) return;

    if (session.kind === "pty") {
      session.process.kill();
    } else {
      session.process.kill();
    }
    terminals.delete(payload.id);
  });
}
