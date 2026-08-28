import * as monaco from "monaco-editor";
import type { LatexIndex } from "./latexIndex";
import { getLatexCompletionContext } from "./completionContext";
import {
  citationCompletionDetail,
  citationCompletionFilterText,
  citationCompletionMarkdown,
  citationCompletionSortText,
  citationCompletionTriggerCharacters,
  rankedCitationCompletions,
} from "./citationCompletion";

export function registerLatexCompletions(getIndex: () => LatexIndex) {
  return monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: citationCompletionTriggerCharacters,
    provideCompletionItems(model, position) {
      const lineText = model.getLineContent(position.lineNumber);
      const context = getLatexCompletionContext(lineText, position.column);
      if (!context) {
        return { suggestions: [] };
      }
      const index = getIndex();
      const range = new monaco.Range(
        position.lineNumber,
        context.rangeStartColumn,
        position.lineNumber,
        context.rangeEndColumn,
      );
      if (context.type === "citation") {
        return {
          suggestions: rankedCitationCompletions(
            index.citations,
            context.currentText,
          ).map((entry) => ({
            label: entry.key,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: entry.key,
            range,
            detail: citationCompletionDetail(entry),
            filterText: citationCompletionFilterText(entry),
            sortText: citationCompletionSortText(entry, context.currentText),
            documentation: {
              value: citationCompletionMarkdown(entry),
            },
          })),
          incomplete: true,
        };
      }
      return {
        suggestions: index.labels.map((label) => ({
          label: label.key,
          kind: monaco.languages.CompletionItemKind.Reference,
          insertText: label.key,
          range,
          detail: [label.kind, label.sourceFile, `line ${label.line}`].join(" · "),
          documentation: {
            value: [
              label.caption ? `**Caption:** ${label.caption}` : undefined,
              label.title ? `**Section:** ${label.title}` : undefined,
              "",
              `Source: \`${label.sourceFile}:${label.line}\``,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        })),
      };
    },
  });
}
