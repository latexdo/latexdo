import { User } from "lucide-react";
import type { CollaboratorPresence } from "../types";

export function CollaboratorsList({ users }: { users: CollaboratorPresence[] }) {
  if (!users.length) {
    return (
      <span className="collaborators-empty">
        <User size={13} />
        Waiting for collaborators
      </span>
    );
  }

  return (
    <ul className="collaborators-list">
      {users.map((user) => (
        <li key={user.clientId}>
          <span className="collaborator-avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="collaborator-meta">
            <strong>{user.name}</strong>
            {user.currentFile ? <small>{user.currentFile}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
