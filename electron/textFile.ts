import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const NULL_BYTE_PREFIX_SCAN_BYTES = 8192;

interface ReadSafeTextFileOptions {
  maxBytes?: number;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KiB`;
  }
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}

async function hasNullBytePrefix(filePath: string, fileSize: number): Promise<boolean> {
  const bytesToScan = Math.min(fileSize, NULL_BYTE_PREFIX_SCAN_BYTES);
  if (bytesToScan <= 0) {
    return false;
  }

  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToScan);
    const { bytesRead } = await handle.read(buffer, 0, bytesToScan, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

export async function readSafeTextFile(
  projectPath: string,
  filePath: string,
  _relativePath: string,
  options: ReadSafeTextFileOptions = {},
): Promise<string> {
  const [canonicalProjectPath, canonicalFilePath] = await Promise.all([
    realpath(projectPath),
    realpath(filePath),
  ]);
  if (!isInside(canonicalProjectPath, canonicalFilePath)) {
    throw new Error("The requested path is outside the open project.");
  }

  const fileStats = await stat(canonicalFilePath);
  if (!fileStats.isFile()) {
    throw new Error("Only regular text files can be opened.");
  }

  const maxBytes = options.maxBytes ?? MAX_TEXT_FILE_BYTES;
  if (fileStats.size > maxBytes) {
    throw new Error(
      `File is too large. Maximum text file size is ${formatBytes(maxBytes)}.`,
    );
  }

  if (await hasNullBytePrefix(canonicalFilePath, fileStats.size)) {
    throw new Error("File appears to be binary.");
  }

  const buffer = await readFile(canonicalFilePath);
  if (buffer.includes(0)) {
    throw new Error("File appears to be binary.");
  }

  return buffer.toString("utf8");
}
