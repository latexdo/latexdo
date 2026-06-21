import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectEntry } from "./types";

interface FileTreeProps {
  entries: ProjectEntry[];
  activePath?: string;
  depth?: number;
  onOpen: (entry: ProjectEntry) => void;
  onCompileFile?: (entry: ProjectEntry) => void;
  onSetRootFile?: (entry: ProjectEntry) => void;
  onMoveEntry?: (sourcePath: string, destination: ProjectEntry | null) => void;
  onCreateFileInDirectory?: (entry: ProjectEntry) => void;
  onCreateFolderInDirectory?: (entry: ProjectEntry) => void;
  menuPath?: string | null;
  onToggleMenu?: (path: string | null) => void;
  draggedPath?: string | null;
  onDragStartPath?: (path: string | null) => void;
}

interface TreeRowProps extends Omit<
  FileTreeProps,
  "entries" | "menuPath" | "onToggleMenu" | "draggedPath" | "onDragStartPath"
> {
  entry: ProjectEntry;
  menuPath: string | null;
  onToggleMenu: (path: string | null) => void;
  draggedPath: string | null;
  onDragStartPath: (path: string | null) => void;
}

function FileIcon({ name }: { name: string }) {
  const extension = name.split(".").pop()?.toLowerCase();

  if (extension === "tex" || extension === "bib" || extension === "sty") {
    return <FileCode2 size={15} className={`file-icon file-${extension}`} />;
  }

  if (["png", "jpg", "jpeg", "svg", "pdf"].includes(extension ?? "")) {
    return <FileImage size={15} className="file-icon file-image" />;
  }

  return <File size={15} className="file-icon" />;
}

function isTexFile(entry: ProjectEntry): boolean {
  return entry.type === "file" && entry.name.toLowerCase().endsWith(".tex");
}

function normalizeTreePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function parentTreePath(value: string): string {
  const normalized = normalizeTreePath(value);
  return normalized.slice(0, Math.max(0, normalized.lastIndexOf("/")));
}

function canDropIntoDirectory(
  draggedPath: string | null,
  destinationPath: string,
): boolean {
  if (!draggedPath) {
    return false;
  }

  const source = normalizeTreePath(draggedPath);
  const destination = normalizeTreePath(destinationPath);
  return (
    source !== destination &&
    parentTreePath(source) !== destination &&
    !destination.startsWith(`${source}/`)
  );
}

function findEntryByPath(
  entries: ProjectEntry[],
  targetPath: string,
): ProjectEntry | null {
  for (const entry of entries) {
    if (entry.path === targetPath) {
      return entry;
    }
    const child = entry.children ? findEntryByPath(entry.children, targetPath) : null;
    if (child) {
      return child;
    }
  }
  return null;
}

function TreeRow({
  entry,
  activePath,
  depth = 0,
  onOpen,
  onCompileFile,
  onSetRootFile,
  onMoveEntry,
  onCreateFileInDirectory,
  onCreateFolderInDirectory,
  menuPath,
  onToggleMenu,
  draggedPath,
  onDragStartPath,
}: TreeRowProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [dropActive, setDropActive] = useState(false);
  const expandTimerRef = useRef<number | null>(null);
  const toggleMenu = onToggleMenu ?? (() => {});
  const menuOpen = menuPath === entry.path;
  const isDropTarget =
    entry.type === "directory" && canDropIntoDirectory(draggedPath, entry.path);

  const clearExpandTimer = () => {
    if (expandTimerRef.current !== null) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!activePath || entry.type !== "directory") {
      return;
    }

    const normalizedEntry = `${entry.path}/`;
    if (activePath.startsWith(normalizedEntry)) {
      setExpanded(true);
    }
  }, [activePath, entry.path, entry.type]);

  useEffect(() => clearExpandTimer, []);

  const rowPadding = useMemo(
    () => (entry.type === "directory" ? 8 + depth * 12 : 25 + depth * 12),
    [depth, entry.type],
  );

  if (entry.type === "directory") {
    return (
      <div className="tree-directory-row">
        <button
          className={`tree-row ${dropActive ? "drop-target" : ""}`}
          style={{ paddingLeft: rowPadding }}
          onClick={() => setExpanded((current) => !current)}
          title={entry.relativePath}
          onContextMenu={(event) => {
            event.preventDefault();
            toggleMenu(menuOpen ? null : entry.path);
          }}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", entry.path);
            onDragStartPath?.(entry.path);
          }}
          onDragEnd={() => {
            clearExpandTimer();
            setDropActive(false);
            onDragStartPath?.(null);
          }}
          onDragOver={(event) => {
            if (draggedPath) {
              event.stopPropagation();
            }
            if (!isDropTarget) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropActive(true);
            if (!expanded && expandTimerRef.current === null) {
              expandTimerRef.current = window.setTimeout(() => {
                setExpanded(true);
                expandTimerRef.current = null;
              }, 450);
            }
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
              return;
            }
            clearExpandTimer();
            setDropActive(false);
          }}
          onDrop={(event) => {
            if (draggedPath) {
              event.stopPropagation();
            }
            clearExpandTimer();
            if (!onMoveEntry || !draggedPath || !isDropTarget) {
              setDropActive(false);
              return;
            }
            event.preventDefault();
            setDropActive(false);
            const sourcePath = event.dataTransfer.getData("text/plain");
            if (!sourcePath || sourcePath === entry.path) {
              return;
            }
            onMoveEntry(sourcePath, entry);
            onDragStartPath(null);
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {expanded ? (
            <FolderOpen size={15} className="folder-icon" />
          ) : (
            <Folder size={15} className="folder-icon" />
          )}
          <span>{entry.name}</span>
        </button>
        <div className="tree-row-actions">
          <button
            className={`tree-row-menu-button ${menuOpen ? "active" : ""}`}
            onClick={() => toggleMenu(menuOpen ? null : entry.path)}
            title={`Actions for ${entry.name}`}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen ? (
            <div className="tree-row-menu">
              <button
                className="tree-row-menu-item"
                onClick={() => {
                  toggleMenu(null);
                  setExpanded((current) => !current);
                }}
              >
                {expanded ? "Collapse folder" : "Expand folder"}
              </button>
              <button
                className="tree-row-menu-item"
                onClick={() => {
                  toggleMenu(null);
                  onCreateFileInDirectory?.(entry);
                }}
              >
                New file
              </button>
              <button
                className="tree-row-menu-item"
                onClick={() => {
                  toggleMenu(null);
                  onCreateFolderInDirectory?.(entry);
                }}
              >
                New folder
              </button>
            </div>
          ) : null}
        </div>
        {expanded && entry.children ? (
          <FileTree
            entries={entry.children}
            activePath={activePath}
            depth={depth + 1}
            onOpen={onOpen}
            onCompileFile={onCompileFile}
            onSetRootFile={onSetRootFile}
            onMoveEntry={onMoveEntry}
            onCreateFileInDirectory={onCreateFileInDirectory}
            onCreateFolderInDirectory={onCreateFolderInDirectory}
            menuPath={menuPath}
            onToggleMenu={onToggleMenu}
            draggedPath={draggedPath}
            onDragStartPath={onDragStartPath}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="tree-file-row">
      <button
        className={`tree-row ${activePath === entry.path ? "active" : ""}`}
        style={{ paddingLeft: rowPadding }}
        onClick={() => onOpen(entry)}
        title={entry.relativePath}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", entry.path);
          onDragStartPath?.(entry.path);
        }}
        onDragEnd={() => onDragStartPath?.(null)}
        onContextMenu={(event) => {
          event.preventDefault();
          toggleMenu(menuOpen ? null : entry.path);
        }}
      >
        <FileIcon name={entry.name} />
        <span>{entry.name}</span>
      </button>
      <div className="tree-row-actions">
        <button
          className={`tree-row-menu-button ${menuOpen ? "active" : ""}`}
          onClick={() => toggleMenu(menuOpen ? null : entry.path)}
          title={`Actions for ${entry.name}`}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen ? (
          <div className="tree-row-menu">
            <button
              className="tree-row-menu-item"
              onClick={() => {
                toggleMenu(null);
                onOpen(entry);
              }}
            >
              Open file
            </button>
            {isTexFile(entry) ? (
              <>
                <button
                  className="tree-row-menu-item"
                  onClick={() => {
                    toggleMenu(null);
                    onCompileFile?.(entry);
                  }}
                >
                  Generate PDF
                </button>
                <button
                  className="tree-row-menu-item"
                  onClick={() => {
                    toggleMenu(null);
                    onSetRootFile?.(entry);
                  }}
                >
                  Use as main file
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function FileTree({
  entries,
  activePath,
  depth = 0,
  onOpen,
  onCompileFile,
  onSetRootFile,
  onMoveEntry,
  onCreateFileInDirectory,
  onCreateFolderInDirectory,
  menuPath: controlledMenuPath,
  onToggleMenu: controlledToggleMenu,
  draggedPath: controlledDraggedPath,
  onDragStartPath: controlledSetDraggedPath,
}: FileTreeProps) {
  const [menuPathState, setMenuPathState] = useState<string | null>(null);
  const [draggedPathState, setDraggedPathState] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const menuPath = controlledMenuPath ?? menuPathState;
  const toggleMenu = controlledToggleMenu ?? setMenuPathState;
  const draggedPath = controlledDraggedPath ?? draggedPathState;
  const setDraggedPath = controlledSetDraggedPath ?? setDraggedPathState;
  const draggedEntry =
    depth === 0 && draggedPath ? findEntryByPath(entries, draggedPath) : null;
  const canDropAtRoot = Boolean(
    draggedEntry && normalizeTreePath(draggedEntry.relativePath).includes("/"),
  );

  useEffect(() => {
    const closeMenu = () => toggleMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [toggleMenu]);

  useEffect(() => {
    if (!draggedPath) {
      setRootDropActive(false);
    }
  }, [draggedPath]);

  const rows = (
    <>
      {entries.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          activePath={activePath}
          depth={depth}
          onOpen={onOpen}
          onCompileFile={onCompileFile}
          onSetRootFile={onSetRootFile}
          onMoveEntry={onMoveEntry}
          onCreateFileInDirectory={onCreateFileInDirectory}
          onCreateFolderInDirectory={onCreateFolderInDirectory}
          menuPath={menuPath}
          onToggleMenu={toggleMenu}
          draggedPath={draggedPath}
          onDragStartPath={setDraggedPath}
        />
      ))}
    </>
  );

  if (depth > 0) {
    return rows;
  }

  return (
    <div
      className={`file-tree-drop-surface ${
        draggedPath ? "dragging" : ""
      } ${canDropAtRoot ? "root-available" : ""} ${
        rootDropActive ? "root-drop-target" : ""
      }`}
      onDragOver={(event) => {
        if (!canDropAtRoot) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setRootDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setRootDropActive(false);
        }
      }}
      onDrop={(event) => {
        setRootDropActive(false);
        if (!onMoveEntry || !canDropAtRoot) {
          return;
        }
        event.preventDefault();
        const sourcePath = event.dataTransfer.getData("text/plain");
        if (!sourcePath) {
          return;
        }
        onMoveEntry(sourcePath, null);
        setDraggedPath(null);
      }}
    >
      {rows}
      {draggedPath && canDropAtRoot ? (
        <div className="file-tree-root-hint">
          Drop in this space to move to the project root
        </div>
      ) : null}
    </div>
  );
}
