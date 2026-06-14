import { access } from "node:fs/promises";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const projectRoot = path.resolve(import.meta.dirname, "..");
const mainOutputPath = path.join(projectRoot, "dist-electron", "main.js");
const viteUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";

let electronProcess = null;
let restartTimer = null;
let stopping = false;

async function waitForFile(filePath) {
  for (;;) {
    try {
      await access(filePath);
      return;
    } catch {
      await delay(250);
    }
  }
}

async function waitForServer(url) {
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until Vite is ready.
    }
    await delay(250);
  }
}

function startElectron() {
  electronProcess = spawn(
    electronBinary,
    ["."],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: viteUrl,
      },
      stdio: "inherit",
    },
  );

  electronProcess.on("exit", () => {
    electronProcess = null;
  });
}

function stopElectron() {
  if (!electronProcess) {
    return;
  }

  const runningProcess = electronProcess;
  electronProcess = null;
  runningProcess.removeAllListeners("exit");
  runningProcess.kill();
}

function scheduleRestart() {
  if (stopping) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    stopElectron();
    startElectron();
  }, 200);
}

async function main() {
  await Promise.all([waitForFile(mainOutputPath), waitForServer(viteUrl)]);
  startElectron();

  watch(path.join(projectRoot, "dist-electron"), { recursive: true }, () => {
    scheduleRestart();
  });
}

function shutdown(signal) {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  stopElectron();
  process.exit(signal === "SIGINT" ? 130 : 0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void main();
