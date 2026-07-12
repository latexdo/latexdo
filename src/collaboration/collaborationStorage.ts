import type { CollaborationIdentity } from "./collaborationTypes";

const cloudSessionKey = "latexdo.cloud.session";
const cloudClientKey = "latexdo.cloud.client";
const cloudClientNameKey = "latexdo.cloud.clientName";
const cloudClientColorKey = "latexdo.cloud.clientColor";
const cloudShareTokensKey = "latexdo.cloud.shareTokens";

const collaboratorColors = [
  "#2f6fdb",
  "#1d7a56",
  "#a65f1b",
  "#8b4aa6",
  "#b42318",
  "#0f766e",
  "#6d5dfc",
  "#b45309",
];

function randomId(prefix: string): string {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}-${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function readOrCreate(key: string, create: () => string): string {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = create();
  window.localStorage.setItem(key, created);
  return created;
}

function storedClientName(): string {
  return (window.localStorage.getItem(cloudClientNameKey) ?? "").trim().slice(0, 80);
}

function colorFromClientId(clientId: string): string {
  let hash = 0;
  for (let index = 0; index < clientId.length; index += 1) {
    hash = (hash * 31 + clientId.charCodeAt(index)) >>> 0;
  }
  return collaboratorColors[hash % collaboratorColors.length];
}

export function collaborationIdentity(): CollaborationIdentity {
  const sessionId = readOrCreate(cloudSessionKey, () => randomId("session"));
  const clientId = readOrCreate(cloudClientKey, () => randomId("client"));
  const clientName = storedClientName();
  const color = readOrCreate(cloudClientColorKey, () => colorFromClientId(clientId));
  return { sessionId, clientId, clientName, color };
}

export function shareTokens(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(cloudShareTokensKey) ?? "{}",
    ) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function shareTokenForProject(projectId: string): string | undefined {
  return shareTokens()[projectId];
}

export function rememberShareToken(projectId: string, token: string): void {
  window.localStorage.setItem(
    cloudShareTokensKey,
    JSON.stringify({ ...shareTokens(), [projectId]: token }),
  );
}
