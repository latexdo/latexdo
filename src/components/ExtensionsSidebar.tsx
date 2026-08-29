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
  const installedFilteredExtensions = filteredExtensions.filter((extension) =>
    installedExtensionIdSet.has(extension.id),
  );
  const recommendedExtensions = filteredExtensions.filter(
    (extension) => !installedExtensionIdSet.has(extension.id),
  );

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

      <div className="extensions-list">
        {filteredExtensions.length ? (
          <>
            <ExtensionsSidebarSection
              title="Installed"
              count={installedFilteredExtensions.length}
              extensions={installedFilteredExtensions}
              installedExtensionIdSet={installedExtensionIdSet}
              onInstallExtension={onInstallExtension}
              onUninstallExtension={onUninstallExtension}
              onOpenExternal={onOpenExternal}
            />

            <ExtensionsSidebarSection
              title="Recommended"
              count={recommendedExtensions.length}
              extensions={recommendedExtensions}
              installedExtensionIdSet={installedExtensionIdSet}
              onInstallExtension={onInstallExtension}
              onUninstallExtension={onUninstallExtension}
              onOpenExternal={onOpenExternal}
            />
          </>
        ) : (
          <div className="extensions-empty">
            <Puzzle size={18} />
            <span>No extensions match the current filter.</span>
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
  installedExtensionIdSet: ReadonlySet<string>;
  onInstallExtension: (extension: LatexDoExtensionManifest) => void;
  onUninstallExtension: (extension: LatexDoExtensionManifest) => void;
  onOpenExternal: (url: string) => void;
}

function ExtensionsSidebarSection({
  title,
  count,
  extensions,
  installedExtensionIdSet,
  onInstallExtension,
  onUninstallExtension,
  onOpenExternal,
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
          return (
            <article
              key={extension.id}
              className={`extension-card extension-sidebar-card ${
                installed ? "installed" : ""
              }`}
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
              <div className="extension-card-actions">
                {extension.homepage ? (
                  <button
                    type="button"
                    className="dialog-cancel"
                    onClick={() => onOpenExternal(extension.homepage!)}
                  >
                    <ExternalLink size={13} />
                    Details
                  </button>
                ) : null}
                <button
                  type="button"
                  className={installed ? "dialog-cancel" : "dialog-submit"}
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
