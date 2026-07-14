import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { CollaborationConnectionStatus } from "./collaborationTypes";

const messageSync = 0;
const messageAwareness = 1;

type AwarenessChange = {
  added: number[];
  updated: number[];
  removed: number[];
};

export interface LatexDoWebsocketProviderOptions {
  url: string;
  doc: Y.Doc;
  awareness: Awareness;
  onStatusChange?: (status: CollaborationConnectionStatus) => void;
  onSynced?: () => void;
}

export class LatexDoWebsocketProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly url: string;
  private readonly onStatusChange?: (status: CollaborationConnectionStatus) => void;
  private readonly onSynced?: () => void;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private shouldConnect = true;
  private synced = false;

  constructor(options: LatexDoWebsocketProviderOptions) {
    this.url = options.url;
    this.doc = options.doc;
    this.awareness = options.awareness;
    this.onStatusChange = options.onStatusChange;
    this.onSynced = options.onSynced;
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
    this.connect();
  }

  destroy(): void {
    this.shouldConnect = false;
    this.synced = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.doc.off("update", this.handleDocUpdate);
    this.sendAwarenessUpdate([this.doc.clientID]);
    this.socket?.close(1000, "Collaboration closed");
    this.socket = null;
  }

  private connect(): void {
    this.reportStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.socket = null;
      this.synced = false;
      this.reportStatus("error");
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.reportStatus("connected");
      this.sendSyncStep1();
      this.sendAwarenessUpdate([this.doc.clientID]);
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.synced = false;
      this.reportStatus("disconnected");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      this.reportStatus("error");
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect || this.reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(10_000, 750 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private async handleMessage(data: unknown): Promise<void> {
    const buffer =
      data instanceof ArrayBuffer
        ? data
        : data instanceof Blob
          ? await data.arrayBuffer()
          : null;
    if (!buffer || buffer.byteLength === 0) return;

    let decoder: decoding.Decoder;
    let messageType: number;
    try {
      decoder = decoding.createDecoder(new Uint8Array(buffer));
      messageType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (messageType === messageSync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      try {
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      } catch {
        return;
      }
      if (encoding.length(encoder) > 1) {
        this.send(encoding.toUint8Array(encoder));
      }
      if (!this.synced) {
        this.synced = true;
        this.onSynced?.();
      }
      return;
    }

    if (messageType === messageAwareness) {
      try {
        if (!decoding.hasContent(decoder)) return;
        const update = decoding.readVarUint8Array(decoder);
        if (!update.byteLength) return;
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
      } catch {
        return;
      }
    }
  }

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private readonly handleAwarenessUpdate = (
    changes: AwarenessChange,
    origin: unknown,
  ) => {
    if (origin === this) {
      return;
    }
    this.sendAwarenessUpdate([
      ...changes.added,
      ...changes.updated,
      ...changes.removed,
    ]);
  };

  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private sendAwarenessUpdate(clientIds: number[]): void {
    if (!clientIds.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds),
    );
    this.send(encoding.toUint8Array(encoder));
  }

  private send(message: Uint8Array): void {
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }

  private reportStatus(status: CollaborationConnectionStatus): void {
    this.onStatusChange?.(status);
  }
}
