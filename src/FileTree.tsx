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
import { useEffect, useMemo, useState } from "react";
import type { ProjectEntry } from "./types";

interface FileTreeProps {
  entries: ProjectEntry[];
  activePath?: string;
  depth?: number;
  onOpen: (entry: ProjectEntry) => void;
  onCompileFile?: (entry: ProjectEntry) => void;
  onSetRootFile?: (entry: ProjectEntry) => void;
  onMoveEntry?: (sourcePath: string, destination: ProjectEntry) => void;
  onCreateFileInDirectory?: (entry: ProjectEntry) => void;
  onCreateFolderInDirectory?: (entry: ProjectEntry) => void;
  menuPath?: string | null;
  onToggleMenu?: (path: string | null) => void;
  draggedPath?: string | null;
  onDragStartPath?: (path: string | null) => void;
}

interface TreeRowProps
  extends Omit<FileTreeProps, "entries" | "menuPath" | "onToggleMenu" | "draggedPath" | "onDragStartPath"> {
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
  const toggleMenu = onToggleMenu ?? (() => {});
  const menuOpen = menuPath === entry.path;
  const isDropTarget =
    entry.type === "directory" && draggedPath && draggedPath !== entry.path;

  useEffect(() => {
    if (!activePath || entry.type !== "directory") {
      return;
    }

    const normalizedEntry = `${entry.path}/`;
    if (activePath.startsWith(normalizedEntry)) {
      setExpanded(true);
    }
  }, [activePath, entry.path, entry.type]);

  const rowPadding = useMemo(
    () => (entry.type === "directory" ? 8 + depth * 12 : 25 + depth * 12),
    [depth, entry.type],
  );

  if (entry.type === "directory") {
    return (
      <div>
        <button
          className={`tree-row ${dropActive ? "drop-target" : ""}`}
          style={{ paddingLeft: rowPadding }}
          onClick={() => setExpanded((current) => !current)}
          title={entry.relativePath}
          onContextMenu={(event) => {
            event.preventDefault();
            toggleMenu(menuOpen ? null : entry.path);
          }}
          onDragOver={(event) => {
            if (!isDropTarget) {
              return;
            }
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
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
            onDragStartPath?.(null);
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
  const menuPath = controlledMenuPath ?? menuPathState;
  const toggleMenu = controlledToggleMenu ?? setMenuPathState;
  const draggedPath = controlledDraggedPath ?? draggedPathState;
  const setDraggedPath = controlledSetDraggedPath ?? setDraggedPathState;

  useEffect(() => {
    const closeMenu = () => toggleMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [toggleMenu]);

  return (
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
}
