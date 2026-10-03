import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FileTree from "./FileTree";
import type { ProjectEntry } from "./types";
const file = (relativePath: string): ProjectEntry => ({
  name: relativePath.split("/").pop()!,
  path: `/paper/${relativePath}`,
  relativePath,
  type: "file",
});
const nested = file("sections/intro.tex"),
  main = file("main.tex"),
  image = file("plot.png");
const folder: ProjectEntry = {
  name: "sections",
  path: "/paper/sections",
  relativePath: "sections",
  type: "directory",
  children: [nested],
};
const target: ProjectEntry = {
  name: "appendix",
  path: "/paper/appendix",
  relativePath: "appendix",
  type: "directory",
  children: [],
};
function setup() {
  const callbacks = {
    onOpen: vi.fn(),
    onCompileFile: vi.fn(),
    onSetRootFile: vi.fn(),
    onMoveEntry: vi.fn(),
    onImportExternalFiles: vi.fn(),
    onChooseImportFilesInDirectory: vi.fn(),
    onCreateFileInDirectory: vi.fn(),
    onCreateFolderInDirectory: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onInsertFileReference: vi.fn(),
    onRevealFile: vi.fn(),
  };
  return {
    ...render(
      <FileTree
        entries={[main, image, folder, target, file("README.md")]}
        activePath={main.path}
        {...callbacks}
      />,
    ),
    ...callbacks,
  };
}
function transfer(files: File[] = []) {
  const values = new Map<string, string>();
  return {
    types: files.length ? ["Files"] : ["text/plain"],
    files,
    effectAllowed: "",
    dropEffect: "",
    setData: (kind: string, value: string) => values.set(kind, value),
    getData: (kind: string) => values.get(kind) || "",
  };
}
const row = (name: string) => screen.getByText(name).closest(".tree-row")!;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("file tree interaction", () => {
  it.each([
    ["Open file", "onOpen"],
    ["Generate PDF", "onCompileFile"],
    ["Use as main file", "onSetRootFile"],
    ["Copy relative path", "onCopyRelativePath"],
  ] as const)("executes %s for the selected file", (label, callback) => {
    const view = setup();
    fireEvent.contextMenu(row("main.tex"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(view[callback]).toHaveBeenCalledWith(main);
    expect(screen.queryByText("Use as main file")).not.toBeInTheDocument();
  });
  it.each([
    ["New file", "onCreateFileInDirectory"],
    ["New folder", "onCreateFolderInDirectory"],
    ["Import files here", "onChooseImportFilesInDirectory"],
  ] as const)("executes folder action %s", (label, callback) => {
    const view = setup();
    fireEvent.click(screen.getByTitle("Actions for sections"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(view[callback]).toHaveBeenCalledWith(folder);
  });
  it.each([
    ["Reveal in File Manager", "onRevealFile"],
    ["Insert image code", "onInsertFileReference"],
  ] as const)("executes image action %s", (label, callback) => {
    const view = setup();
    fireEvent.click(screen.getByTitle("Actions for plot.png"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(view[callback]).toHaveBeenCalledWith(image);
    expect(view.onOpen).not.toHaveBeenCalled();
  });
  it("reveals images without opening and closes menus on an outside click", () => {
    const view = setup();
    fireEvent.click(screen.getByLabelText("Reveal plot.png in file manager"));
    expect(view.onRevealFile).toHaveBeenCalledWith(image);
    fireEvent.click(screen.getByTitle("Actions for main.tex"));
    fireEvent.click(window);
    expect(screen.queryByText("Generate PDF")).not.toBeInTheDocument();
    fireEvent.click(row("README.md"));
    expect(view.onOpen).toHaveBeenCalledWith(file("README.md"));
  });
  it("collapses and expands folders from the context menu", () => {
    setup();
    fireEvent.contextMenu(row("sections"));
    fireEvent.click(screen.getByRole("button", { name: "Collapse folder" }));
    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Actions for sections"));
    fireEvent.click(screen.getByRole("button", { name: "Expand folder" }));
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
  });
  it("moves files between directories and from a directory to root", () => {
    const view = setup(),
      data = transfer();
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    expect(data.getData("text/plain")).toBe(nested.path);
    fireEvent.dragOver(row("appendix"), { dataTransfer: data });
    fireEvent.drop(row("appendix"), { dataTransfer: data });
    expect(view.onMoveEntry).toHaveBeenCalledWith(nested.path, target);
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    const root = view.container.querySelector(".file-tree-drop-surface")!;
    fireEvent.dragOver(root, { dataTransfer: data });
    expect(root).toHaveClass("root-drop-target");
    fireEvent.drop(root, { dataTransfer: data });
    expect(view.onMoveEntry).toHaveBeenLastCalledWith(nested.path, null);
    expect(
      screen.queryByText("Drop in this space to move to the project root"),
    ).not.toBeInTheDocument();
  });
  it("rejects dropping into the same parent or a directory onto itself", () => {
    const view = setup(),
      data = transfer();
    fireEvent.dragStart(row("intro.tex"), { dataTransfer: data });
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    fireEvent.drop(row("sections"), { dataTransfer: data });
    expect(view.onMoveEntry).not.toHaveBeenCalled();
    fireEvent.dragEnd(row("intro.tex"), { dataTransfer: data });
    fireEvent.dragStart(row("sections"), { dataTransfer: data });
    fireEvent.drop(row("sections"), { dataTransfer: data });
    expect(view.onMoveEntry).not.toHaveBeenCalled();
  });
  it("imports external files into the hovered directory or project root", () => {
    const view = setup(),
      files = [new File(["text"], "external.tex")],
      data = transfer(files);
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    expect(data.dropEffect).toBe("copy");
    fireEvent.drop(row("sections"), { dataTransfer: data });
    expect(view.onImportExternalFiles).toHaveBeenCalledWith(files, folder);
    const root = view.container.querySelector(".file-tree-drop-surface")!;
    fireEvent.dragOver(root, { dataTransfer: data });
    expect(
      screen.getByText("Drop files here to import into the project root"),
    ).toBeInTheDocument();
    fireEvent.dragLeave(root, { dataTransfer: data, relatedTarget: document.body });
    expect(root).not.toHaveClass("root-drop-target");
    fireEvent.drop(root, { dataTransfer: data });
    expect(view.onImportExternalFiles).toHaveBeenLastCalledWith(files, null);
  });
  it("opens collapsed folders while hovering and cancels expansion when leaving", () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(row("sections"));
    const data = transfer([new File(["x"], "x.tex")]);
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    fireEvent.dragLeave(row("sections"), {
      dataTransfer: data,
      relatedTarget: document.body,
    });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
    fireEvent.dragOver(row("sections"), { dataTransfer: data });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
  });
});
