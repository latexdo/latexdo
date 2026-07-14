export function wordColumn(
  lineContent: string,
  word: string | undefined,
  preferredColumn: number,
): { column: number; length: number } {
  if (!word) {
    return { column: Math.max(1, preferredColumn), length: 0 };
  }

  const matches: number[] = [];
  let index = lineContent.indexOf(word);
  while (index >= 0) {
    matches.push(index);
    index = lineContent.indexOf(word, index + word.length);
  }
  if (!matches.length) {
    return { column: Math.max(1, preferredColumn), length: 0 };
  }

  const preferredIndex = Math.max(0, preferredColumn - 1);
  const nearest = matches.reduce((best, candidate) =>
    Math.abs(candidate - preferredIndex) < Math.abs(best - preferredIndex)
      ? candidate
      : best,
  );
  return { column: nearest + 1, length: word.length };
}
