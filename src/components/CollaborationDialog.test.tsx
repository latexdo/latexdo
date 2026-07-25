import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollaborationState, CollaboratorPermission } from "../types";
import { CollaborationDialog } from "./CollaborationDialog";
import type { ShareProjectDialogProps } from "./ShareProjectDialog";

const activeState: CollaborationState = {
  enabled: true,
  token: "share-token",
  shareUrl: "https://latexdo.example/share/share-token",
  users: [
    {
      clientId: "client-reviewer",
      name: "Reviewer One",
      currentFile: "reports/main.tex",
      lastSeen: 1,
      role: "editor",
    },
  ],
};

const permissions: CollaboratorPermission[] = [
  {
    clientId: "client-admin",
    name: "Admin User",
    role: "admin",
    isCurrent: true,
  },
  {
    clientId: "client-reviewer",
    name: "Reviewer One",
    role: "editor",
  },
];

function dialogProps(
  overrides: Partial<ShareProjectDialogProps> = {},
): ShareProjectDialogProps {
  return {
    open: true,
    state: activeState,
    copied: false,
    busy: false,
    joinToken: "incoming-token",
    joining: false,
    joinError: "",
    displayName: "Admin User",
    permissions,
    isAdmin: true,
    currentUserRole: "admin",
    onCopy: vi.fn(),
    onJoinTokenChange: vi.fn(),
    onDisplayNameChange: vi.fn(),
    onJoin: vi.fn(),
    onRegenerate: vi.fn(),
    onClose: vi.fn(),
    onUpdatePermission: vi.fn().mockResolvedValue(undefined),
    onRemoveCollaborator: vi.fn().mockResolvedValue(undefined),
    onRefreshPermissions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("CollaborationDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders admin sharing controls and manages collaborator permissions", async () => {
    const props = dialogProps();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<CollaborationDialog {...props} />);

    expect(screen.getByRole("dialog", { name: "Share Project" })).toBeVisible();
    expect(screen.getAllByText("Reviewer One").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("reports/main.tex")).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    expect(props.onCopy).toHaveBeenCalledWith("share-token");

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(props.onRegenerate).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Collaboration display name"), {
      target: { value: "Publisher" },
    });
    expect(props.onDisplayNameChange).toHaveBeenCalledWith("Publisher");

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(props.onJoin).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByDisplayValue("Editor"), {
      target: { value: "viewer" },
    });
    await waitFor(() => {
      expect(props.onUpdatePermission).toHaveBeenCalledWith({
        clientId: "client-reviewer",
        role: "viewer",
      });
    });
    expect(props.onRefreshPermissions).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Remove collaborator"));
    await waitFor(() => {
      expect(props.onRemoveCollaborator).toHaveBeenCalledWith("client-reviewer");
    });
  });

  it("shows empty and non-admin states without collaboration links", () => {
    render(
      <CollaborationDialog
        {...dialogProps({
          state: { enabled: false, users: [] },
          copied: true,
          busy: true,
          joinToken: "",
          joinError: "Invalid token",
          permissions: [],
          isAdmin: false,
          currentUserRole: "viewer",
          onRegenerate: undefined,
        })}
      />,
    );

    expect(screen.getByText("Waiting for collaborators")).toBeVisible();
    expect(screen.getByText("Invalid token")).toBeVisible();
    expect(screen.getByText(/You are a Viewer on this project/i)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Copied" })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });

  it("does not render when closed", () => {
    const { container } = render(
      <CollaborationDialog {...dialogProps({ open: false })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
