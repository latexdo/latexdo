import { readFile } from "node:fs/promises";
import path from "node:path";

const downloadsUrl = new URL(process.argv[2] ?? "https://latexdo.github.io/downloads/");
const retries = Number(process.env.LATEXDO_VERIFY_RETRIES ?? 24);
const delayMs = Number(process.env.LATEXDO_VERIFY_DELAY_MS ?? 10_000);
const expectedCommit = process.env.GITHUB_SHA ?? "";
const expectedVersion = JSON.parse(
  await readFile(path.join(process.cwd(), "package.json"), "utf8"),
).version;

const requiredIds = new Set(["macos-arm64", "macos-x64", "windows-x64"]);
const sha256Pattern = /^[a-f0-9]{64}$/;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "cache-control": "no-cache",
      "user-agent": `latexdo-deploy-verifier/${expectedVersion}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response;
}

function assertManifest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Manifest is not an object.");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Manifest schemaVersion must be 1.");
  }
  if (value.product !== "LatexDo") {
    throw new Error("Manifest product must be LatexDo.");
  }
  if (value.version !== expectedVersion) {
    throw new Error(
      `Manifest version ${value.version ?? "<missing>"} does not match ${expectedVersion}.`,
    );
  }
  if (expectedCommit && value.commit !== expectedCommit) {
    throw new Error(
      `Manifest commit ${value.commit ?? "<missing>"} does not match ${expectedCommit}.`,
    );
  }
  if (!Array.isArray(value.files)) {
    throw new Error("Manifest files must be an array.");
  }

  const files = value.files;
  const ids = new Set(files.map((file) => file.id));
  for (const id of requiredIds) {
    if (!ids.has(id)) {
      throw new Error(`Manifest is missing ${id}.`);
    }
  }

  for (const file of files) {
    if (typeof file.url !== "string" || !file.url.startsWith("https://")) {
      throw new Error(`Invalid URL for ${file.id}.`);
    }
    if (typeof file.size !== "number" || file.size <= 0) {
      throw new Error(`Invalid size for ${file.id}.`);
    }
    if (typeof file.sha256 !== "string" || !sha256Pattern.test(file.sha256)) {
      throw new Error(`Invalid SHA-256 for ${file.id}.`);
    }
  }

  return files;
}

async function verifyOnce() {
  await fetchOk(downloadsUrl);

  const manifestUrl = new URL("manifest.json", downloadsUrl);
  const manifestResponse = await fetchOk(manifestUrl);
  const files = assertManifest(await manifestResponse.json());

  const checksumsUrl = new URL("SHA256SUMS.txt", downloadsUrl);
  const checksums = await (await fetchOk(checksumsUrl)).text();
  for (const file of files) {
    if (!checksums.includes(file.sha256) || !checksums.includes(file.filename)) {
      throw new Error(`Checksums file does not include ${file.filename}.`);
    }
  }

  await Promise.all(
    files.map(async (file) => {
      const response = await fetchOk(file.url, { method: "HEAD" });
      const length = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(length) && length > 0 && length !== file.size) {
        throw new Error(
          `${file.filename} content-length ${length} does not match manifest size ${file.size}.`,
        );
      }
    }),
  );
}

let lastError = null;
for (let attempt = 1; attempt <= retries; attempt += 1) {
  try {
    await verifyOnce();
    console.log(`Verified deployed downloads at ${downloadsUrl.href}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(
      `Deployment verification attempt ${attempt}/${retries} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (attempt < retries) {
      await sleep(delayMs);
    }
  }
}

throw lastError ?? new Error("Deployment verification failed.");
