const latexDoReviewCommandPattern =
  /\\(?:reviewercomment|latexdoreviewercomment|rebuttal)\s*\{/;

interface BraceArgument {
  value: string;
  endIndex: number;
}

function skipWhitespace(content: string, index: number): number {
  let cursor = index;
  while (cursor < content.length && /\s/.test(content[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function readBraceArgument(content: string, startIndex: number): BraceArgument | null {
  if (content[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let escaped = false;
  let value = "";

  for (let index = startIndex; index < content.length; index += 1) {
    const character = content[index];

    if (escaped) {
      if (depth >= 1) {
        value += character;
      }
      escaped = false;
      continue;
    }

    if (character === "\\") {
      if (depth >= 1) {
        value += character;
      }
      escaped = true;
      continue;
    }

    if (character === "{") {
      if (depth >= 1) {
        value += character;
      }
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value, endIndex: index + 1 };
      }
      if (depth < 0) {
        return null;
      }
      value += character;
      continue;
    }

    if (depth >= 1) {
      value += character;
    }
  }

  return null;
}

function splitTrailingPunctuation(content: string, index: number): {
  punctuation: string;
  nextIndex: number;
} {
  const whitespaceEnd = skipWhitespace(content, index);
  const nextCharacter = content[whitespaceEnd] ?? "";
  if (/^[.,;:!?]$/.test(nextCharacter)) {
    return {
      punctuation: content.slice(index, whitespaceEnd) + nextCharacter,
      nextIndex: whitespaceEnd + 1,
    };
  }
  return { punctuation: "", nextIndex: index };
}

export function usesLatexDoReviewMacros(content: string): boolean {
  return latexDoReviewCommandPattern.test(content);
}

export function normalizeLatexDoReviewMarkup(content: string): string {
  const command = "\\reviewercomment";
  let output = "";
  let cursor = 0;

  while (cursor < content.length) {
    const commandIndex = content.indexOf(command, cursor);
    if (commandIndex === -1) {
      output += content.slice(cursor);
      break;
    }

    const firstArgumentStart = skipWhitespace(content, commandIndex + command.length);
    const textArgument = readBraceArgument(content, firstArgumentStart);
    if (!textArgument) {
      output += content.slice(cursor, commandIndex + command.length);
      cursor = commandIndex + command.length;
      continue;
    }

    const secondArgumentStart = skipWhitespace(content, textArgument.endIndex);
    const commentArgument = readBraceArgument(content, secondArgumentStart);
    if (!commentArgument) {
      output += content.slice(cursor, commandIndex + command.length);
      cursor = commandIndex + command.length;
      continue;
    }

    const trailing = splitTrailingPunctuation(content, commentArgument.endIndex);
    output += content.slice(cursor, commandIndex);
    output += `${textArgument.value}${trailing.punctuation}\n`;
    output += `\\latexdoreviewercomment{${commentArgument.value}}\n`;
    cursor = trailing.nextIndex;
  }

  return output;
}
