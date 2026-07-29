export interface MathAtPosition {
  /** TeX body without the delimiters. */
  tex: string;
  /** Exact source range, including delimiters or environment wrappers. */
  sourceTex: string;
  /** TeX passed to MathJax. Environment math keeps its wrapper here. */
  renderTex: string;
  display: boolean;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

const displayEnvironments = [
  "equation",
  "equation*",
  "displaymath",
  "displaymath*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "xalignat",
  "xalignat*",
  "xxalignat",
  "xxalignat*",
  "gather",
  "gather*",
  "gathered",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "aligned",
  "alignedat",
  "split",
  "cases",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
];

const environmentsWithLeadingArgument = new Set([
  "alignat",
  "alignat*",
  "xalignat",
  "xalignat*",
  "xxalignat",
  "xxalignat*",
  "alignedat",
]);

interface OffsetRange {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  display: boolean;
  includeDelimiters: boolean;
}

function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

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
      if (depth === 0) {
        return cursor + 1;
      }
    }
  }
  return index;
}

function environmentBodyStart(
  text: string,
  index: number,
  environment: string,
): number {
  let cursor = index;
  while (/\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }

  if (text[cursor] === "[") {
    const next = skipBalancedGroup(text, cursor);
    if (next > cursor) {
      cursor = next;
      while (/\s/.test(text[cursor] ?? "")) {
        cursor += 1;
      }
    }
  }

  if (environmentsWithLeadingArgument.has(environment) && text[cursor] === "{") {
    const next = skipBalancedGroup(text, cursor);
    if (next > cursor) {
      cursor = next;
    }
  }

  return cursor;
}

function findDelimitedRanges(text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];

  const pairs: Array<{ open: string; close: string; display: boolean }> = [
    { open: "\\[", close: "\\]", display: true },
    { open: "\\(", close: "\\)", display: false },
  ];
  for (const { open, close, display } of pairs) {
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(open, cursor);
      if (start === -1) break;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      ranges.push({
        start,
        end: end + close.length,
        bodyStart: start + open.length,
        bodyEnd: end,
        display,
        includeDelimiters: false,
      });
      cursor = end + close.length;
    }
  }

  for (const environment of displayEnvironments) {
    const open = `\\begin{${environment}}`;
    const close = `\\end{${environment}}`;
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(open, cursor);
      if (start === -1) break;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      const bodyStart = environmentBodyStart(text, start + open.length, environment);
      ranges.push({
        start,
        end: end + close.length,
        bodyStart,
        bodyEnd: end,
        display: true,
        includeDelimiters: true,
      });
      cursor = end + close.length;
    }
  }

  // Inline/display dollar math, skipping escaped \$ occurrences.
  const dollarPositions: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "$" && !isEscapedAt(text, index)) {
      dollarPositions.push(index);
    }
  }
  let cursor = 0;
  while (cursor < dollarPositions.length - 1) {
    const start = dollarPositions[cursor];
    const doubled = dollarPositions[cursor + 1] === start + 1;
    if (doubled) {
      // $$ ... $$
      const closeIndex = dollarPositions.findIndex(
        (position, index) =>
          index > cursor + 1 && dollarPositions[index + 1] === position + 1,
      );
      if (closeIndex === -1) break;
      ranges.push({
        start,
        end: dollarPositions[closeIndex + 1] + 1,
        bodyStart: start + 2,
        bodyEnd: dollarPositions[closeIndex],
        display: true,
        includeDelimiters: false,
      });
      cursor = closeIndex + 2;
      continue;
    }
    ranges.push({
      start,
      end: dollarPositions[cursor + 1] + 1,
      bodyStart: start + 1,
      bodyEnd: dollarPositions[cursor + 1],
      display: false,
      includeDelimiters: false,
    });
    cursor += 2;
  }

  return ranges;
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

/**
 * Finds the math expression (inline or display) containing the given
 * 1-based line and column, or null when the position is not inside math.
 */
export function parseMathAtPosition(
  text: string,
  line: number,
  column: number,
): MathAtPosition | null {
  const lines = text.split("\n");
  const offset = offsetOf(lines, line, column);
  const candidates = findDelimitedRanges(text)
    .filter((range) => offset >= range.start && offset <= range.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start));

  const range = candidates[0];
  if (!range) return null;

  const tex = text.slice(range.bodyStart, range.bodyEnd).trim();
  if (!tex) return null;
  const sourceTex = text.slice(range.start, range.end).trim();

  const startPosition = positionOf(lines, range.start);
  const endPosition = positionOf(lines, range.end);
  return {
    tex,
    sourceTex,
    renderTex: range.includeDelimiters
      ? text.slice(range.start, range.end).trim()
      : tex,
    display: range.display,
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
  };
}
