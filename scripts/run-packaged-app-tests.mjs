import { access, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const searchRoots = [path.join(root, "release"), path.join(root, "dist")];

async function isExecutable(filePath) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findInDirectory(directory, predicate, depth = 0) {
  if (depth > 8) return null;

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (await predicate(filePath, entry)) {
      return filePath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules") continue;
    const found = await findInDirectory(
      path.join(directory, entry.name),
      predicate,
      depth + 1,
    );
    if (found) return found;
  }

  return null;
}

async function findPackagedExecutable() {
  if (process.env.LATEXDO_PACKAGED_EXECUTABLE) {
    return path.resolve(process.env.LATEXDO_PACKAGED_EXECUTABLE);
  }

  const predicates = {
    darwin: async (filePath) =>
      filePath.endsWith(path.join("LatexDo.app", "Contents", "MacOS", "LatexDo")) &&
      (await isExecutable(filePath)),
    win32: async (_filePath, entry) => entry.isFile() && entry.name === "LatexDo.exe",
    linux: async (_filePath, entry) =>
      entry.isFile() && ["LatexDo", "latexdo"].includes(entry.name),
  };
  const predicate = predicates[process.platform];
  if (!predicate) {
    throw new Error(`Unsupported packaged app test platform: ${process.platform}`);
  }

  for (const searchRoot of searchRoots) {
    const executable = await findInDirectory(searchRoot, predicate);
    if (executable) return executable;
  }

  throw new Error(
    "Could not find a packaged LatexDo executable. Run npm run package first, or set LATEXDO_PACKAGED_EXECUTABLE.",
  );
}

function runPackagedTest(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SANDBOX:
          process.platform === "linux" ? "1" : process.env.ELECTRON_DISABLE_SANDBOX,
      },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${path.basename(executable)} ${args.join(" ")} exited with ${
              code ?? `signal ${signal ?? "unknown"}`
            }.`,
          ),
        );
      }
    });
  });
}

const executable = await findPackagedExecutable();
console.log(`[packaged-test] Using ${executable}`);
await runPackagedTest(executable, ["--smoke-test"]);
await runPackagedTest(executable, ["--e2e-test"]);
console.log("[packaged-test] Smoke and E2E checks passed.");
