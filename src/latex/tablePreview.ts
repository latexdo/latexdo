export type TableColumnAlignment = "left" | "center" | "right" | "justify";

export interface TablePreviewCell {
  text: string;
  /** Number of grid columns the cell spans (\multicolumn). */
  span: number;
  /** Alignment override coming from \multicolumn, when present. */
  alignment: TableColumnAlignment | null;
}

export interface TablePreviewRow {
  cells: TablePreviewCell[];
  header: boolean;
}

export interface TablePreviewAtPosition {
  /** Outermost table-ish environment the position sits in. */
  environment: string;
  /** Inner grid environment (tabular & friends), when one was found. */
  gridEnvironment: string | null;
  /** Exact source range of the environment, wrappers included. */
  sourceTex: string;
  caption: string | null;
  label: string | null;
  columns: TableColumnAlignment[];
  rows: TablePreviewRow[];
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Float-style wrappers that carry the caption and label. */
const containerEnvironments = new Set([
  "table",
  "table*",
  "sidewaystable",
  "sidewaystable*",
  "subtable",
  "threeparttable",
  "wraptable",
]);

/** Environments that hold the actual cell grid. */
const gridEnvironments = new Set([
  "tabular",
  "tabular*",
  "tabularx",
  "tabulary",
  "longtable",
  "xltabular",
  "supertabular",
  "ltablex",
]);

/** Grid environments whose first mandatory argument is a width, not a spec. */
const gridEnvironmentsWithWidth = new Set([
  "tabular*",
  "tabularx",
  "tabulary",
  "xltabular",
]);

/** Row-level rules and layout directives that never produce cells. */
const rowNoiseCommands = [
  "hline",
  "toprule",
  "midrule",
  "bottomrule",
  "addlinespace",
  "endhead",
  "endfirsthead",
  "endfoot",
  "endlastfoot",
  "tabularnewline",
  "centering",
  "raggedright",
  "raggedleft",
  "small",
  "footnotesize",
  "scriptsize",
  "normalsize",
  "large",
  "Large",
  "bfseries",
  "itshape",
  "ttfamily",
  "rmfamily",
  "sffamily",
  "bf",
  "it",
  "tt",
  "rm",
  "sf",
  "sc",
];

/** Commands whose last mandatory argument is the visible cell text. */
const textMacros: Record<string, number> = {
  textbf: 1,
  textit: 1,
  texttt: 1,
  textsc: 1,
  textrm: 1,
  textsf: 1,
  textsl: 1,
  textup: 1,
  textmd: 1,
  textnormal: 1,
  text: 1,
  emph: 1,
  underline: 1,
  mathbf: 1,
  mathrm: 1,
  mathit: 1,
  mathsf: 1,
  boldsymbol: 1,
  textsuperscript: 1,
  textsubscript: 1,
  makecell: 1,
  thead: 1,
  tabincell: 2,
  textcolor: 2,
  multirow: 3,
  parbox: 2,
  minipage: 2,
};

/** Commands that are dropped together with all of their arguments. */
const droppedMacros: Record<string, number> = {
  cline: 1,
  cmidrule: 1,
  rowcolor: 1,
  cellcolor: 1,
  columncolor: 1,
  label: 1,
  noalign: 1,
  arrayrulecolor: 1,
  rule: 2,
  vspace: 1,
  hspace: 1,
  addlinespace: 1,
};

const escapedCharacters: Record<string, string> = {
  "\\%": "%",
  "\\&": "&",
  "\\_": "_",
  "\\#": "#",
  "\\$": "$",
  "\\{": "{",
  "\\}": "}",
};

interface EnvironmentRange {
  name: string;
  /** Offset of `\begin{...}`. */
  start: number;
  /** Offset just past `\end{...}`. */
  end: number;
  /** Offset just past `\begin{...}`, arguments not consumed yet. */
  headerStart: number;
  /** Offset of `\end{...}`. */
  bodyEnd: number;
}

function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

/** Returns the offset just past the balanced group starting at `index`. */
function skipBalancedGroup(text: string, index: number): number {
  const open = text[index];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return index;

  let depth = 0;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === open && !isEscapedAt(text, cursor)) {
      depth += 1;
    } else if (char === close && !isEscapedAt(text, cursor)) {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return index;
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

/**
 * Collects every `\begin{...}`/`\end{...}` pair in the text, honouring
 * nesting so a tabular inside a tabular resolves to the right partner.
 */
function scanEnvironments(text: string): EnvironmentRange[] {
  const ranges: EnvironmentRange[] = [];
  const stack: Array<{ name: string; start: number; headerStart: number }> = [];
  const pattern = /\\(begin|end)\s*\{([^}]*)\}/g;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (isEscapedAt(text, match.index)) continue;
    const [full, kind, name] = match;
    if (kind === "begin") {
      stack.push({
        name,
        start: match.index,
        headerStart: match.index + full.length,
      });
      continue;
    }
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].name !== name) continue;
      const open = stack[index];
      stack.length = index;
      ranges.push({
        name,
        start: open.start,
        end: match.index + full.length,
        headerStart: open.headerStart,
        bodyEnd: match.index,
      });
      break;
    }
  }

  return ranges;
}

interface GridHeader {
  columns: TableColumnAlignment[];
  bodyStart: number;
}

/**
 * Consumes the optional placement argument, an optional width argument and
 * the column specification that follow `\begin{tabular}`.
 */
function parseGridHeader(text: string, range: EnvironmentRange): GridHeader {
  let cursor = skipWhitespace(text, range.headerStart);
  let expectedGroups = gridEnvironmentsWithWidth.has(range.name) ? 2 : 1;
  let spec = "";

  while (cursor < range.bodyEnd) {
    const char = text[cursor];
    if (char === "[") {
      const next = skipBalancedGroup(text, cursor);
      if (next === cursor) break;
      cursor = skipWhitespace(text, next);
      continue;
    }
    if (char === "{") {
      const next = skipBalancedGroup(text, cursor);
      if (next === cursor) break;
      expectedGroups -= 1;
      if (expectedGroups === 0) {
        spec = text.slice(cursor + 1, next - 1);
        cursor = next;
        break;
      }
      cursor = skipWhitespace(text, next);
      continue;
    }
    break;
  }

  return { columns: parseColumnSpec(spec), bodyStart: cursor };
}

/** Turns a column specification such as `|l|c|p{3cm}|` into alignments. */
export function parseColumnSpec(spec: string): TableColumnAlignment[] {
  const columns: TableColumnAlignment[] = [];
  let cursor = 0;

  while (cursor < spec.length) {
    const char = spec[cursor];
    if (/[\s|]/.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === "@" || char === "!" || char === ">" || char === "<") {
      const next = skipBalancedGroup(spec, skipWhitespace(spec, cursor + 1));
      cursor = next > cursor ? next : cursor + 1;
      continue;
    }
    if (char === "*") {
      const countStart = skipWhitespace(spec, cursor + 1);
      const countEnd = skipBalancedGroup(spec, countStart);
      const subStart = skipWhitespace(spec, countEnd);
      const subEnd = skipBalancedGroup(spec, subStart);
      if (countEnd === countStart || subEnd === subStart) {
        cursor += 1;
        continue;
      }
      const count = Number.parseInt(
        spec.slice(countStart + 1, countEnd - 1).trim(),
        10,
      );
      const repeated = parseColumnSpec(spec.slice(subStart + 1, subEnd - 1));
      for (let index = 0; index < (Number.isFinite(count) ? count : 0); index += 1) {
        columns.push(...repeated);
      }
      cursor = subEnd;
      continue;
    }
    if (char === "l") {
      columns.push("left");
      cursor += 1;
      continue;
    }
    if (char === "c") {
      columns.push("center");
      cursor += 1;
      continue;
    }
    if (char === "r" || char === "S") {
      columns.push("right");
      cursor += 1;
      continue;
    }
    if (char === "p" || char === "m" || char === "b") {
      const next = skipBalancedGroup(spec, skipWhitespace(spec, cursor + 1));
      columns.push("justify");
      cursor = next > cursor ? next : cursor + 1;
      continue;
    }
    if (char === "X" || char === "Y" || char === "L" || char === "R" || char === "C") {
      columns.push(char === "R" ? "right" : char === "C" ? "center" : "justify");
      cursor += 1;
      continue;
    }
    if (char === "\\") {
      // Unknown macro inside the spec: skip the command name.
      cursor += 1;
      while (cursor < spec.length && /[a-zA-Z]/.test(spec[cursor])) cursor += 1;
      continue;
    }
    cursor += 1;
  }

  return columns;
}

/** Strips `%` comments while keeping escaped percent signs intact. */
function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] === "%" && !isEscapedAt(line, index)) {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

function alignmentFromMulticolumnSpec(spec: string): TableColumnAlignment | null {
  return parseColumnSpec(spec)[0] ?? null;
}

/** Reads `\command` plus `count` balanced arguments starting at `index`. */
function readMacroArguments(
  text: string,
  index: number,
  count: number,
): { args: string[]; end: number } | null {
  const args: string[] = [];
  let cursor = index;
  for (let taken = 0; taken < count; taken += 1) {
    cursor = skipWhitespace(text, cursor);
    if (text[cursor] === "[") {
      const optionalEnd = skipBalancedGroup(text, cursor);
      if (optionalEnd === cursor) return null;
      cursor = skipWhitespace(text, optionalEnd);
    }
    if (text[cursor] !== "{") return null;
    const end = skipBalancedGroup(text, cursor);
    if (end === cursor) return null;
    args.push(text.slice(cursor + 1, end - 1));
    cursor = end;
  }
  return { args, end: cursor };
}

/** Reduces LaTeX markup in a cell to readable plain text. */
export function cellPlainText(source: string): string {
  let text = source;

  for (let pass = 0; pass < 6; pass += 1) {
    const next = reduceCellMacros(text);
    if (next === text) break;
    text = next;
  }

  for (const [escaped, plain] of Object.entries(escapedCharacters)) {
    text = text.split(escaped).join(plain);
  }
  text = text
    .replace(/\\[,;:! ]/g, " ")
    .replace(/~/g, " ")
    .replace(/\$+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function reduceCellMacros(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const char = text[cursor];
    if (char !== "\\" || isEscapedAt(text, cursor)) {
      result += char;
      cursor += 1;
      continue;
    }

    const nameMatch = /^\\([a-zA-Z]+)\*?/.exec(text.slice(cursor));
    if (!nameMatch) {
      result += char;
      cursor += 1;
      continue;
    }

    const name = nameMatch[1];
    const afterName = cursor + nameMatch[0].length;

    const dropped = droppedMacros[name];
    if (dropped !== undefined) {
      const read = readMacroArguments(text, afterName, dropped);
      cursor = read ? read.end : afterName;
      continue;
    }

    const arity = textMacros[name];
    if (arity !== undefined) {
      const read = readMacroArguments(text, afterName, arity);
      if (read) {
        result += ` ${read.args[read.args.length - 1]} `;
        cursor = read.end;
        continue;
      }
    }

    if (rowNoiseCommands.includes(name)) {
      cursor = afterName;
      continue;
    }

    result += nameMatch[0];
    cursor = afterName;
  }

  return result;
}

function splitRowCells(row: string): string[] {
  const cells: string[] = [];
  let depth = 0;
  let start = 0;

  for (let cursor = 0; cursor < row.length; cursor += 1) {
    const char = row[cursor];
    if (isEscapedAt(row, cursor)) continue;
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === "&" && depth === 0) {
      cells.push(row.slice(start, cursor));
      start = cursor + 1;
    }
  }
  cells.push(row.slice(start));
  return cells;
}

interface RawRow {
  source: string;
  /** True when a horizontal rule follows this row. */
  ruleAfter: boolean;
}

/** Splits a tabular body into rows on top-level `\\` separators. */
function splitBodyRows(body: string): RawRow[] {
  const chunks: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let start = 0;
  let cursor = 0;

  while (cursor < body.length) {
    const char = body[cursor];
    if (char === "{" && !isEscapedAt(body, cursor)) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === "}" && !isEscapedAt(body, cursor)) {
      depth = Math.max(0, depth - 1);
      cursor += 1;
      continue;
    }
    if (char === "\\") {
      const rest = body.slice(cursor);
      const beginMatch = /^\\begin\s*\{/.exec(rest);
      if (beginMatch) {
        envDepth += 1;
        cursor += beginMatch[0].length;
        continue;
      }
      const endMatch = /^\\end\s*\{/.exec(rest);
      if (endMatch) {
        envDepth = Math.max(0, envDepth - 1);
        cursor += endMatch[0].length;
        continue;
      }
      const breakMatch = /^(\\\\\*?|\\tabularnewline)(\s*\[[^\]]*\])?/.exec(rest);
      if (breakMatch && depth === 0 && envDepth === 0) {
        chunks.push(body.slice(start, cursor));
        cursor += breakMatch[0].length;
        start = cursor;
        continue;
      }
      // Any other command: skip the escape so `\&` is not mistaken for a break.
      cursor += 2;
      continue;
    }
    cursor += 1;
  }
  chunks.push(body.slice(start));

  const rows: RawRow[] = [];
  for (const chunk of chunks) {
    const withoutRules = stripLeadingRules(chunk);
    // A rule opening this chunk visually closes the previous row, which is how
    // booktabs marks the end of a header block.
    if ((withoutRules.leadingRule || !withoutRules.content.trim()) && rows.length) {
      rows[rows.length - 1].ruleAfter = true;
    }
    if (!withoutRules.content.trim()) continue;
    rows.push({ source: withoutRules.content, ruleAfter: withoutRules.trailingRule });
  }

  return rows;
}

const rulePattern = new RegExp(
  `^\\s*(\\\\(?:${rowNoiseCommands.join("|")})\\b\\*?|\\\\(?:cline|cmidrule|noalign|rowcolor|arrayrulecolor)\\s*(\\([^)]*\\))?(\\[[^\\]]*\\])?(\\{[^{}]*\\})?)`,
);

const horizontalRulePattern =
  /^\s*\\(?:hline|toprule|midrule|bottomrule|cline|cmidrule)\b/;

function stripLeadingRules(chunk: string): {
  content: string;
  leadingRule: boolean;
  trailingRule: boolean;
} {
  let content = chunk;
  let leadingRule = false;
  let matched = rulePattern.exec(content);
  while (matched) {
    // Font and alignment switches are stripped too, but only actual rules say
    // anything about where a header block ends.
    if (horizontalRulePattern.test(matched[0])) leadingRule = true;
    content = content.slice(matched[0].length);
    matched = rulePattern.exec(content);
  }

  let trailingRule = false;
  let trimmed = content.replace(/\s+$/, "");
  const trailingPattern =
    /(\\(?:hline|toprule|midrule|bottomrule|addlinespace)\b\*?|\\(?:cline|cmidrule)\s*(\([^)]*\))?(\[[^\]]*\])?(\{[^{}]*\})?)\s*$/;
  let trailing = trailingPattern.exec(trimmed);
  while (trailing) {
    trailingRule = true;
    trimmed = trimmed.slice(0, trailing.index).replace(/\s+$/, "");
    trailing = trailingPattern.exec(trimmed);
  }

  return { content: trimmed, leadingRule, trailingRule };
}

function parseRowCells(row: string): TablePreviewCell[] {
  return splitRowCells(row).map((rawCell) => {
    const multicolumn = /\\multicolumn\s*\{/.exec(rawCell);
    if (multicolumn) {
      const read = readMacroArguments(
        rawCell,
        multicolumn.index + "\\multicolumn".length,
        3,
      );
      if (read) {
        const span = Number.parseInt(read.args[0].trim(), 10);
        return {
          text: cellPlainText(read.args[2]),
          span: Number.isFinite(span) && span > 0 ? span : 1,
          alignment: alignmentFromMulticolumnSpec(read.args[1]),
        };
      }
    }
    return { text: cellPlainText(rawCell), span: 1, alignment: null };
  });
}

function looksLikeHeaderRow(source: string): boolean {
  const cells = splitRowCells(source).filter((cell) => cell.trim());
  if (cells.length < 2) return false;
  return cells.every((cell) => /\\(textbf|bfseries|bf|thead|textsc)\b/.test(cell));
}

/** Extracts `\command{...}` (skipping an optional argument) from the source. */
function extractMacroArgument(source: string, command: string): string | null {
  const pattern = new RegExp(`\\\\${command}\\s*\\*?\\s*(\\[|\\{)`);
  const match = pattern.exec(source);
  if (!match) return null;
  const read = readMacroArguments(source, match.index + match[0].length - 1, 1);
  if (!read) return null;
  return read.args[0];
}

function offsetOf(lines: string[], line: number, column: number): number {
  let offset = 0;
  for (let index = 0; index < line - 1 && index < lines.length; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset + column - 1;
}

function positionOf(lines: string[], offset: number): { line: number; column: number } {
  let remaining = offset;
  for (let index = 0; index < lines.length; index += 1) {
    if (remaining <= lines[index].length) {
      return { line: index + 1, column: remaining + 1 };
    }
    remaining -= lines[index].length + 1;
  }
  const lastLine = Math.max(1, lines.length);
  return { line: lastLine, column: (lines[lastLine - 1]?.length ?? 0) + 1 };
}

function smallestContaining(
  ranges: EnvironmentRange[],
  offset: number,
  accept: (name: string) => boolean,
): EnvironmentRange | null {
  return (
    ranges
      .filter(
        (range) => accept(range.name) && offset >= range.start && offset <= range.end,
      )
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? null
  );
}

/**
 * Finds the table environment containing the given 1-based line and column and
 * parses it into a preview-friendly grid. Returns null outside of tables.
 */
export function parseTableAtPosition(
  text: string,
  line: number,
  column: number,
): TablePreviewAtPosition | null {
  const lines = text.split("\n");
  const offset = offsetOf(lines, line, column);
  const ranges = scanEnvironments(text);

  const grid = smallestContaining(ranges, offset, (name) => gridEnvironments.has(name));
  const container = smallestContaining(ranges, offset, (name) =>
    containerEnvironments.has(name),
  );
  const outer = container ?? grid;
  if (!outer) return null;

  const sourceTex = text.slice(outer.start, outer.end);
  // A float without the cursor inside its grid still previews the first grid
  // it contains, which is what the caption and label describe.
  const effectiveGrid =
    grid ??
    ranges
      .filter(
        (range) =>
          gridEnvironments.has(range.name) &&
          range.start >= outer.start &&
          range.end <= outer.end,
      )
      .sort((a, b) => a.start - b.start)[0] ??
    null;

  let columns: TableColumnAlignment[] = [];
  let rows: TablePreviewRow[] = [];
  if (effectiveGrid) {
    const header = parseGridHeader(text, effectiveGrid);
    columns = header.columns;
    const body = stripComments(text.slice(header.bodyStart, effectiveGrid.bodyEnd));
    const rawRows = splitBodyRows(body);
    rows = rawRows.map((row, index) => ({
      cells: parseRowCells(row.source),
      header:
        looksLikeHeaderRow(row.source) ||
        (index === 0 && rawRows.length > 1 && row.ruleAfter),
    }));
  }

  const captionSource = stripComments(sourceTex);
  const caption = extractMacroArgument(captionSource, "caption");
  const label = extractMacroArgument(captionSource, "label");

  const startPosition = positionOf(lines, outer.start);
  const endPosition = positionOf(lines, outer.end);
  return {
    environment: outer.name,
    gridEnvironment: effectiveGrid?.name ?? null,
    sourceTex: sourceTex.trim(),
    caption: caption ? cellPlainText(caption) || null : null,
    label: label ? label.trim() || null : null,
    columns,
    rows,
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
  };
}

function markdownCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ") || " ";
}

const markdownAlignmentRule: Record<TableColumnAlignment, string> = {
  left: ":---",
  center: ":---:",
  right: "---:",
  justify: ":---",
};

/**
 * Renders the parsed table as GitHub-flavoured Markdown for editor hovers.
 * Returns null when there is nothing worth showing.
 */
export function tablePreviewMarkdown(table: TablePreviewAtPosition): string | null {
  const lines: string[] = [];
  if (table.caption) lines.push(`**${table.caption}**`, "");

  const gridRows = table.rows.filter((row) => row.cells.some((cell) => cell.text));
  if (gridRows.length) {
    const width = Math.max(
      table.columns.length,
      ...gridRows.map((row) => row.cells.reduce((total, cell) => total + cell.span, 0)),
    );
    const expand = (row: TablePreviewRow): string[] => {
      const cells: string[] = [];
      for (const cell of row.cells) {
        cells.push(markdownCell(cell.text));
        for (let extra = 1; extra < cell.span; extra += 1) cells.push(" ");
      }
      while (cells.length < width) cells.push(" ");
      return cells.slice(0, width);
    };

    const [first, ...rest] = gridRows;
    const headerCells = first.header ? expand(first) : new Array(width).fill(" ");
    const bodyRows = first.header ? rest : gridRows;
    lines.push(`| ${headerCells.join(" | ")} |`);
    lines.push(
      `| ${Array.from(
        { length: width },
        (_unused, index) => markdownAlignmentRule[table.columns[index] ?? "left"],
      ).join(" | ")} |`,
    );
    for (const row of bodyRows) {
      lines.push(`| ${expand(row).join(" | ")} |`);
    }
  }

  if (table.label) {
    lines.push("", `\`${table.label}\``);
  }

  if (!lines.length) return null;
  return lines.join("\n");
}
