// Local GGUF model storage: list, download (with progress), delete.
// Files live under <userData>/models. Downloads are resumable-safe in the sense
// that a partial file is written to a .part path and renamed only on success.

import { app } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export interface ModelFileStatus {
  fileName: string;
  path: string;
  sizeBytes: number;
}

export function modelsDir(): string {
  return path.join(app.getPath("userData"), "models");
}

export function modelPath(fileName: string): string {
  // Guard against path traversal from renderer-supplied names.
  const safe = path.basename(fileName);
  return path.join(modelsDir(), safe);
}

export async function listModelFiles(): Promise<ModelFileStatus[]> {
  const dir = modelsDir();
  try {
    await mkdir(dir, { recursive: true });
    const names = await readdir(dir);
    const out: ModelFileStatus[] = [];
    for (const name of names) {
      if (!name.endsWith(".gguf")) continue;
      const full = path.join(dir, name);
      const info = await stat(full);
      out.push({ fileName: name, path: full, sizeBytes: info.size });
    }
    return out;
  } catch {
    return [];
  }
}

export async function modelExists(fileName: string): Promise<boolean> {
  try {
    const info = await stat(modelPath(fileName));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function deleteModelFile(fileName: string): Promise<void> {
  try {
    await unlink(modelPath(fileName));
  } catch {
    /* already gone */
  }
}

export interface DownloadEvents {
  onProgress: (received: number, total: number | null) => void;
  signal?: AbortSignal;
}

export async function downloadModelFile(
  url: string,
  fileName: string,
  events: DownloadEvents,
): Promise<void> {
  await mkdir(modelsDir(), { recursive: true });
  const finalPath = modelPath(fileName);
  const partPath = `${finalPath}.part`;

  const res = await fetch(url, { redirect: "follow", signal: events.signal });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : null;

  let received = 0;
  const nodeBody = Readable.fromWeb(res.body as unknown as NodeReadableStream);
  nodeBody.on("data", (chunk: Buffer) => {
    received += chunk.length;
    events.onProgress(received, Number.isFinite(total) ? total : null);
  });

  try {
    await pipeline(nodeBody, createWriteStream(partPath));
  } catch (error) {
    await unlink(partPath).catch(() => {});
    throw error;
  }
  await rename(partPath, finalPath);
}
