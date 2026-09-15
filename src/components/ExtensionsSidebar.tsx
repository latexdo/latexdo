import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  PackagePlus,
  Puzzle,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  categoryLabel,
  contributionSummary,
  extensionCategories,
  type ExtensionCategory,
  type LatexDoExtensionCatalog,
  type LatexDoExtensionManifest,
} from "../extensions";

interface ExtensionsSidebarProps {
  catalog: LatexDoExtensionCatalog;
  catalogSource: "remote" | "fallback";
  catalogLoading: boolean;
  catalogError: string;
  query: string;
  onQueryChange: (query: string) => void;
  categoryFilter: ExtensionCategory | "all";
  onCategoryFilterChange: (category: ExtensionCategory | "all") => void;
  installedExtensionIdSet: ReadonlySet<string>;
  installedExtensions: LatexDoExtensionManifest[];
  filteredExtensions: LatexDoExtensionManifest[];
  onInstallExtension: (extension: LatexDoExtensionManifest) => void;
  onUninstallExtension: (extension: LatexDoExtensionManifest) => void;
  onOpenExternal: (url: string) => void;
}

export function ExtensionsSidebar({
  catalog,
  catalogSource,
  catalogLoading,
  catalogError,
  query,
  onQueryChange,
  categoryFilter,
  onCategoryFilterChange,
  installedExtensionIdSet,
  installedExtensions,
  filteredExtensions,
  onInstallExtension,
  onUninstallExtension,
  onOpenExternal,
}: ExtensionsSidebarProps) {
  const [selectedExtensionId, setSelectedExtensionId] = useState<string>("");
  const installedFilteredExtensions = filteredExtensions.filter((extension) =>
    installedExtensionIdSet.has(extension.id),
  );
  const recommendedExtensions = filteredExtensions.filter(
    (extension) => !installedExtensionIdSet.has(extension.id),
  );
  const selectedExtension = useMemo(
    () =>
      filteredExtensions.find((extension) => extension.id === selectedExtensionId) ??
      filteredExtensions[0] ??
      null,
    [filteredExtensions, selectedExtensionId],
  );

  useEffect(() => {
    if (filteredExtensions.length === 0) {
      if (selectedExtensionId) setSelectedExtensionId("");
      return;
    }
    if (!filteredExtensions.some((extension) => extension.id === selectedExtensionId)) {
      setSelectedExtensionId(filteredExtensions[0].id);
    }
  }, [filteredExtensions, selectedExtensionId]);

  return (
    <div className="sidebar-panel extensions-sidebar-panel">
      <div className="extensions-search-row">
        <label className="extensions-search-box">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search extensions"
            spellCheck={false}
            aria-label="Search extensions"
          />
        </label>
        <select
          value={categoryFilter}
          onChange={(event) =>
            onCategoryFilterChange(event.target.value as ExtensionCategory | "all")
          }
          aria-label="Filter extensions by category"
        >
          <option value="all">All</option>
          {extensionCategories.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </div>

      <div className="extensions-meta-row">
        <span>
          <strong>{installedExtensions.length}</strong> installed
        </span>
        <span>
          <strong>{catalog.extensions.length}</strong> available
        </span>
        <span>{catalogSource === "remote" ? "Live catalog" : "Bundled catalog"}</span>
      </div>

      {catalogError ? (
        <div className="extension-store-alert extensions-alert">
          <AlertCircle size={14} />
          <span>{catalogError}</span>
        </div>
      ) : null}

      <div className="extensions-browser">
        <div className="extensions-list">
          {filteredExtensions.length ? (
            <>
              <ExtensionsSidebarSection
                title="Installed"
                count={installedFilteredExtensions.length}
                extensions={installedFilteredExtensions}
                selectedExtensionId={selectedExtension?.id ?? ""}
                installedExtensionIdSet={installedExtensionIdSet}
                onSelectExtension={setSelectedExtensionId}
                onInstallExtension={onInstallExtension}
                onUninstallExtension={onUninstallExtension}
              />

              <ExtensionsSidebarSection
                title="Recommended"
                count={recommendedExtensions.length}
                extensions={recommendedExtensions}
                selectedExtensionId={selectedExtension?.id ?? ""}
                installedExtensionIdSet={installedExtensionIdSet}
                onSelectExtension={setSelectedExtensionId}
                onInstallExtension={onInstallExtension}
                onUninstallExtension={onUninstallExtension}
              />
            </>
          ) : (
            <div className="extensions-empty">
              <Puzzle size={18} />
              <span>No extensions match the current filter.</span>
            </div>
          )}
        </div>

        {selectedExtension ? (
          <ExtensionDetailPanel
            extension={selectedExtension}
            installed={installedExtensionIdSet.has(selectedExtension.id)}
            onInstallExtension={onInstallExtension}
            onUninstallExtension={onUninstallExtension}
            onOpenExternal={onOpenExternal}
          />
        ) : (
          <div
            className="extension-detail-panel extension-detail-empty"
            role="region"
            aria-label="Extension details"
          >
            <Puzzle size={20} />
            <span>Select an extension to inspect its manifest.</span>
          </div>
        )}
      </div>

      {catalogLoading ? (
        <div className="extensions-refreshing" role="status">
          Refreshing extension catalog
        </div>
      ) : null}
    </div>
  );
}

interface ExtensionsSidebarSectionProps {
  title: string;
  count: number;
  extensions: LatexDoExtensionManifest[];
  selectedExtensionId: string;
  installedExtensionIdSet: ReadonlySet<string>;
  onSelectExtension: (extensionId: string) => void;
  onInstallExtension: (extension: LatexDoExtensionManifest) => void;
  onUninstallExtension: (extension: LatexDoExtensionManifest) => void;
}

function ExtensionsSidebarSection({
  title,
  count,
  extensions,
  selectedExtensionId,
  installedExtensionIdSet,
  onSelectExtension,
  onInstallExtension,
  onUninstallExtension,
}: ExtensionsSidebarSectionProps) {
  return (
    <section className="extensions-section" aria-label={title}>
      <div className="extensions-section-header">
        <span>{title}</span>
        <strong>{count}</strong>
      </div>
      {extensions.length ? (
        extensions.map((extension) => {
          const installed = installedExtensionIdSet.has(extension.id);
          const summary = contributionSummary(extension);
          const selected = selectedExtensionId === extension.id;
          return (
            <article
              key={extension.id}
              className={`extension-card extension-sidebar-card ${
                installed ? "installed" : ""
              } ${selected ? "selected" : ""}`}
            >
              <button
                type="button"
                className="extension-list-main"
                onClick={() => onSelectExtension(extension.id)}
                aria-label={`View ${extension.name} details`}
                aria-pressed={selected}
              >
                <div className="extension-card-top">
                  <div className="extension-icon">
                    {installed ? <Check size={17} /> : <PackagePlus size={17} />}
                  </div>
                  <div>
                    <strong>{extension.name}</strong>
                    <small>
                      {extension.author} · v{extension.version}
                    </small>
                  </div>
                  <span>{categoryLabel(extension.category)}</span>
                </div>
                <p>{extension.description}</p>
                <div className="extension-summary">
                  {summary.length ? summary.join(" · ") : "Manifest pack"}
                </div>
              </button>
              <div className="extension-card-actions">
                <button
                  type="button"
                  className={`extension-quick-action ${
                    installed ? "dialog-cancel" : "dialog-submit"
                  }`}
                  onClick={() =>
                    installed
                      ? onUninstallExtension(extension)
                      : onInstallExtension(extension)
                  }
                >
                  {installed ? <X size={13} /> : <Download size={13} />}
                  {installed ? "Uninstall" : "Install"}
                </button>
              </div>
            </article>
          );
        })
      ) : (
        <div className="sidebar-empty-state compact">
          No {title.toLowerCase()} extensions.
        </div>
      )}
    </section>
  );
}

interface ExtensionDetailPanelProps {
  extension: LatexDoExtensionManifest;
  installed: boolean;
  onInstallExtension: (extension: LatexDoExtensionManifest) => void;
  onUninstallExtension: (extension: LatexDoExtensionManifest) => void;
  onOpenExternal: (url: string) => void;
}

function ExtensionDetailPanel({
  extension,
  installed,
  onInstallExtension,
  onUninstallExtension,
  onOpenExternal,
}: ExtensionDetailPanelProps) {
  const featureFlags = Object.keys(extension.contributes.featureFlags ?? {});
  const snippets = extension.contributes.snippets ?? [];
  const templates = extension.contributes.templates ?? [];
  const summary = contributionSummary(extension);

  return (
    <section
      className="extension-detail-panel"
      role="region"
      aria-label="Extension details"
    >
      <div className="extension-detail-header">
        <div className="extension-detail-icon">
          {installed ? <Check size={21} /> : <Puzzle size={21} />}
        </div>
        <div>
          <h3>{extension.name}</h3>
          <p>
            {extension.author} · v{extension.version}
          </p>
        </div>
        {installed ? <span className="extension-installed-pill">Installed</span> : null}
      </div>

      <p className="extension-detail-description">{extension.description}</p>

      <div className="extension-detail-actions">
        <button
          type="button"
          className={installed ? "dialog-cancel" : "dialog-submit"}
          onClick={() =>
            installed ? onUninstallExtension(extension) : onInstallExtension(extension)
          }
        >
          {installed ? <X size={13} /> : <Download size={13} />}
          {installed ? "Uninstall" : "Install"}
        </button>
        {extension.homepage ? (
          <button
            type="button"
            className="dialog-cancel"
            onClick={() => onOpenExternal(extension.homepage!)}
          >
            <ExternalLink size={13} />
            Homepage
          </button>
        ) : null}
        {extension.repository ? (
          <button
            type="button"
            className="dialog-cancel"
            onClick={() => onOpenExternal(extension.repository!)}
          >
            <ExternalLink size={13} />
            Repository
          </button>
        ) : null}
      </div>

      <dl className="extension-detail-meta">
        <div>
          <dt>Author</dt>
          <dd>{extension.author}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{extension.version}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{categoryLabel(extension.category)}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{extension.kind === "template" ? "Template pack" : "Extension"}</dd>
        </div>
        <div className="wide">
          <dt>Identifier</dt>
          <dd>{extension.id}</dd>
        </div>
      </dl>

      {extension.tags.length ? (
        <div className="extension-tags extension-detail-tags" aria-label="Tags">
          {extension.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}

      <div className="extension-detail-section">
        <h4>Contributes</h4>
        <p>{summary.length ? summary.join(" · ") : "Manifest metadata only."}</p>
        {featureFlags.length ? (
          <ul className="extension-detail-contribution-list">
            {featureFlags.map((flag) => (
              <li key={flag}>{formatFeatureFlagName(flag)}</li>
            ))}
          </ul>
        ) : null}
        {snippets.length ? (
          <div className="extension-detail-subsection">
            <strong>Snippets</strong>
            <ul className="extension-detail-contribution-list compact">
              {snippets.map((snippet) => (
                <li key={snippet.label}>
                  <span>{snippet.label}</span>
                  {snippet.detail ? <small>{snippet.detail}</small> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {templates.length ? (
          <div className="extension-detail-subsection">
            <strong>Templates</strong>
            <ul className="extension-detail-contribution-list compact">
              {templates.map((template) => (
                <li key={template.id}>
                  <span>{template.name}</span>
                  <small>{template.summary}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatFeatureFlagName(flag: string): string {
  return flag
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
