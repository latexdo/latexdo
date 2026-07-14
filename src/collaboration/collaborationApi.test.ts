import { describe, expect, it } from "vitest";
import { collaborationWebSocketUrl } from "./collaborationApi";
import type { CollaborationRoomOptions } from "./collaborationTypes";

function roomOptions(
  overrides: Partial<CollaborationRoomOptions> = {},
): CollaborationRoomOptions {
  return {
    apiBaseUrl: "https://collaborations.latexdo.org",
    projectId: "project 1",
    relativePath: "main.tex",
    sessionId: "session-1",
    clientId: "client-1",
    clientName: "Ada Lovelace",
    color: "#2f6fdb",
    ...overrides,
  };
}

describe("collaborationWebSocketUrl", () => {
  it("connects HTTPS collaboration API URLs over WSS", () => {
    const url = new URL(
      collaborationWebSocketUrl(
        roomOptions({ apiBaseUrl: "https://collaborations.latexdo.org" }),
      ),
    );

    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("collaborations.latexdo.org");
    expect(url.pathname).toBe("/api/projects/project%201/files/collaborate");
    expect(url.searchParams.get("path")).toBe("main.tex");
    expect(url.searchParams.get("session")).toBe("session-1");
    expect(url.searchParams.get("clientId")).toBe("client-1");
    expect(url.searchParams.get("name")).toBe("Ada Lovelace");
  });

  it("connects HTTP development API URLs over WS", () => {
    const url = new URL(
      collaborationWebSocketUrl(roomOptions({ apiBaseUrl: "http://127.0.0.1:8787" })),
    );

    expect(url.protocol).toBe("ws:");
    expect(url.host).toBe("127.0.0.1:8787");
  });

  it("falls back to the collaboration backend for empty or malformed API URLs", () => {
    for (const apiBaseUrl of ["", "not a url", "ftp://example.com"]) {
      const url = new URL(collaborationWebSocketUrl(roomOptions({ apiBaseUrl })));

      expect(url.protocol).toBe("wss:");
      expect(url.host).toBe("collaborations.latexdo.org");
    }
  });
});
