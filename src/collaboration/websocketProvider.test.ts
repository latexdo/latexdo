import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LatexDoWebsocketProvider } from "./websocketProvider";
import type { CollaborationConnectionStatus } from "./collaborationTypes";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  binaryType: BinaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(message: unknown): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close"));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

const originalWebSocket = globalThis.WebSocket;

function installFakeWebSocket(webSocket: typeof WebSocket): void {
  globalThis.WebSocket = webSocket;
}

function syncedState(provider: LatexDoWebsocketProvider): { synced: boolean } {
  return provider as unknown as { synced: boolean };
}

describe("LatexDoWebsocketProvider", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    installFakeWebSocket(FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  it("handles immediate WebSocket construction failures", () => {
    vi.useFakeTimers();
    const statuses: CollaborationConnectionStatus[] = [];
    const ThrowingWebSocket = class {
      constructor() {
        throw new Error("invalid websocket url");
      }
    };
    installFakeWebSocket(ThrowingWebSocket as unknown as typeof WebSocket);

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collaborations.latexdo.org/socket",
      doc,
      awareness,
      onStatusChange: (status) => statuses.push(status),
    });

    expect(statuses).toEqual(["connecting", "error"]);
    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });

  it("resets synced state on close and ignores malformed messages", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new LatexDoWebsocketProvider({
      url: "wss://collaborations.latexdo.org/socket",
      doc,
      awareness,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    syncedState(provider).synced = true;

    expect(() => socket.receive(new ArrayBuffer(0))).not.toThrow();
    expect(() => socket.receive(Uint8Array.of(1).buffer)).not.toThrow();
    socket.close();

    expect(syncedState(provider).synced).toBe(false);
    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });
});
