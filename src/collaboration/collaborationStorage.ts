import type { CollaborationIdentity } from "./collaborationTypes";

const defaultApiOrigin = "https://editor.latexdo.org";
const cloudClientNameKey = "latexdo.cloud.clientName";
const cloudClientColorKey = "latexdo.cloud.clientColor";
const legacyShareTokensKey = "latexdo.cloud.shareTokens";
const legacySessionKey = "latexdo.cloud.session";
const legacyClientKey = "latexdo.cloud.client";
const legacySessionTokenKey = "latexdo.cloud.sessionToken";
const legacySessionExpiresAtKey = "latexdo.cloud.sessionExpiresAt";
const legacySessionRefreshTokenKey = "latexdo.cloud.sessionRefreshToken";
const sessionSchemaVersion = 1;

export interface StoredCollaborationSession {
  token: string;
  refreshToken: string;
  sessionId: string;
  clientId: string;
  expiresAt: number;
  generation: number;
}

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

function normalizedOrigin(value = defaultApiOrigin): string {
  try {
    return new URL(value).origin;
  } catch {
    return defaultApiOrigin;
  }
}

function sessionBundleKey(apiOrigin: string): string {
  return `latexdo.cloud.session.v2:${encodeURIComponent(normalizedOrigin(apiOrigin))}`;
}

function shareTokenKey(projectId: string, apiOrigin: string): string {
  return `latexdo.cloud.shareToken.v2:${encodeURIComponent(normalizedOrigin(apiOrigin))}:${encodeURIComponent(projectId)}`;
}

function readOrCreate(key: string, create: () => string): string {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = create();
  window.localStorage.setItem(key, created);
  return created;
}

function parseStoredSession(value: string | null): StoredCollaborationSession | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as Partial<StoredCollaborationSession> & {
      schemaVersion?: unknown;
    };
    const token = typeof record.token === "string" ? record.token.trim() : "";
    const refreshToken =
      typeof record.refreshToken === "string" ? record.refreshToken.trim() : "";
    const sessionId =
      typeof record.sessionId === "string" ? record.sessionId.trim() : "";
    const clientId =
      typeof record.clientId === "string" ? record.clientId.trim() : "";
    const expiresAt = Number(record.expiresAt ?? 0);
    const generation = Number(record.generation ?? 0);
    const hasCompleteAccess = Boolean(token && sessionId && clientId);
    if (
      record.schemaVersion !== sessionSchemaVersion ||
      (!refreshToken && !hasCompleteAccess) ||
      !Number.isFinite(expiresAt) ||
      !Number.isSafeInteger(generation) ||
      generation < 0
    ) {
      return null;
    }
    return {
      token,
      refreshToken,
      sessionId,
      clientId,
      expiresAt,
      generation,
    };
  } catch {
    return null;
  }
}

function legacySession(): StoredCollaborationSession | null {
  const token = window.localStorage.getItem(legacySessionTokenKey)?.trim() ?? "";
  const refreshToken =
    window.localStorage.getItem(legacySessionRefreshTokenKey)?.trim() ?? "";
  const sessionId = window.localStorage.getItem(legacySessionKey)?.trim() ?? "";
  const clientId = window.localStorage.getItem(legacyClientKey)?.trim() ?? "";
  const expiresAt = Number(
    window.localStorage.getItem(legacySessionExpiresAtKey) ?? 0,
  );
  if ((!refreshToken && !(token && sessionId && clientId)) || !Number.isFinite(expiresAt)) {
    return null;
  }
  return { token, refreshToken, sessionId, clientId, expiresAt, generation: 0 };
}

function writeSessionBundle(
  apiOrigin: string,
  session: StoredCollaborationSession,
): StoredCollaborationSession {
  const key = sessionBundleKey(apiOrigin);
  const previous = parseStoredSession(window.localStorage.getItem(key));
  const next: StoredCollaborationSession = {
    ...session,
    generation: Math.max(previous?.generation ?? 0, session.generation ?? 0) + 1,
  };
  const serialized = JSON.stringify({
    schemaVersion: sessionSchemaVersion,
    ...next,
  });
  window.localStorage.setItem(key, serialized);
  if (window.localStorage.getItem(key) !== serialized) {
    throw new Error("The collaboration recovery session could not be persisted.");
  }
  return next;
}

function storedClientName(): string {
  return (window.localStorage.getItem(cloudClientNameKey) ?? "").trim().slice(0, 80);
}

export function collaborationIdentity(): CollaborationIdentity {
  const clientName = storedClientName();
  const color = readOrCreate(cloudClientColorKey, () => {
    const random = new Uint8Array(1);
    crypto.getRandomValues(random);
    return collaboratorColors[random[0] % collaboratorColors.length];
  });
  return { clientName, color };
}

export function storedCollaborationSession(
  apiOrigin = defaultApiOrigin,
): StoredCollaborationSession | null {
  const key = sessionBundleKey(apiOrigin);
  const stored = parseStoredSession(window.localStorage.getItem(key));
  if (stored) return stored;
  const legacy = legacySession();
  if (!legacy) return null;
  return writeSessionBundle(apiOrigin, legacy);
}

export function storeCollaborationSession(
  session: StoredCollaborationSession,
  apiOrigin = defaultApiOrigin,
): void {
  writeSessionBundle(apiOrigin, session);
}

export function clearCollaborationSessionToken(
  apiOrigin = defaultApiOrigin,
): void {
  const stored = storedCollaborationSession(apiOrigin);
  if (!stored) return;
  if (!stored.refreshToken) {
    window.localStorage.removeItem(sessionBundleKey(apiOrigin));
    return;
  }
  writeSessionBundle(apiOrigin, { ...stored, token: "", expiresAt: 0 });
}

export function shareTokenForProject(
  projectId: string,
  apiOrigin = defaultApiOrigin,
): string | undefined {
  const key = shareTokenKey(projectId, apiOrigin);
  const stored = window.localStorage.getItem(key)?.trim();
  if (stored) return stored;
  try {
    const legacy = JSON.parse(
      window.localStorage.getItem(legacyShareTokensKey) ?? "{}",
    ) as Record<string, unknown>;
    const token = typeof legacy[projectId] === "string" ? legacy[projectId].trim() : "";
    if (!token) return undefined;
    window.localStorage.setItem(key, token);
    return token;
  } catch {
    return undefined;
  }
}

export function rememberShareToken(
  projectId: string,
  token: string,
  apiOrigin = defaultApiOrigin,
): void {
  window.localStorage.setItem(shareTokenKey(projectId, apiOrigin), token);
}

export function forgetShareToken(
  projectId: string,
  apiOrigin = defaultApiOrigin,
): void {
  window.localStorage.removeItem(shareTokenKey(projectId, apiOrigin));
}
