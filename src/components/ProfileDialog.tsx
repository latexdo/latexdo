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
  generateScholarToken,
  tokenCodename,
} from "../features/ai/researcherProfile";
import { fetchOrcidProfile, isValidOrcid } from "../features/ai/orcid";

interface ProfileDialogProps {
  profile: ResearcherProfile;
  onChange: (profile: ResearcherProfile) => void;
  onClose: () => void;
  onOpenExternal?: (url: string) => void;
}

export const ProfileDialog: React.FC<ProfileDialogProps> = ({
  profile,
  onChange,
  onClose,
  onOpenExternal,
}) => {
  const [orcidInput, setOrcidInput] = React.useState(profile.orcidId);
  const [fetching, setFetching] = React.useState(false);
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const patch = (part: Partial<ResearcherProfile>) =>
    onChange({ ...profile, ...part });

  const regenerate = () => patch({ token: generateScholarToken() });

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

  return (
    <div className="ai-wizard-overlay" onClick={onClose}>
      <div
        className="profile-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Researcher profile"
      >
        <div className="profile-header">
          <div className="profile-title">
            <UserCircle2 size={18} />
            <span>Your researcher identity</span>
          </div>
          <button className="small-icon" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <p className="settings-hint">
          The AI uses this to understand who it's helping — your field, prior
          work, and terminology. Stored locally; you control it.
        </p>

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
            <p className="settings-hint">
              A private, hard-to-guess identity (128 bits of randomness) with a
              memorable codename. Regenerate any time — the old one stops working.
            </p>
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
              className="cloud-form-link"
              onClick={() => onOpenExternal?.("https://orcid.org/")}
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
      </div>
    </div>
  );
};
