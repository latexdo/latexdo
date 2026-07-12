import { Check, Copy, Link, X } from "lucide-react";
import { CollaboratorsList } from "./CollaboratorsList";
import type { CollaborationState } from "../types";

export interface ShareProjectDialogProps {
  open: boolean;
  state: CollaborationState;
  copied: boolean;
  busy: boolean;
  onCopy: () => void;
  onClose: () => void;
}

export function ShareProjectDialog({
  open,
  state,
  copied,
  busy,
  onCopy,
  onClose,
}: ShareProjectDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-panel share-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-project-title"
      >
        <header className="modal-header">
          <h2 id="share-project-title">Share Project</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="share-link-row">
          <Link size={15} />
          <input readOnly value={state.shareUrl ?? ""} aria-label="Share link" />
          <button type="button" onClick={onCopy} disabled={busy || !state.shareUrl}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <CollaboratorsList users={state.users} />
      </section>
    </div>
  );
}
