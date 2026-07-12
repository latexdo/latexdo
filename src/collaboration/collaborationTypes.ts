import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

export type CollaborationConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type CollaboratorRole = "admin" | "editor" | "viewer";

export interface CollaborationIdentity {
  sessionId: string;
  clientId: string;
  clientName: string;
  color: string;
}

export interface CollaborationRoomOptions extends CollaborationIdentity {
  apiBaseUrl: string;
  projectId: string;
  relativePath: string;
  shareToken?: string;
}

export interface CollaborationProviderState extends CollaborationIdentity {
  apiBaseUrl: string;
}

export interface CollaborationClientOptions extends CollaborationRoomOptions {
  onStatusChange?: (status: CollaborationConnectionStatus) => void;
  onSynced?: () => void;
}

export interface CollaborationDocument {
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
}
