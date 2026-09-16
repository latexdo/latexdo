import React from "react";
import {
  UserCircle2,
  X,
  RefreshCw,
  Copy,
  Check,
  Sparkles,
  Loader2,
  BookOpen,
  ExternalLink,
  AlertTriangle,
  Link2,
} from "lucide-react";
import type { ResearcherProfile } from "../features/ai/researcherProfile";
import {
  displayNameWithTitle,
  generateScholarToken,
  providerDisplayNameWithTitle,
  suggestDisplayNameFromProviderUsername,
  tokenCodename,
  type AcademicTitle,
  type ExternalProviderConnection,
  type ExternalProviderId,
} from "../features/ai/researcherProfile";
import { fetchOrcidProfile, isValidOrcid } from "../features/ai/orcid";

interface ProfileDialogProps {
  profile: ResearcherProfile;
  onChange: (profile: ResearcherProfile) => void;
  onClose: () => void;
  onOpenExternal?: (url: string) => void;
  onImportOverleafProject?: (url: string) => Promise<void>;
}

const academicTitleOptions: AcademicTitle[] = ["", "Dr", "Prof", "Prof. Dr", "Mx"];
const externalProviderOptions: {
  id: ExternalProviderId;
  label: string;
  hint: string;
}[] = [
  {
    id: "overleaf",
    label: "Overleaf",
    hint: "Use an Overleaf username and optional Git URL to fetch projects locally.",
  },
  {
    id: "zotero",
    label: "Zotero",
    hint: "Save the local account identity used for bibliography workflows.",
  },
  {
    id: "mendeley",
    label: "Mendeley",
    hint: "Save the local account identity used for reference workflows.",
  },
  {
    id: "readcube",
    label: "ReadCube",
    hint: "Save the local account identity used for paper-library workflows.",
  },
];

function providerLabel(provider: ExternalProviderId): string {
  return (
    externalProviderOptions.find((option) => option.id === provider)?.label ?? provider
  );
}

export const ProfileDialog: React.FC<ProfileDialogProps> = ({
  profile,
  onChange,
  onClose,
  onOpenExternal,
  onImportOverleafProject,
}) => {
  const [orcidInput, setOrcidInput] = React.useState(profile.orcidId);
  const [fetching, setFetching] = React.useState(false);
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [providerDraft, setProviderDraft] = React.useState<{
    provider: ExternalProviderId;
    username: string;
    displayName: string;
    title: AcademicTitle;
    projectFetchUrl: string;
  }>({
    provider: "overleaf",
    username: "",
    displayName: "",
    title: "",
    projectFetchUrl: "",
  });
  const [providerMessage, setProviderMessage] = React.useState("");
  const [importingOverleaf, setImportingOverleaf] = React.useState(false);

  const patch = (part: Partial<ResearcherProfile>) => onChange({ ...profile, ...part });

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const regenerate = () => patch({ token: generateScholarToken() });
  const providerConnections = profile.externalProviders ?? [];

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(profile.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const connectOrcid = async () => {
    setError("");
    if (!isValidOrcid(orcidInput)) {
      setError("Enter a valid ORCID iD, e.g. 0000-0002-1825-0097.");
      return;
    }
    setFetching(true);
    try {
      const result = await fetchOrcidProfile(orcidInput);
      const id = orcidInput.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/)?.[0] ?? orcidInput;
      onChange({
        ...profile,
        mode: "orcid",
        orcidId: id,
        displayName: result.name || profile.displayName,
        papers: result.papers,
        papersFetchedAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach ORCID.");
    } finally {
      setFetching(false);
    }
  };

  const updateProviderDraft = (
    part: Partial<typeof providerDraft>,
    options: { suggestName?: boolean } = {},
  ) => {
    setProviderMessage("");
    setProviderDraft((current) => {
      const next = { ...current, ...part };
      if (options.suggestName) {
        next.displayName = suggestDisplayNameFromProviderUsername(next.username);
      }
      return next;
    });
  };

  const confirmProviderConnection = () => {
    const username = providerDraft.username.trim();
    const displayName =
      providerDraft.displayName.trim() ||
      suggestDisplayNameFromProviderUsername(username) ||
      username;
    if (!username) {
      setProviderMessage("Enter the account username first.");
      return;
    }

    const now = Date.now();
    const connection: ExternalProviderConnection = {
      provider: providerDraft.provider,
      username,
      displayName,
      title: providerDraft.title,
      confirmed: true,
      connectedAt: now,
      updatedAt: now,
      projectFetchUrl:
        providerDraft.provider === "overleaf" && providerDraft.projectFetchUrl.trim()
          ? providerDraft.projectFetchUrl.trim()
          : undefined,
    };
    const nextConnections = [
      ...providerConnections.filter(
        (item) =>
          item.provider !== connection.provider ||
          item.username.toLowerCase() !== connection.username.toLowerCase(),
      ),
      connection,
    ];
    onChange({
      ...profile,
      displayName,
      title: providerDraft.title,
      externalProviders: nextConnections,
    });
    setProviderMessage(
      `${providerLabel(connection.provider)} connected locally as ${providerDisplayNameWithTitle(
        connection,
      )}.`,
    );
  };

  const removeProviderConnection = (connection: ExternalProviderConnection) => {
    patch({
      externalProviders: providerConnections.filter(
        (item) =>
          item.provider !== connection.provider ||
          item.username !== connection.username,
      ),
    });
  };

  const importOverleafProject = async (url: string) => {
    if (!onImportOverleafProject) {
      setProviderMessage("Overleaf project import requires the desktop app.");
      return;
    }
    setImportingOverleaf(true);
    setProviderMessage("");
    try {
      await onImportOverleafProject(url);
      setProviderMessage("Overleaf project fetched and opened locally.");
    } catch (err) {
      setProviderMessage(
        err instanceof Error ? err.message : "Could not fetch the Overleaf project.",
      );
    } finally {
      setImportingOverleaf(false);
    }
  };

  return (
    <div className="ai-wizard-overlay" onClick={onClose}>
      <div
        className="profile-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Researcher profile"
      >
        <div className="profile-header">
          <div className="profile-title">
            <UserCircle2 size={18} />
            <span>Identity</span>
          </div>
          <button className="small-icon" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="profile-mode-tabs">
          <button
            className={profile.mode === "anonymous" ? "active" : ""}
            onClick={() => patch({ mode: "anonymous" })}
          >
            <Sparkles size={14} /> Anonymous token
          </button>
          <button
            className={profile.mode === "orcid" ? "active" : ""}
            onClick={() => patch({ mode: "orcid" })}
          >
            <Link2 size={14} /> ORCID
          </button>
        </div>

        {profile.mode === "anonymous" ? (
          <div className="profile-section">
            <div className="profile-token-card">
              <div className="profile-token-codename">
                {tokenCodename(profile.token)}
              </div>
              <code className="profile-token-full">{profile.token}</code>
              <div className="profile-token-actions">
                <button className="ai-wizard-ghost" onClick={copyToken}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button className="ai-wizard-ghost" onClick={regenerate}>
                  <RefreshCw size={13} /> Regenerate
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="profile-section">
            <label className="cloud-form-field">
              <span>ORCID iD or profile URL</span>
              <div className="profile-orcid-row">
                <input
                  type="text"
                  placeholder="0000-0002-1825-0097"
                  value={orcidInput}
                  onChange={(e) => setOrcidInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void connectOrcid()}
                />
                <button
                  className="ai-wizard-primary"
                  onClick={connectOrcid}
                  disabled={fetching}
                >
                  {fetching ? (
                    <>
                      <Loader2 size={13} className="spin" /> Fetching…
                    </>
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>
            </label>
            {error && (
              <div className="cloud-form-error">
                <AlertTriangle size={13} /> {error}
              </div>
            )}
            <button
              type="button"
              className="cloud-form-link"
              onClick={() => onOpenExternal?.("https://orcid.org/register")}
            >
              <ExternalLink size={12} /> Don't have one? Register at orcid.org
            </button>

            {profile.papers.length > 0 && (
              <div className="profile-papers">
                <div className="profile-papers-head">
                  <BookOpen size={14} />
                  <span>{profile.papers.length} papers linked</span>
                  <button
                    className="cloud-form-link"
                    onClick={connectOrcid}
                    disabled={fetching}
                  >
                    <RefreshCw size={11} /> Refresh
                  </button>
                </div>
                <ul>
                  {profile.papers.slice(0, 12).map((paper, i) => (
                    <li key={i}>
                      <span className="profile-paper-title">{paper.title}</span>
                      {paper.year && (
                        <span className="profile-paper-year"> ({paper.year})</span>
                      )}
                    </li>
                  ))}
                  {profile.papers.length > 12 && (
                    <li className="profile-paper-more">
                      +{profile.papers.length - 12} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="profile-section">
          <label className="cloud-form-field">
            <span>Display name</span>
            <input
              type="text"
              placeholder="How the AI addresses you"
              value={profile.displayName}
              onChange={(e) => patch({ displayName: e.target.value })}
            />
          </label>
          <label className="cloud-form-field">
            <span>Title</span>
            <select
              value={profile.title}
              onChange={(e) => patch({ title: e.target.value as AcademicTitle })}
            >
              {academicTitleOptions.map((title) => (
                <option key={title || "none"} value={title}>
                  {title || "No title"}
                </option>
              ))}
            </select>
          </label>
          {displayNameWithTitle(profile) ? (
            <div className="profile-name-preview">
              LatexDo will address you as{" "}
              <strong>{displayNameWithTitle(profile)}</strong>.
            </div>
          ) : null}
          <label className="cloud-form-field">
            <span>Affiliation (optional)</span>
            <input
              type="text"
              placeholder="Lab, university, or company"
              value={profile.affiliation}
              onChange={(e) => patch({ affiliation: e.target.value })}
            />
          </label>
          <label className="profile-context-toggle">
            <input
              type="checkbox"
              checked={profile.includeInContext}
              onChange={(e) => patch({ includeInContext: e.target.checked })}
            />
            <span>Use my profile and papers as context for the AI</span>
          </label>
        </div>

        <div className="profile-section">
          <div className="profile-provider-heading">
            <Link2 size={14} />
            <span>Connect to other provider</span>
          </div>
          <div className="profile-provider-grid">
            <label className="cloud-form-field">
              <span>Provider</span>
              <select
                value={providerDraft.provider}
                onChange={(event) =>
                  updateProviderDraft({
                    provider: event.target.value as ExternalProviderId,
                    projectFetchUrl: "",
                  })
                }
              >
                {externalProviderOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cloud-form-field">
              <span>Username</span>
              <input
                value={providerDraft.username}
                placeholder="omarabedelkader"
                onChange={(event) =>
                  updateProviderDraft(
                    { username: event.target.value },
                    { suggestName: true },
                  )
                }
              />
            </label>
            <label className="cloud-form-field">
              <span>Suggested display name</span>
              <input
                value={providerDraft.displayName}
                placeholder="Confirm the real name"
                onChange={(event) =>
                  updateProviderDraft({ displayName: event.target.value })
                }
              />
            </label>
            <label className="cloud-form-field">
              <span>Title</span>
              <select
                value={providerDraft.title}
                onChange={(event) =>
                  updateProviderDraft({
                    title: event.target.value as AcademicTitle,
                  })
                }
              >
                {academicTitleOptions.map((title) => (
                  <option key={title || "none"} value={title}>
                    {title || "No title"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {providerDraft.provider === "overleaf" ? (
            <label className="cloud-form-field">
              <span>Overleaf Git URL (optional)</span>
              <input
                type="url"
                value={providerDraft.projectFetchUrl}
                placeholder="https://git.overleaf.com/project-id"
                onChange={(event) =>
                  updateProviderDraft({ projectFetchUrl: event.target.value })
                }
              />
            </label>
          ) : null}
          <div className="profile-provider-note">
            {
              externalProviderOptions.find(
                (provider) => provider.id === providerDraft.provider,
              )?.hint
            }{" "}
            Nothing is sent to a LatexDo server.
          </div>
          <button
            type="button"
            className="ai-wizard-primary"
            onClick={confirmProviderConnection}
          >
            Confirm local connection
          </button>
          {providerMessage ? (
            <div className="profile-provider-note">{providerMessage}</div>
          ) : null}

          {providerConnections.length > 0 ? (
            <div className="profile-provider-list">
              {providerConnections.map((connection) => (
                <div
                  key={`${connection.provider}:${connection.username}`}
                  className="profile-provider-card"
                >
                  <div>
                    <strong>{providerLabel(connection.provider)}</strong>
                    <span>
                      {providerDisplayNameWithTitle(connection)} · @
                      {connection.username}
                    </span>
                  </div>
                  <div className="profile-provider-actions">
                    {connection.provider === "overleaf" &&
                    connection.projectFetchUrl ? (
                      <button
                        type="button"
                        className="ai-wizard-ghost"
                        disabled={importingOverleaf}
                        onClick={() =>
                          void importOverleafProject(connection.projectFetchUrl ?? "")
                        }
                      >
                        {importingOverleaf ? (
                          <>
                            <Loader2 size={13} className="spin" /> Fetching
                          </>
                        ) : (
                          <>
                            <BookOpen size={13} /> Fetch project
                          </>
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ai-wizard-ghost"
                      onClick={() => removeProviderConnection(connection)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
