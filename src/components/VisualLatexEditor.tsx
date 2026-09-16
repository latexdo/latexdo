import { useEffect, useRef, useState } from "react";

type HeadingCommand = "section" | "subsection" | "subsubsection" | "paragraph";
type ListEnvironment = "itemize" | "enumerate";
type MathEnvironment =
  | "equation"
  | "equation*"
  | "align"
  | "align*"
  | "gather"
  | "gather*";

export type VisualLatexBlock =
  | { type: "blank" }
  | {
      type: "heading";
      command: HeadingCommand;
      level: 1 | 2 | 3 | 4;
      starred: boolean;
      text: string;
      label: string;
    }
  | { type: "paragraph"; text: string }
  | { type: "list"; environment: ListEnvironment; items: string[] }
  | { type: "math"; environment: MathEnvironment | "display"; text: string }
  | { type: "raw"; text: string };

interface VisualLatexEditorProps {
  content: string;
  readOnly?: boolean;
  onChange: (content: string) => void;
}

const headingLevels: Record<HeadingCommand, 1 | 2 | 3 | 4> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
};

const listBeginPattern = /^\\begin\{(itemize|enumerate)\}\s*$/;
const mathBeginPattern = /^\\begin\{(equation\*?|align\*?|gather\*?)\}\s*$/;

export function parseLatexToVisualBlocks(content: string): VisualLatexBlock[] {
  const normalized = content.replace(/\r\n?/g, "\n");
  if (!normalized) {
    return [{ type: "paragraph", text: "" }];
  }

  const lines = normalized.split("\n");
  const blocks: VisualLatexBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      blocks.push({ type: "blank" });
      index += 1;
      continue;
    }

    const heading = parseHeadingLine(trimmed);
    if (heading) {
      blocks.push(heading);
      index += 1;
      continue;
    }

    const listMatch = trimmed.match(listBeginPattern);
    if (listMatch) {
      const { block, nextIndex } = parseListBlock(
        lines,
        index,
        listMatch[1] as ListEnvironment,
      );
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    const mathMatch = trimmed.match(mathBeginPattern);
    if (mathMatch) {
      const { block, nextIndex } = parseMathEnvironment(
        lines,
        index,
        mathMatch[1] as MathEnvironment,
      );
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    if (trimmed === "\\[") {
      const { block, nextIndex } = parseDisplayMathBlock(lines, index);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    if (isRawLatexLine(trimmed)) {
      const rawLines: string[] = [line];
      index += 1;
      while (
        index < lines.length &&
        lines[index]?.trim() &&
        isRawLatexLine(lines[index]!.trim()) &&
        !parseHeadingLine(lines[index]!.trim()) &&
        !listBeginPattern.test(lines[index]!.trim()) &&
        !mathBeginPattern.test(lines[index]!.trim())
      ) {
        rawLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ type: "raw", text: rawLines.join("\n") });
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      const nextTrimmed = nextLine.trim();
      if (
        !nextTrimmed ||
        parseHeadingLine(nextTrimmed) ||
        listBeginPattern.test(nextTrimmed) ||
        mathBeginPattern.test(nextTrimmed) ||
        nextTrimmed === "\\[" ||
        isRawLatexLine(nextTrimmed)
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

export function serializeVisualLatexBlocks(
  blocks: readonly VisualLatexBlock[],
): string {
  return blocks.flatMap(blockToLines).join("\n");
}

export function VisualLatexEditor({
  content,
  readOnly = false,
  onChange,
}: VisualLatexEditorProps) {
  const [blocks, setBlocks] = useState(() => parseLatexToVisualBlocks(content));
  const serializedRef = useRef(content.replace(/\r\n?/g, "\n"));

  useEffect(() => {
    const normalized = content.replace(/\r\n?/g, "\n");
    if (normalized === serializedRef.current) {
      return;
    }
    serializedRef.current = normalized;
    setBlocks(parseLatexToVisualBlocks(normalized));
  }, [content]);

  const commitBlocks = (nextBlocks: VisualLatexBlock[]) => {
    const nextContent = serializeVisualLatexBlocks(nextBlocks);
    serializedRef.current = nextContent;
    setBlocks(nextBlocks);
    onChange(nextContent);
  };

  const updateBlock = (blockIndex: number, patch: Partial<VisualLatexBlock>) => {
    commitBlocks(
      blocks.map((block, index) =>
        index === blockIndex ? ({ ...block, ...patch } as VisualLatexBlock) : block,
      ),
    );
  };

  const updateListItem = (blockIndex: number, itemIndex: number, value: string) => {
    commitBlocks(
      blocks.map((block, index) => {
        if (index !== blockIndex || block.type !== "list") {
          return block;
        }
        const items = block.items.map((item, nextItemIndex) =>
          nextItemIndex === itemIndex ? value : item,
        );
        return { ...block, items };
      }),
    );
  };

  return (
    <div className="visual-latex-editor" aria-label="Visual LaTeX editor">
      <div className="visual-latex-page">
        {blocks.map((block, index) => {
          if (block.type === "blank") {
            return <div key={`blank-${index}`} className="visual-latex-spacer" />;
          }

          if (block.type === "heading") {
            return (
              <div key={`heading-${index}`} className="visual-latex-heading-row">
                <input
                  className={`visual-latex-heading level-${block.level}`}
                  aria-label={`${block.command} title`}
                  value={block.text}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateBlock(index, { text: event.currentTarget.value })
                  }
                />
                {block.label ? (
                  <span className="visual-latex-label">{block.label}</span>
                ) : null}
              </div>
            );
          }

          if (block.type === "paragraph") {
            return (
              <textarea
                key={`paragraph-${index}`}
                className="visual-latex-paragraph"
                aria-label="Paragraph"
                value={block.text}
                readOnly={readOnly}
                rows={textareaRows(block.text)}
                onChange={(event) =>
                  updateBlock(index, { text: event.currentTarget.value })
                }
              />
            );
          }

          if (block.type === "list") {
            const ListTag = block.environment === "enumerate" ? "ol" : "ul";
            return (
              <ListTag key={`list-${index}`} className="visual-latex-list">
                {block.items.map((item, itemIndex) => (
                  <li key={`${index}-${itemIndex}`}>
                    <textarea
                      className="visual-latex-list-item"
                      aria-label="List item"
                      value={item}
                      readOnly={readOnly}
                      rows={textareaRows(item)}
                      onChange={(event) =>
                        updateListItem(index, itemIndex, event.currentTarget.value)
                      }
                    />
                  </li>
                ))}
              </ListTag>
            );
          }

          if (block.type === "math") {
            return (
              <textarea
                key={`math-${index}`}
                className="visual-latex-math"
                aria-label="Equation"
                value={block.text}
                readOnly={readOnly}
                rows={Math.max(2, textareaRows(block.text))}
                onChange={(event) =>
                  updateBlock(index, { text: event.currentTarget.value })
                }
              />
            );
          }

          return (
            <textarea
              key={`raw-${index}`}
              className="visual-latex-raw"
              aria-label="LaTeX source block"
              value={block.text}
              readOnly={readOnly}
              rows={textareaRows(block.text)}
              onChange={(event) =>
                updateBlock(index, { text: event.currentTarget.value })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function parseHeadingLine(line: string): VisualLatexBlock | null {
  const match = line.match(
    /^\\(section|subsection|subsubsection|paragraph)(\*)?\{([^{}]*)\}(?:\s*\\label\{([^}]*)\})?\s*$/,
  );
  if (!match) {
    return null;
  }
  const command = match[1] as HeadingCommand;
  return {
    type: "heading",
    command,
    level: headingLevels[command],
    starred: Boolean(match[2]),
    text: match[3] ?? "",
    label: match[4] ?? "",
  };
}

function parseListBlock(
  lines: readonly string[],
  startIndex: number,
  environment: ListEnvironment,
): { block: VisualLatexBlock; nextIndex: number } {
  const items: string[] = [];
  let currentItem: string[] | null = null;
  let index = startIndex + 1;

  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === `\\end{${environment}}`) {
      if (currentItem) {
        items.push(currentItem.join("\n"));
      }
      return {
        block: { type: "list", environment, items: items.length ? items : [""] },
        nextIndex: index + 1,
      };
    }

    const itemMatch = line.match(/^\s*\\item(?:\s+(.*))?$/);
    if (itemMatch) {
      if (currentItem) {
        items.push(currentItem.join("\n"));
      }
      currentItem = [itemMatch[1] ?? ""];
      continue;
    }

    if (currentItem) {
      currentItem.push(line.replace(/^\s{0,4}/, ""));
    }
  }

  return {
    block: { type: "raw", text: lines.slice(startIndex).join("\n") },
    nextIndex: lines.length,
  };
}

function parseMathEnvironment(
  lines: readonly string[],
  startIndex: number,
  environment: MathEnvironment,
): { block: VisualLatexBlock; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === `\\end{${environment}}`) {
      return {
        block: { type: "math", environment, text: content.join("\n") },
        nextIndex: index + 1,
      };
    }
    content.push(line);
  }
  return {
    block: { type: "raw", text: lines.slice(startIndex).join("\n") },
    nextIndex: lines.length,
  };
}

function parseDisplayMathBlock(
  lines: readonly string[],
  startIndex: number,
): { block: VisualLatexBlock; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "\\]") {
      return {
        block: { type: "math", environment: "display", text: content.join("\n") },
        nextIndex: index + 1,
      };
    }
    content.push(line);
  }
  return {
    block: { type: "raw", text: lines.slice(startIndex).join("\n") },
    nextIndex: lines.length,
  };
}

function isRawLatexLine(line: string): boolean {
  if (line.startsWith("%")) {
    return true;
  }
  return /^\\(documentclass|usepackage|begin|end|title|author|date|maketitle|bibliography|bibliographystyle|input|include|label|newcommand|renewcommand|def)\b/.test(
    line,
  );
}

function blockToLines(block: VisualLatexBlock): string[] {
  if (block.type === "blank") {
    return [""];
  }
  if (block.type === "heading") {
    return [
      `\\${block.command}${block.starred ? "*" : ""}{${block.text}}${
        block.label ? `\\label{${block.label}}` : ""
      }`,
    ];
  }
  if (block.type === "paragraph" || block.type === "raw") {
    return block.text.split("\n");
  }
  if (block.type === "list") {
    return [
      `\\begin{${block.environment}}`,
      ...block.items.flatMap((item) => {
        const [firstLine = "", ...rest] = item.split("\n");
        return [`  \\item ${firstLine}`, ...rest.map((line) => `  ${line}`)];
      }),
      `\\end{${block.environment}}`,
    ];
  }
  if (block.environment === "display") {
    return ["\\[", ...block.text.split("\n"), "\\]"];
  }
  return [
    `\\begin{${block.environment}}`,
    ...block.text.split("\n"),
    `\\end{${block.environment}}`,
  ];
}

function textareaRows(value: string): number {
  return Math.max(1, value.split("\n").length);
}
