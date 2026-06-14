import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useState } from "react";
import type { ProjectEntry } from "./types";

interface FileTreeProps {
  entries: ProjectEntry[];
  activePath?: string;
  depth?: number;
  onOpen: (entry: ProjectEntry) => void;
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

function TreeEntry({
  entry,
  activePath,
  depth,
  onOpen,
}: {
  entry: ProjectEntry;
  activePath?: string;
  depth: number;
  onOpen: (entry: ProjectEntry) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (entry.type === "directory") {
    return (
      <div>
        <button
          className="tree-row"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setExpanded((current) => !current)}
          title={entry.relativePath}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {expanded ? (
            <FolderOpen size={15} className="folder-icon" />
          ) : (
            <Folder size={15} className="folder-icon" />
          )}
          <span>{entry.name}</span>
        </button>
        {expanded && entry.children ? (
          <FileTree
            entries={entry.children}
            activePath={activePath}
            depth={depth + 1}
            onOpen={onOpen}
          />
        ) : null}
      </div>
    );
  }

  return (
    <button
      className={`tree-row ${activePath === entry.path ? "active" : ""}`}
      style={{ paddingLeft: 25 + depth * 12 }}
      onClick={() => onOpen(entry)}
      title={entry.relativePath}
    >
      <FileIcon name={entry.name} />
      <span>{entry.name}</span>
    </button>
  );
}

export default function FileTree({
  entries,
  activePath,
  depth = 0,
  onOpen,
}: FileTreeProps) {
  return (
    <>
      {entries.map((entry) => (
        <TreeEntry
          key={entry.path}
          entry={entry}
          activePath={activePath}
          depth={depth}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}
