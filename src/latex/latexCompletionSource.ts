import type { CompletionContext } from "@codemirror/autocomplete";
import type { LatexIndex } from "./latexIndex";
import { getLatexCompletionContext } from "./completionContext";

export function latexCompletionSource(getIndex: () => LatexIndex) {
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const column = context.pos - line.from + 1;
    const latexContext = getLatexCompletionContext(line.text, column);
    if (!latexContext) return null;
    const index = getIndex();
    if (latexContext.type === "citation") {
      return {
        from: line.from + latexContext.rangeStartColumn - 1,
        options: index.citations.map((entry) => ({
          label: entry.key,
          type: "reference",
          detail: [entry.type, entry.author, entry.year].filter(Boolean).join(" · "),
          info: [entry.title, entry.journal, entry.publisher, entry.sourceFile]
            .filter(Boolean)
            .join("\n"),
        })),
      };
    }
    return {
      from: line.from + latexContext.rangeStartColumn - 1,
      options: index.labels.map((label) => ({
        label: label.key,
        type: "reference",
        detail: `${label.kind} · ${label.sourceFile}:${label.line}`,
        info: [label.caption, label.title].filter(Boolean).join("\n"),
      })),
    };
  };
}
