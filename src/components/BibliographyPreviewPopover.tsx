import { Search, X } from "lucide-react";
import { useMemo } from "react";
import {
  citationBibliographyParts,
  citationSearchText,
  formatCitationBibliographyLine,
} from "../latex/citationPreview";
import type { CitationEntry } from "../latex/latexIndex";

interface BibliographyPreviewPopoverProps {
  entries: CitationEntry[];
  query: string;
  selectedKey: string | null;
  onQueryChange: (query: string) => void;
  onSelectKey: (key: string | null) => void;
  onClose: () => void;
  onOpenExternal?: (url: string) => void;
  className?: string;
  ariaLabel?: string;
}

const maxBibliographyEntriesShown = 80;

export function BibliographyPreviewPopover({
  entries,
  query,
  selectedKey,
  onQueryChange,
  onSelectKey,
  onClose,
  onOpenExternal,
  className = "",
  ariaLabel = "Bibliography preview",
}: BibliographyPreviewPopoverProps) {
  const entriesByKey = useMemo(
    () => new Map(entries.map((entry) => [entry.key, entry])),
    [entries],
  );
  const selectedEntry = selectedKey ? (entriesByKey.get(selectedKey) ?? null) : null;
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery
      ? entries.filter((entry) => citationSearchText(entry).includes(normalizedQuery))
      : entries;
    return matches.slice(0, maxBibliographyEntriesShown);
  }, [entries, query]);

  return (
    <div
      className={`pdf-bibliography-popover ${className}`.trim()}
      role="dialog"
      aria-label={ariaLabel}
    >
      <div className="pdf-bibliography-header">
        <strong>{selectedEntry ? selectedEntry.key : "Bibliography"}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close bibliography preview"
          title="Close bibliography preview"
        >
          <X size={14} />
        </button>
      </div>

      {selectedEntry ? (
        <div className="pdf-bibliography-selected">
          <strong>{selectedEntry.title || "Untitled reference"}</strong>
          <p>
            {citationBibliographyParts(selectedEntry).map((part, index) => {
              const link = part.link;
              return link ? (
                <a
                  key={`${index}:${link.url}`}
                  href={link.url}
                  title={link.url}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!onOpenExternal) return;
                    event.preventDefault();
                    onOpenExternal(link.url);
                  }}
                >
                  {part.text}
                </a>
              ) : (
                <span key={`${index}:${part.text}`}>{part.text}</span>
              );
            })}
          </p>
          <small>{selectedEntry.sourceFile}</small>
          <button type="button" onClick={() => onSelectKey(null)}>
            All references
          </button>
        </div>
      ) : (
        <>
          <label className="pdf-bibliography-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search bibliography"
            />
          </label>
          <div className="pdf-bibliography-list">
            {filteredEntries.length ? (
              filteredEntries.map((entry) => (
                <button
                  key={`${entry.sourceFile}:${entry.key}`}
                  type="button"
                  className="pdf-bibliography-entry"
                  onClick={() => onSelectKey(entry.key)}
                >
                  <span>{entry.key}</span>
                  <strong>{entry.title || "Untitled reference"}</strong>
                  <small>{formatCitationBibliographyLine(entry)}</small>
                </button>
              ))
            ) : (
              <div className="pdf-bibliography-empty">
                No bibliography entries match.
              </div>
            )}
          </div>
          {entries.length > filteredEntries.length ? (
            <div className="pdf-bibliography-count">
              Showing {filteredEntries.length} of {entries.length}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
