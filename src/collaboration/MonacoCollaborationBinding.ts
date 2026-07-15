import { MonacoBinding } from "y-monaco";
import * as Y from "yjs";
import { monaco } from "../monaco";
import { CollaborationClient } from "./CollaborationClient";
import type {
  CollaborationConnectionStatus,
  CollaborationRoomOptions,
} from "./collaborationTypes";
import type { CollaboratorPresence } from "../types";

export interface MonacoCollaborationBindingOptions extends CollaborationRoomOptions {
  editor: monaco.editor.IStandaloneCodeEditor;
  onStatusChange?: (status: CollaborationConnectionStatus) => void;
  onConnectionError?: (message: string, status?: number) => void;
  onSynced?: () => void;
  onPresenceChange?: (users: CollaboratorPresence[]) => void;
}

export class MonacoCollaborationBinding {
  readonly key: string;
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly client: CollaborationClient;
  private binding: MonacoBinding | null = null;
  private selectionDisposable: monaco.IDisposable | null = null;
  private disposed = false;

  constructor(options: MonacoCollaborationBindingOptions) {
    this.key = `${options.projectId}:${options.relativePath}:${options.shareToken ?? ""}:${options.clientName}`;
    this.editor = options.editor;
    this.client = new CollaborationClient({
      ...options,
      onSynced: () => {
        this.attach();
        if (!this.disposed) options.onSynced?.();
      },
      onPresenceChange: (users) => {
        if (!this.disposed) options.onPresenceChange?.(users);
      },
    });
  }

  destroy(): void {
    this.disposed = true;
    this.selectionDisposable?.dispose();
    this.selectionDisposable = null;
    this.binding?.destroy();
    this.binding = null;
    this.client.destroy();
  }

  private attach(): void {
    if (this.disposed || this.binding) {
      return;
    }
    const model = this.editor.getModel();
    if (!model) {
      return;
    }

    this.binding = new MonacoBinding(
      this.client.text,
      model,
      new Set([this.editor]),
      this.client.awareness,
    );
    this.selectionDisposable = this.editor.onDidChangeCursorSelection(() => {
      this.updateSelectionAwareness();
    });
    this.updateSelectionAwareness();
  }

  private updateSelectionAwareness(): void {
    const model = this.editor.getModel();
    const selection = this.editor.getSelection();
    if (!model || !selection) {
      return;
    }
    const anchorOffset = model.getOffsetAt({
      lineNumber: selection.selectionStartLineNumber,
      column: selection.selectionStartColumn,
    });
    const headOffset = model.getOffsetAt({
      lineNumber: selection.positionLineNumber,
      column: selection.positionColumn,
    });
    this.client.awareness.setLocalStateField("selection", {
      anchor: Y.createRelativePositionFromTypeIndex(this.client.text, anchorOffset),
      head: Y.createRelativePositionFromTypeIndex(this.client.text, headOffset),
    });
  }
}
