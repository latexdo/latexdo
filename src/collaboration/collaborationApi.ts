import {
  clearCollaborationSessionToken,
  collaborationIdentity,
  shareTokenForProject,
  storeCollaborationSession,
  storedCollaborationSession,
  type StoredCollaborationSession,
} from "./collaborationStorage";
import type { CollaborationRoomOptions } from "./collaborationTypes";

const defaultCollaborationApiBaseUrl = "https://editor.latexdo.org";
const sessionRefreshSkewMs = 5 * 60_000;
const authenticationTimeoutMs = 15_000;
const maxRefreshAttempts = 3;

type SessionResponse = {
  token: string;
  refreshToken: string;
  sessionId: string;
  clientId: string;
  expiresAt: number | string;
};

type WebSocketTicketResponse = {
  ticket: string;
  expiresAt: number | string;
};

export class CollaborationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CollaborationApiError";
  }
}

const sessionRequests = new Map<string, Promise<StoredCollaborationSession>>();

function normalizedCollaborationApiBaseUrl(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    return defaultCollaborationApiBaseUrl;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return defaultCollaborationApiBaseUrl;
    }
    return url.origin;
  } catch {
    return defaultCollaborationApiBaseUrl;
  }
}

function expiresAtMs(value: number | string): number {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= Date.now()) {
    throw new Error("The collaboration session has an invalid expiry.");
  }
  return parsed;
}

function parseSessionResponse(value: SessionResponse): StoredCollaborationSession {
  if (
    !value.token?.trim() ||
    !value.refreshToken?.trim() ||
    !value.sessionId?.trim() ||
    !value.clientId?.trim()
  ) {
    throw new Error("The collaboration session response is incomplete.");
  }
  return {
    token: value.token,
    refreshToken: value.refreshToken,
    sessionId: value.sessionId,
    clientId: value.clientId,
    expiresAt: expiresAtMs(value.expiresAt),
    generation: 0,
  };
}

function refreshRetryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(2_000, seconds * 1_000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(2_000, Math.max(0, date - Date.now()));
    }
  }
  const ceiling = Math.min(2_000, 200 * 2 ** attempt);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

function retryableAuthenticationStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function postJson<T>(
  url: URL,
  body: unknown,
  requestHeaders: Record<string, string> = {},
  retrySafe = false,
): Promise<T> {
  const attempts = retrySafe ? maxRefreshAttempts : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      authenticationTimeoutMs,
    );
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (
          retrySafe &&
          attempt + 1 < attempts &&
          retryableAuthenticationStatus(response.status)
        ) {
          await response.body?.cancel().catch(() => undefined);
          await new Promise((resolve) =>
            window.setTimeout(
              resolve,
              refreshRetryDelayMs(response, attempt),
            ),
          );
          continue;
        }
        let message = `${response.status} ${response.statusText}`;
        try {
          const error = (await response.json()) as { error?: string };
          message = error.error || message;
        } catch {
          // Keep the HTTP status fallback.
        }
        throw new CollaborationApiError(response.status, message);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (
        retrySafe &&
        attempt + 1 < attempts &&
        !(error instanceof CollaborationApiError)
      ) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, refreshRetryDelayMs(null, attempt)),
        );
        continue;
      }
      if (controller.signal.aborted) {
        throw new Error("Collaboration authentication timed out.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw new Error("Collaboration authentication failed after bounded retries.");
}

async function issueSession(apiBaseUrl: string): Promise<StoredCollaborationSession> {
  const response = await postJson<SessionResponse>(
    new URL("/api/sessions", apiBaseUrl),
    {},
  );
  const session = parseSessionResponse(response);
  storeCollaborationSession(session, apiBaseUrl);
  return session;
}

async function refreshSession(
  apiBaseUrl: string,
  refreshToken: string,
): Promise<StoredCollaborationSession> {
  const response = await postJson<SessionResponse>(
    new URL("/api/sessions/refresh", apiBaseUrl),
    { refreshToken },
    {},
    true,
  );
  const session = parseSessionResponse(response);
  storeCollaborationSession(session, apiBaseUrl);
  return session;
}

async function withSessionLock<T>(
  apiBaseUrl: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = window.navigator?.locks;
  if (!locks) return operation();
  return locks.request(
    `latexdo-cloud-session:${encodeURIComponent(apiBaseUrl)}`,
    { mode: "exclusive" },
    operation,
  );
}

export function collaborationApiBaseUrl(): string {
  return normalizedCollaborationApiBaseUrl(import.meta.env.VITE_LATEXDO_API_BASE_URL);
}

export async function collaborationSession(
  requestedApiBaseUrl = collaborationApiBaseUrl(),
): Promise<StoredCollaborationSession> {
  const apiBaseUrl = normalizedCollaborationApiBaseUrl(requestedApiBaseUrl);
  const stored = storedCollaborationSession(apiBaseUrl);
  if (stored?.token && stored.expiresAt - Date.now() > sessionRefreshSkewMs) {
    return stored;
  }
  const existingRequest = sessionRequests.get(apiBaseUrl);
  if (existingRequest) return existingRequest;

  const sessionRequest = withSessionLock(apiBaseUrl, async () => {
    const current = storedCollaborationSession(apiBaseUrl);
    if (
      current?.token &&
      current.expiresAt - Date.now() > sessionRefreshSkewMs
    ) {
      return current;
    }
    if (current?.refreshToken) {
      return refreshSession(apiBaseUrl, current.refreshToken);
    }
    return issueSession(apiBaseUrl);
  });
  sessionRequests.set(apiBaseUrl, sessionRequest);

  try {
    return await sessionRequest;
  } finally {
    if (sessionRequests.get(apiBaseUrl) === sessionRequest) {
      sessionRequests.delete(apiBaseUrl);
    }
  }
}

export async function collaborationHeaders(
  shareToken?: string,
  apiBaseUrl = collaborationApiBaseUrl(),
): Promise<Record<string, string>> {
  const session = await collaborationSession(apiBaseUrl);
  const clientName = collaborationIdentity().clientName;
  return {
    authorization: `Bearer ${session.token}`,
    ...(clientName ? { "x-latexdo-client-name": clientName } : {}),
    ...(shareToken ? { "x-latexdo-share-token": shareToken } : {}),
  };
}

export function collaborationShareUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#share=${encodeURIComponent(token)}`;
}

export function projectShareToken(
  projectId: string,
  explicitToken?: string,
  apiBaseUrl = collaborationApiBaseUrl(),
): string | undefined {
  return explicitToken || shareTokenForProject(projectId, apiBaseUrl);
}

export async function collaborationWebSocketUrl(
  options: CollaborationRoomOptions,
): Promise<string> {
  const base = normalizedCollaborationApiBaseUrl(options.apiBaseUrl);
  const token = projectShareToken(options.projectId, options.shareToken, base);
  const ticketUrl = new URL(
    `/api/projects/${encodeURIComponent(options.projectId)}/ws-tickets`,
    base,
  );
  const requestTicket = async () =>
    postJson<WebSocketTicketResponse>(
      ticketUrl,
      { path: options.relativePath },
      await collaborationHeaders(token, base),
    );
  let response: WebSocketTicketResponse;
  try {
    response = await requestTicket();
  } catch (error) {
    if (!(error instanceof CollaborationApiError) || error.status !== 401) {
      throw error;
    }
    clearCollaborationSessionToken(base);
    response = await requestTicket();
  }
  if (!response.ticket?.trim()) {
    throw new Error("The collaboration WebSocket ticket is missing.");
  }

  const url = new URL(
    `/api/projects/${encodeURIComponent(options.projectId)}/files/collaborate`,
    base,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("path", options.relativePath);
  url.searchParams.set("ticket", response.ticket);
  return url.toString();
}
