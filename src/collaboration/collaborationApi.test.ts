import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collaborationHeaders, collaborationWebSocketUrl } from "./collaborationApi";
import type { CollaborationRoomOptions } from "./collaborationTypes";

function roomOptions(
  overrides: Partial<CollaborationRoomOptions> = {},
): CollaborationRoomOptions {
  return {
    apiBaseUrl: "https://editor.latexdo.org",
    projectId: "project 1",
    relativePath: "main.tex",
    clientName: "Ada Lovelace",
    color: "#2f6fdb",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installSessionAndTicketFetch(ticket = "single-use-ticket") {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/sessions") {
      return jsonResponse({
        token: "signed-session-token",
        refreshToken: "refresh-token-1",
        sessionId: "session-1",
        clientId: "client-1",
        expiresAt: Date.now() + 60 * 60_000,
      });
    }
    if (url.pathname.endsWith("/ws-tickets")) {
      return jsonResponse({ ticket, expiresAt: Date.now() + 60_000 });
    }
    return jsonResponse({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("collaboration authentication and WebSocket URLs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("issues one signed session and reuses it for authenticated headers", async () => {
    const fetchMock = installSessionAndTicketFetch();

    const first = await collaborationHeaders("share-secret");
    const second = await collaborationHeaders();

    expect(first).toMatchObject({
      authorization: "Bearer signed-session-token",
      "x-latexdo-share-token": "share-secret",
    });
    expect(second.authorization).toBe("Bearer signed-session-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sessionRequest = fetchMock.mock.calls[0];
    expect(new URL(String(sessionRequest[0])).pathname).toBe("/api/sessions");
    expect(JSON.parse(String(sessionRequest[1]?.body))).toEqual({});
  });

  it("recovers the same identity with an opaque refresh capability", async () => {
    window.localStorage.setItem("latexdo.cloud.sessionToken", "expired-token");
    window.localStorage.setItem("latexdo.cloud.sessionRefreshToken", "refresh-token-1");
    window.localStorage.setItem("latexdo.cloud.session", "session-1");
    window.localStorage.setItem("latexdo.cloud.client", "client-1");
    window.localStorage.setItem("latexdo.cloud.sessionExpiresAt", "1");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        token: "renewed-token",
        refreshToken: "refresh-token-2",
        sessionId: "session-1",
        clientId: "client-1",
        expiresAt: Date.now() + 60 * 60_000,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(collaborationHeaders()).resolves.toMatchObject({
      authorization: "Bearer renewed-token",
    });

    const [input, init] = fetchMock.mock.calls[0];
    expect(new URL(String(input)).pathname).toBe("/api/sessions/refresh");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      refreshToken: "refresh-token-1",
    });
    const stored = JSON.parse(
      window.localStorage.getItem(
        "latexdo.cloud.session.v2:https%3A%2F%2Feditor.latexdo.org",
      ) ?? "{}",
    ) as { refreshToken?: string };
    expect(stored.refreshToken).toBe("refresh-token-2");
  });

  it("connects through a short-lived ticket without URL capability leakage", async () => {
    const fetchMock = installSessionAndTicketFetch();
    const url = new URL(
      await collaborationWebSocketUrl(roomOptions({ shareToken: "share-secret" })),
    );

    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("editor.latexdo.org");
    expect(url.pathname).toBe("/api/projects/project%201/files/collaborate");
    expect(url.searchParams.get("path")).toBe("main.tex");
    expect(url.searchParams.get("ticket")).toBe("single-use-ticket");
    expect(url.searchParams.has("session")).toBe(false);
    expect(url.searchParams.has("clientId")).toBe(false);
    expect(url.searchParams.has("name")).toBe(false);
    expect(url.searchParams.has("share")).toBe(false);

    const ticketRequest = fetchMock.mock.calls.at(-1);
    const ticketHeaders = new Headers(ticketRequest?.[1]?.headers);
    expect(ticketHeaders.get("authorization")).toBe("Bearer signed-session-token");
    expect(ticketHeaders.get("x-latexdo-share-token")).toBe("share-secret");
    expect(JSON.parse(String(ticketRequest?.[1]?.body))).toEqual({
      path: "main.tex",
    });
  });

  it("connects HTTP development API URLs over WS", async () => {
    installSessionAndTicketFetch();
    const url = new URL(
      await collaborationWebSocketUrl(
        roomOptions({ apiBaseUrl: "http://127.0.0.1:8787" }),
      ),
    );

    expect(url.protocol).toBe("ws:");
    expect(url.host).toBe("127.0.0.1:8787");
  });

  it("falls back to the editor gateway for empty or malformed API URLs", async () => {
    for (const apiBaseUrl of ["", "not a url", "ftp://example.com"]) {
      window.localStorage.clear();
      installSessionAndTicketFetch();
      const url = new URL(await collaborationWebSocketUrl(roomOptions({ apiBaseUrl })));

      expect(url.protocol).toBe("wss:");
      expect(url.host).toBe("editor.latexdo.org");
    }
  });
});
