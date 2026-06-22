import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { AlertTriangle, Copy, RefreshCw, Search, X } from "lucide-react";
import {
  defaultProjectSearchOptions,
  formatProjectSearchResults,
  searchProjectFiles,
  type ProjectSearchFile,
  type ProjectSearchMatch,
  type ProjectSearchOptions,
} from "../search/projectSearch";

interface ProjectSearchPanelProps {
  files: ProjectSearchFile[];
  loading?: boolean;
  error?: string;
  activePath?: string;
  onOpenMatch: (match: ProjectSearchMatch) => void;
  onRefresh?: () => void;
}

function updateOption<K extends keyof ProjectSearchOptions>(
  options: ProjectSearchOptions,
  key: K,
  value: ProjectSearchOptions[K],
): ProjectSearchOptions {
  return { ...options, [key]: value };
}

function HighlightedLine({ match }: { match: ProjectSearchMatch }) {
  const start = Math.max(0, match.column - 1);
  const end = Math.max(start, match.endColumn - 1);
  return (
    <>
      {match.lineText.slice(0, start)}
      <mark>{match.lineText.slice(start, end)}</mark>
      {match.lineText.slice(end)}
    </>
  );
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

export function ProjectSearchPanel({
  files,
  loading = false,
  error = "",
  activePath,
  onOpenMatch,
  onRefresh,
}: ProjectSearchPanelProps) {
  const [options, setOptions] = useState<ProjectSearchOptions>(
    defaultProjectSearchOptions,
  );
  const [copied, setCopied] = useState(false);
  const deferredQuery = useDeferredValue(options.query);

  const searchOptions = useMemo(
    () => ({ ...options, query: deferredQuery }),
    [deferredQuery, options],
  );
  const result = useMemo(
    () => searchProjectFiles(files, searchOptions),
    [files, searchOptions],
  );
  const firstMatch = result.files[0]?.matches[0] ?? null;
  const queryPending = options.query !== deferredQuery;

  const setOption = useCallback(
    <K extends keyof ProjectSearchOptions>(key: K, value: ProjectSearchOptions[K]) => {
      setOptions((current) => updateOption(current, key, value));
    },
    [],
  );

  const copyResults = useCallback(async () => {
    const formatted = formatProjectSearchResults(result);
    if (!formatted || !navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [result]);

  return (
    <div className="project-search-panel">
      <div className="project-search-hero">
        <div className="project-search-title">
          <Search size={15} />
          <span>Project Search</span>
        </div>
        <button
          type="button"
          className="project-search-icon-button"
          onClick={onRefresh}
          disabled={!onRefresh || loading}
          title="Rescan project files"
          aria-label="Rescan project files"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="project-search-query-row">
        <label className="project-search-input">
          <Search size={14} />
          <input
            value={options.query}
            onChange={(event) => setOption("query", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && firstMatch) {
                event.preventDefault();
                onOpenMatch(firstMatch);
              }
            }}
            placeholder="Search every project file"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        {options.query ? (
          <button
            type="button"
            className="project-search-icon-button"
            onClick={() => setOption("query", "")}
            title="Clear search"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="project-search-toggles" aria-label="Search options">
        <button
          type="button"
          className={options.matchCase ? "active" : ""}
          onClick={() => setOption("matchCase", !options.matchCase)}
          title="Match case"
        >
          Aa
        </button>
        <button
          type="button"
          className={options.wholeWord ? "active" : ""}
          onClick={() => setOption("wholeWord", !options.wholeWord)}
          title="Match whole word"
        >
          Word
        </button>
        <button
          type="button"
          className={options.useRegex ? "active" : ""}
          onClick={() => setOption("useRegex", !options.useRegex)}
          title="Use regular expression"
        >
          .*
        </button>
      </div>

      <div className="project-search-filters">
        <label>
          <span>Include</span>
          <input
            value={options.include}
            onChange={(event) => setOption("include", event.target.value)}
            placeholder="*.tex, chapters/**"
          />
        </label>
        <label>
          <span>Exclude</span>
          <input
            value={options.exclude}
            onChange={(event) => setOption("exclude", event.target.value)}
            placeholder="*.log, draft/**"
          />
        </label>
        <div className="project-search-selects">
          <label>
            <span>Context</span>
            <select
              value={options.contextLines}
              onChange={(event) =>
                setOption("contextLines", Number(event.target.value))
              }
            >
              <option value={0}>0 lines</option>
              <option value={1}>1 line</option>
              <option value={2}>2 lines</option>
              <option value={3}>3 lines</option>
            </select>
          </label>
          <label>
            <span>Limit</span>
            <select
              value={options.maxResults}
              onChange={(event) => setOption("maxResults", Number(event.target.value))}
            >
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1,000</option>
              <option value={5000}>5,000</option>
            </select>
          </label>
        </div>
      </div>

      <div className="project-search-summary">
        <span>
          {loading || queryPending
            ? "Searching..."
            : options.query
              ? `${result.totalMatches} matches in ${result.files.length} files`
              : `${files.length} searchable files`}
        </span>
        <button
          type="button"
          className="project-search-copy"
          onClick={() => void copyResults()}
          disabled={!result.totalMatches || Boolean(result.error)}
        >
          <Copy size={12} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {error || result.error ? (
        <div className="project-search-alert">
          <AlertTriangle size={14} />
          <span>{error || result.error}</span>
        </div>
      ) : null}

      {result.truncated ? (
        <div className="project-search-alert subtle">
          Results stopped at {result.totalMatches}. Refine the query or increase the
          limit.
        </div>
      ) : null}

      <div className="project-search-results">
        {!options.query ? (
          <div className="project-search-empty">
            Search supports regex, case sensitivity, whole-word matching,
            include/exclude globs, and exact source navigation.
          </div>
        ) : result.error ? (
          <div className="project-search-empty">Fix the query to search again.</div>
        ) : result.files.length ? (
          result.files.map((file) => (
            <section key={file.path} className="project-search-file-group">
              <div className="project-search-file-heading">
                <div>
                  <strong>{fileName(file.path)}</strong>
                  <span>{file.path}</span>
                </div>
                <b>{file.matches.length}</b>
              </div>
              {file.matches.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  className={`project-search-match ${
                    activePath === match.path ? "active-file" : ""
                  }`}
                  onClick={() => onOpenMatch(match)}
                >
                  {match.before.map((line, index) => (
                    <span
                      key={`before-${match.id}-${index}`}
                      className="project-search-context-line"
                    >
                      {match.line - match.before.length + index}: {line || " "}
                    </span>
                  ))}
                  <span className="project-search-hit-line">
                    <b>
                      {match.line}:{match.column}
                    </b>
                    <span>
                      <HighlightedLine match={match} />
                    </span>
                  </span>
                  {match.after.map((line, index) => (
                    <span
                      key={`after-${match.id}-${index}`}
                      className="project-search-context-line"
                    >
                      {match.line + index + 1}: {line || " "}
                    </span>
                  ))}
                </button>
              ))}
            </section>
          ))
        ) : (
          <div className="project-search-empty">
            No matches. Try clearing filters or disabling whole-word matching.
          </div>
        )}
      </div>
    </div>
  );
}
