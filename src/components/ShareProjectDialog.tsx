import {
  Check,
  Copy,
  KeyRound,
  Link,
  LogIn,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";
import { CollaboratorsList } from "./CollaboratorsList";
import { PermissionManagement } from "./PermissionManagement";
import type {
  CollaborationState,
  CollaboratorPermission,
  PermissionUpdate,
} from "../types";

export interface ShareProjectDialogProps {
  open: boolean;
  state: CollaborationState;
  copied: boolean;
  busy: boolean;
  joinToken: string;
  joining: boolean;
  joinError: string;
  displayName: string;
  permissions: CollaboratorPermission[];
  isAdmin: boolean;
  currentUserRole: string;
  onCopy: (value: string) => void;
  onJoinTokenChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onJoin: () => void;
  onRegenerate?: () => void;
  onClose: () => void;
  onUpdatePermission?: (update: PermissionUpdate) => Promise<void>;
  onRemoveCollaborator?: (clientId: string) => Promise<void>;
  onRefreshPermissions?: () => Promise<void>;
}

export function ShareProjectDialog({
  open,
  state,
  copied,
  busy,
  joinToken,
  joining,
  joinError,
  displayName,
  permissions,
  isAdmin,
  currentUserRole,
  onCopy,
  onJoinTokenChange,
  onDisplayNameChange,
  onJoin,
  onRegenerate,
  onClose,
  onUpdatePermission,
  onRemoveCollaborator,
  onRefreshPermissions,
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
          <KeyRound size={15} />
          <input
            readOnly
            value={state.token ?? ""}
            placeholder={busy ? "Generating token..." : "Open a project to generate"}
            aria-label="Collaboration token"
          />
          <button
            type="button"
            onClick={() => state.token && onCopy(state.token)}
            disabled={busy || !state.token}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {isAdmin && onRegenerate && state.token ? (
            <button
              type="button"
              className="share-regenerate-button"
              onClick={onRegenerate}
              disabled={busy}
              title="Generate a new link and invalidate the current one"
            >
              <RefreshCw size={15} />
              Regenerate
            </button>
          ) : null}
        </div>
        <div className="share-name-row">
          <UserRound size={15} />
          <input
            value={displayName}
            placeholder="Anonymous until you enter a name"
            aria-label="Collaboration display name"
            onChange={(event) => onDisplayNameChange(event.target.value)}
            maxLength={80}
          />
        </div>
        <div className="share-link-row">
          <Link size={15} />
          <input
            readOnly
            value={state.shareUrl ?? ""}
            placeholder="Share link"
            aria-label="Share link"
          />
          <button
            type="button"
            onClick={() => state.shareUrl && onCopy(state.shareUrl)}
            disabled={busy || !state.shareUrl}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <form
          className="share-token-form"
          onSubmit={(event) => {
            event.preventDefault();
            onJoin();
          }}
        >
          <div className="share-link-row">
            <LogIn size={15} />
            <input
              value={joinToken}
              placeholder="Paste token or share link"
              aria-label="Join collaboration token"
              onChange={(event) => onJoinTokenChange(event.target.value)}
            />
            <button type="submit" disabled={joining || !joinToken.trim()}>
              {joining ? "Joining..." : "Join"}
            </button>
          </div>
          {joinError ? <div className="share-error">{joinError}</div> : null}
        </form>
        <CollaboratorsList users={state.users} />
        {onUpdatePermission && onRemoveCollaborator && onRefreshPermissions ? (
          <PermissionManagement
            permissions={permissions}
            isAdmin={isAdmin}
            currentUserRole={currentUserRole as "admin" | "editor" | "viewer"}
            onUpdatePermission={onUpdatePermission}
            onRemoveCollaborator={onRemoveCollaborator}
            onRefresh={onRefreshPermissions}
          />
        ) : null}
      </section>
    </div>
  );
}
