import {
  collaborationClientId,
  collaborationIdentity,
  collaborationSessionId,
  shareTokenForProject,
} from "./collaborationStorage";
import type { CollaborationRoomOptions } from "./collaborationTypes";

const requestedEdition = import.meta.env.VITE_LATEXDO_EDITION;
const proEdition = requestedEdition === "pro" || requestedEdition === "business";
const defaultCollaborationApiBaseUrl = proEdition
  ? "https://teams.latexdo.org"
  : "https://collaborations.latexdo.org";

export class CollaborationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CollaborationApiError";
  }
}

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

function configuredCollaborationApiBaseUrl(): string {
  return normalizedCollaborationApiBaseUrl(import.meta.env.VITE_LATEXDO_API_BASE_URL);
}

const apiHealthProbeTimeoutMs = 5_000;
let resolvedApiBaseUrl: string | null = null;
let apiBaseUrlResolution: Promise<string> | null = null;

async function probeConfiguredApiBaseUrl(): Promise<string> {
  const configured = configuredCollaborationApiBaseUrl();
  if (configured === defaultCollaborationApiBaseUrl) {
    resolvedApiBaseUrl = configured;
    return configured;
  }

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), apiHealthProbeTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${configured}/api/health`, {
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      window.clearTimeout(timer);
    }
    // Anything below 500 means the configured API backend answered for
    // itself; 5xx (for example a worker whose compile container is not
    // provisioned) and network failures fall back to the default backend
    // so the hosted editor keeps working.
    if (response.status < 500) {
      resolvedApiBaseUrl = configured;
      return configured;
    }
  } catch {
    // Unreachable configured backend: use the default one below.
  }

  resolvedApiBaseUrl = defaultCollaborationApiBaseUrl;
  return resolvedApiBaseUrl;
}

export async function resolveCollaborationApiBaseUrl(): Promise<string> {
  if (resolvedApiBaseUrl) {
    return resolvedApiBaseUrl;
  }
  if (!apiBaseUrlResolution) {
    apiBaseUrlResolution = probeConfiguredApiBaseUrl();
  }
  return apiBaseUrlResolution;
}

export function resetCollaborationApiBaseUrlForTests(): void {
  resolvedApiBaseUrl = null;
  apiBaseUrlResolution = null;
}

export function collaborationApiBaseUrl(): string {
  return resolvedApiBaseUrl ?? configuredCollaborationApiBaseUrl();
}

export function collaborationHeaders(shareToken?: string): Record<string, string> {
  const clientName = collaborationIdentity().clientName;
  return {
    "x-latexdo-session": collaborationSessionId(),
    "x-latexdo-client": collaborationClientId(),
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

  const url = new URL(
    `/api/projects/${encodeURIComponent(options.projectId)}/files/collaborate`,
    base,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("path", options.relativePath);
  url.searchParams.set("session", collaborationSessionId());
  url.searchParams.set("clientId", collaborationClientId());
  if (options.clientName) {
    url.searchParams.set("name", options.clientName);
  }
  if (token) {
    url.searchParams.set("share", token);
  }
  return url.toString();
}
