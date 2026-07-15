import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudLatexDoApi } from "./cloudApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installStoredSession(): void {
  window.localStorage.setItem("latexdo.cloud.sessionToken", "signed-token");
  window.localStorage.setItem("latexdo.cloud.session", "session-1");
  window.localStorage.setItem("latexdo.cloud.client", "client-1");
  window.localStorage.setItem(
    "latexdo.cloud.sessionExpiresAt",
    String(Date.now() + 60 * 60_000),
  );
}

function installFilePicker(
  fileName: string,
  bytes: Uint8Array,
  declaredSize = bytes.byteLength,
) {
  const file = {
    name: fileName,
    size: declaredSize,
    arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from(bytes).buffer),
  } as unknown as File;
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    Object.defineProperty(this, "files", {
      configurable: true,
      value: { 0: file, length: 1, item: () => file },
    });
    this.dispatchEvent(new Event("change"));
  });
  return file;
}

describe("cloud API request policies", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    installStoredSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries a transient GET response with a bounded policy", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const api = createCloudLatexDoApi();

    const result = api.listProject("project-1");
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer signed-token");
  });

  it("does not retry a non-idempotent POST", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "busy" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const api = createCloudLatexDoApi();

    await expect(api.createProject()).rejects.toThrow("busy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renews a rejected session once before replaying the request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/api/sessions") {
        return jsonResponse({
          token: "renewed-token",
          refreshToken: "refresh-token-2",
          sessionId: "session-1",
          clientId: "client-2",
          expiresAt: Date.now() + 60 * 60_000,
        });
      }
      const headers = new Headers(init?.headers);
      if (headers.get("authorization") === "Bearer signed-token") {
        return jsonResponse({ error: "expired" }, 401);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createCloudLatexDoApi();

    await expect(api.listProject("project-1")).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const replayHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(replayHeaders.get("authorization")).toBe("Bearer renewed-token");
  });

  it("opens a shared project without putting its capability in the request URL", async () => {
    window.history.replaceState(null, "", "/#share=share-secret");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        project: { id: "project-1", name: "Shared project", rootPath: "" },
        collaboration: {
          enabled: true,
          projectId: "project-1",
          users: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createCloudLatexDoApi();

    await api.openProject();

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(requestUrl.pathname).toBe("/api/shares/open");
    expect(requestUrl.href).not.toContain("share-secret");
    expect(headers.get("x-latexdo-share-token")).toBe("share-secret");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(
      JSON.parse(window.localStorage.getItem("latexdo.cloud.shareTokens") ?? "{}"),
    ).toMatchObject({ "project-1": "share-secret" });
  });

  it("migrates a legacy query share capability and removes it from the URL", async () => {
    window.history.replaceState(null, "", "/?view=editor&share=legacy-secret#tab=pdf");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        project: { id: "project-1", name: "Shared project", rootPath: "" },
        collaboration: { enabled: true, projectId: "project-1", users: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createCloudLatexDoApi().openProject();

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-latexdo-share-token")).toBe("legacy-secret");
    expect(window.location.search).toBe("?view=editor");
    expect(window.location.hash).toBe("#tab=pdf");
  });

  it("reopens the active project from the durable owned-project directory", async () => {
    window.localStorage.setItem("latexdo.cloud.activeProject", "project-active");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        projects: [
          {
            id: "project-active",
            name: "Active paper",
            updatedAt: Date.now(),
          },
          { id: "project-older", name: "Older paper", updatedAt: 1 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createCloudLatexDoApi().openProject()).resolves.toEqual({
      id: "project-active",
      name: "Active paper",
      rootPath: "",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/api/projects");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("imports a DOCX through the authenticated hosted gateway", async () => {
    installFilePicker("paper.docx", new TextEncoder().encode("docx"));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        relativePath: "paper.tex",
        sourcePath: "paper.docx",
        converter: "pandoc",
        warnings: [],
        mediaFiles: ["media/image1.png"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCloudLatexDoApi().importDocx("project-1");

    expect(result).toMatchObject({
      relativePath: "paper.tex",
      assetDirectory: "media",
      mediaFiles: ["media/image1.png"],
    });
    const [input, init] = fetchMock.mock.calls[0];
    expect(new URL(String(input)).pathname).toBe("/api/import/docx");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer signed-token");
    expect(new Headers(init?.headers).get("x-latexdo-project-id")).toBe("project-1");
    expect(JSON.parse(String(init?.body))).toEqual({
      projectId: "project-1",
      fileName: "paper.docx",
      contentBase64: "ZG9jeA==",
    });
  });

  it("rejects an oversized hosted import before reading or sending it", async () => {
    const file = installFilePicker("large.md", new Uint8Array(), 5 * 1024 * 1024 + 1);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createCloudLatexDoApi().importMarkdown("project-1")).rejects.toThrow(
      "limited to 5 MB",
    );
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts requests that exceed their deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createCloudLatexDoApi();

    const result = api.readFile("project-1", "main.tex");
    const rejection = expect(result).rejects.toThrow(
      "Request timed out after 15 seconds",
    );
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight compile by project", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createCloudLatexDoApi();
    const compile = api.compile({
      projectId: "project-1",
      rootFile: "main.tex",
      engine: "pdflatex",
    });
    await Promise.resolve();

    await expect(api.cancelCompile("project-1")).resolves.toBe(true);
    await expect(compile).rejects.toMatchObject({ name: "AbortError" });
    await expect(api.cancelCompile("project-1")).resolves.toBe(false);
  });
});
