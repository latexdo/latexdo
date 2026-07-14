import { collaborationIdentity, shareTokenForProject } from "./collaborationStorage";
import type { CollaborationRoomOptions } from "./collaborationTypes";

const defaultCollaborationApiBaseUrl = "https://collaborations.latexdo.org";

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
    return url.toString();
  } catch {
    return defaultCollaborationApiBaseUrl;
  }
}

export function collaborationApiBaseUrl(): string {
  return normalizedCollaborationApiBaseUrl(import.meta.env.VITE_LATEXDO_API_BASE_URL);
}

export function collaborationHeaders(shareToken?: string): Record<string, string> {
  const identity = collaborationIdentity();
  return {
    "x-latexdo-session": identity.sessionId,
    "x-latexdo-client": identity.clientId,
    "x-latexdo-client-name": identity.clientName,
    ...(shareToken ? { "x-latexdo-share-token": shareToken } : {}),
  };
}

export function collaborationShareUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(token)}`;
}

export function projectShareToken(
  projectId: string,
  explicitToken?: string,
): string | undefined {
  return explicitToken || shareTokenForProject(projectId);
}

export function collaborationWebSocketUrl(options: CollaborationRoomOptions): string {
  const base = normalizedCollaborationApiBaseUrl(options.apiBaseUrl);
  const url = new URL(
    `/api/projects/${encodeURIComponent(options.projectId)}/files/collaborate`,
    base,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("path", options.relativePath);
  url.searchParams.set("session", options.sessionId);
  url.searchParams.set("clientId", options.clientId);
  url.searchParams.set("name", options.clientName);
  const token = projectShareToken(options.projectId, options.shareToken);
  if (token) {
    url.searchParams.set("share", token);
  }
  return url.toString();
}
