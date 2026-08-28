# Intelligent, Non-Disruptive AI Citation Insertion for LatexDo

## Goal

When a user selects or writes a paragraph, LatexDo should:

1. Detect which bibliography entries best support the claims in that paragraph.
2. Recommend **real keys from the user's `.bib` files only**.
3. Preserve the user's existing citation command/style instead of blindly inserting `\cite{...}`.
4. Avoid changing surrounding prose, punctuation, citation package, or citation conventions.
5. Be conservative: when confidence is weak, recommend candidates instead of silently inserting one.
6. Work consistently from the AI sidebar, the `\cite` slash command, and the knowledge-graph citation UI.

This design builds on code already present in the repository:

- `src/features/graph/citationRecommender.ts` already ranks bibliography entries against passage text.
- `src/latex/citationAnalysis.ts` already extracts citation usages **including the command used** (`citep`, `textcite`, `parencite`, etc.).
- `src/features/ai/aiTools.ts` already exposes `recommend_citations`.
- The application already has project bibliography analysis in `citationAnalysis`.
- The editor completion code already knows several supported citation commands.

The important architectural rule is:

> **The AI chooses the source. Deterministic code chooses the citation syntax and insertion mechanics.**

Do not ask the LLM to invent or normalize LaTeX citation commands.

---

## Current problems

### 1. Recommendations are formatted as `\cite{...}`

`formatRecommendations()` currently renders every result as:

```ts
\cite{key}
```

This leaks a formatting decision into what should only be a relevance-ranking function.

### 2. `insertCitation()` also returns `\cite{...}`

The AI context searches the raw `.bib` content and returns:

```ts
Use \cite{key}
```

Again, the key lookup and citation syntax are coupled.

### 3. Knowledge-graph insertion hardcodes `\cite`

The graph insertion path directly runs:

```ts
text: `\\cite{${key}}`
```

So even if the document consistently uses `\parencite`, `\citep`, `\autocite`, or another command, this path changes the user's style.

### 4. Ranking is primarily lexical

The current recommender is useful as a fast first stage, but it mainly uses:

- title-term overlap;
- exact author surname mentions;
- weak venue overlap.

For a paragraph whose wording differs from the bibliography title, a semantically strong source can rank poorly.

### 5. `citedKeys` is project-wide

Passing every project citation key to a passage-level recommender is too coarse. A source cited in another chapter is not equivalent to a source already cited in the paragraph or nearby sentences.

---

# Proposed architecture

Use a **four-stage pipeline**:

```text
Paragraph
   |
   v
[1] Citation context detector
   |-- existing command near paragraph
   |-- dominant command in active file
   |-- dominant command in project
   |-- package hints
   v
[2] Fast deterministic bibliography retrieval
   |-- title tokens
   |-- authors
   |-- venue
   |-- abstract/keywords if present
   v
[3] AI semantic reranker (top N only)
   |-- claim/source fit
   |-- confidence
   |-- no key invention
   v
[4] Safe insertion planner
   |-- preserve command
   |-- preserve punctuation
   |-- merge with adjacent compatible citation where safe
   |-- otherwise add minimal citation text only
```

The LLM should never receive permission to rewrite the paragraph merely to add a citation.

---

# 1. Add a citation-style resolver

Create:

`src/latex/citationStyle.ts`

```ts
import type { CitationUsage } from "./citationAnalysis";

export type CitationCommand =
  | "cite"
  | "citep"
  | "citet"
  | "citealp"
  | "citeauthor"
  | "citeyear"
  | "citeyearpar"
  | "parencite"
  | "textcite"
  | "autocite"
  | "footcite"
  | "supercite";

export interface CitationStyleContext {
  command: CitationCommand;
  source:
    | "nearby"
    | "selection"
    | "active-file"
    | "project"
    | "package"
    | "fallback";
  confidence: number;
}

const supportedCommands = new Set<CitationCommand>([
  "cite",
  "citep",
  "citet",
  "citealp",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
  "supercite",
]);

function commandCounts(usages: CitationUsage[]): Map<CitationCommand, number> {
  const counts = new Map<CitationCommand, number>();

  for (const usage of usages) {
    const normalized = usage.command.replace(/\*$/, "") as CitationCommand;
    if (!supportedCommands.has(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return counts;
}

function mostCommonCommand(
  usages: CitationUsage[],
): { command: CitationCommand; count: number; total: number } | null {
  const counts = commandCounts(usages);
  if (!counts.size) return null;

  const [command, count] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0];

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return { command, count, total };
}

function citationCommandsInText(text: string): CitationCommand[] {
  const matches = text.matchAll(
    /\\((?:cite|citep|citet|citealp|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|supercite)[a-zA-Z]*\*?)\s*(?:\[[^\]]*\]\s*)*\{/g,
  );

  const result: CitationCommand[] = [];

  for (const match of matches) {
    const command = (match[1] ?? "").replace(/\*$/, "") as CitationCommand;
    if (supportedCommands.has(command)) result.push(command);
  }

  return result;
}

function mostCommonTextCommand(text: string): CitationCommand | null {
  const commands = citationCommandsInText(text);
  if (!commands.length) return null;

  const counts = new Map<CitationCommand, number>();
  for (const command of commands) {
    counts.set(command, (counts.get(command) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function commandFromPackages(documentText: string): CitationCommand | null {
  // natbib conventions
  if (/\\usepackage(?:\[[^\]]*\])?\{natbib\}/.test(documentText)) {
    return "citep";
  }

  // biblatex conventions
  if (
    /\\usepackage(?:\[[^\]]*\])?\{biblatex\}/.test(documentText) ||
    /\\addbibresource\s*\{/.test(documentText)
  ) {
    return "parencite";
  }

  return null;
}

export function resolveCitationStyle(options: {
  selectedText?: string;
  nearbyText?: string;
  activeFilePath?: string | null;
  activeDocumentText?: string;
  usages: CitationUsage[];
}): CitationStyleContext {
  const {
    selectedText = "",
    nearbyText = "",
    activeFilePath,
    activeDocumentText = "",
    usages,
  } = options;

  // 1. Exact local convention wins.
  const nearby = mostCommonTextCommand(nearbyText);
  if (nearby) {
    return { command: nearby, source: "nearby", confidence: 1 };
  }

  // 2. Existing citations inside the selected paragraph.
  const selected = mostCommonTextCommand(selectedText);
  if (selected) {
    return { command: selected, source: "selection", confidence: 0.98 };
  }

  // 3. Dominant style in the active .tex file.
  if (activeFilePath) {
    const activeUsages = usages.filter(
      (usage) => usage.sourceFile === activeFilePath,
    );
    const active = mostCommonCommand(activeUsages);

    if (active) {
      return {
        command: active.command,
        source: "active-file",
        confidence: Math.min(0.95, 0.65 + active.count / Math.max(active.total, 1) * 0.3),
      };
    }
  }

  // 4. Dominant project convention.
  const project = mostCommonCommand(usages);
  if (project) {
    return {
      command: project.command,
      source: "project",
      confidence: Math.min(0.9, 0.55 + project.count / Math.max(project.total, 1) * 0.3),
    };
  }

  // 5. Infer only when no actual citation usage exists.
  const packageCommand = commandFromPackages(activeDocumentText);
  if (packageCommand) {
    return {
      command: packageCommand,
      source: "package",
      confidence: 0.7,
    };
  }

  // 6. Safest universal fallback.
  return {
    command: "cite",
    source: "fallback",
    confidence: 0.45,
  };
}

export function formatCitation(
  command: CitationCommand,
  keys: string[],
): string {
  const cleanKeys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  return `\\${command}{${cleanKeys.join(",")}}`;
}
```

## Why this order?

The nearest user-authored citation is the strongest evidence of intended style.

For example, if the project generally uses `\citep`, but the current section uses `\textcite`, the current section should win.

Do **not** "upgrade" or normalize the user's commands.

---

# 2. Keep the citation recommender syntax-neutral

Update:

`src/features/graph/citationRecommender.ts`

The recommendation object should represent a bibliography source, not preformatted LaTeX.

Keep:

```ts
export interface CitationRecommendation {
  key: string;
  score: number;
  reasons: string[];
  entry: CitationEntry;
  alreadyCited: boolean;
}
```

Change the formatter from this conceptual form:

```ts
return `${index + 1}. \\cite{${rec.key}} ...`;
```

to:

```ts
export function formatRecommendations(
  recommendations: CitationRecommendation[],
): string {
  if (recommendations.length === 0) {
    return "No matching references found in the bibliography for this passage.";
  }

  return recommendations
    .map((rec, index) => {
      const title = rec.entry.title ?? "(untitled)";
      const cited = rec.alreadyCited ? " [already cited]" : "";
      const reasons = rec.reasons.length
        ? ` — ${rec.reasons.join("; ")}`
        : "";

      return `${index + 1}. key=${rec.key} (score ${rec.score})${cited}\n   ${title}${reasons}`;
    })
    .join("\n");
}
```

Even better: eventually return structured JSON to the agent rather than prose.

Example:

```ts
JSON.stringify(
  recommendations.map((rec) => ({
    key: rec.key,
    score: rec.score,
    alreadyCited: rec.alreadyCited,
    title: rec.entry.title,
    author: rec.entry.author,
    year: rec.entry.year,
    reasons: rec.reasons,
  })),
)
```

This prevents the model from treating `\cite` as part of the recommendation.

---

# 3. Use local cited keys, not all project cited keys

The current call supplies project-wide `citationAnalysis.citedKeys`.

Instead, derive keys from the selected paragraph / nearby text.

Add to `citationAnalysis.ts`:

```ts
export function citationKeysInText(content: string): string[] {
  return [
    ...new Set(
      extractCitationUsages(content, "__inline__").map((usage) => usage.key),
    ),
  ];
}
```

Then:

```ts
const locallyCitedKeys = citationKeysInText(text);

const recommendations = recommendCitations(
  text,
  citationAnalysis.entries,
  {
    citedKeys: locallyCitedKeys,
    limit: 6,
  },
);
```

This makes `alreadyCited` mean "already supports this passage" rather than merely "appears somewhere in the paper."

---

# 4. Improve first-stage retrieval

The deterministic scorer should remain because it is:

- fast;
- offline;
- testable;
- predictable;
- useful for narrowing hundreds/thousands of `.bib` entries.

But improve its candidate recall.

## Extend the text indexed for an entry

If `CitationEntry` / `parseBibFile` supports these fields, include:

```ts
abstract?: string;
keywords?: string;
note?: string;
```

Then score overlap across weighted fields:

```ts
title:    1.00
abstract: 0.45
keywords: 0.70
author:   special exact-name boost
venue:    0.15
```

Use the deterministic scorer to retrieve the top 20-30 entries, not necessarily to make the final semantic decision.

Do not send an entire 5,000-entry bibliography to an LLM.

---

# 5. Add AI semantic reranking

For the best user experience, AI should rerank only the deterministic shortlist.

## New tool/result contract

Instead of asking the model to directly edit the paragraph, create an internal semantic ranking step.

Input:

```ts
export interface SemanticCitationCandidate {
  key: string;
  title?: string;
  author?: string;
  year?: string;
  venue?: string;
  abstract?: string;
  deterministicScore: number;
}

export interface SemanticCitationDecision {
  key: string;
  confidence: number; // 0..1
  relation:
    | "direct-support"
    | "method"
    | "background"
    | "comparison"
    | "contradiction"
    | "weak";
  reason: string;
}
```

Prompt the AI with:

```text
You are ranking ONLY the supplied bibliography candidates for the supplied
paragraph.

Rules:
- Never create a citation key.
- Return only keys that appear in candidates.
- Judge whether the work actually supports a claim in the paragraph.
- Prefer direct support over merely sharing vocabulary.
- Do not choose a source only because an author or keyword is mentioned.
- A result with uncertain relevance must have confidence below 0.65.
- Return JSON only.

Paragraph:
...

Candidates:
...
```

Expected response:

```json
{
  "recommendations": [
    {
      "key": "vaswani2017",
      "confidence": 0.94,
      "relation": "background",
      "reason": "Introduces the Transformer architecture discussed in the sentence."
    }
  ]
}
```

## Validate the response

Never trust generated keys.

```ts
const allowed = new Set(candidates.map((candidate) => candidate.key));

const safeRecommendations = modelRecommendations.filter(
  (recommendation) =>
    allowed.has(recommendation.key) &&
    Number.isFinite(recommendation.confidence) &&
    recommendation.confidence >= 0 &&
    recommendation.confidence <= 1,
);
```

---

# 6. Confidence policy

A citation system should be conservative.

Suggested thresholds:

```ts
confidence >= 0.82
```

Strong candidate. May be inserted automatically **only if the user explicitly invoked an insertion action or auto-edit mode permits it**.

```ts
0.65 <= confidence < 0.82
```

Show as a recommendation. Do not silently insert.

```ts
confidence < 0.65
```

Do not insert. Optionally show under "Possible references."

Also apply a **margin test**:

```ts
top1.confidence - top2.confidence >= 0.08
```

If two sources are nearly tied, prefer showing both rather than pretending one is definitively best.

---

# 7. Add a safe insertion planner

Create:

`src/latex/citationInsertion.ts`

The planner should make only the smallest possible edit.

```ts
import {
  formatCitation,
  type CitationCommand,
} from "./citationStyle";

export interface CitationInsertionPlan {
  text: string;
  command: CitationCommand;
  keys: string[];
  mode: "append" | "merge-existing";
}
```

## Basic insertion

If no compatible citation is adjacent:

```ts
export function buildCitationInsertion(
  command: CitationCommand,
  keys: string[],
): string {
  return formatCitation(command, keys);
}
```

The editor layer decides where the insertion goes.

For a paragraph/sentence-end action, normally insert before terminal punctuation:

```text
Original:
Transformers replace recurrent computation with self-attention.

Result:
Transformers replace recurrent computation with self-attention \citep{vaswani2017}.
```

not:

```text
Transformers replace recurrent computation with self-attention. \citep{vaswani2017}
```

But do not globally rewrite punctuation. Only adjust the insertion point when it is trivially safe.

---

# 8. Merge with an adjacent compatible citation

If the exact insertion point already ends with the same citation command:

```latex
... prior work \citep{smith2022}.
```

and AI wants to add `jones2024`, prefer:

```latex
... prior work \citep{smith2022,jones2024}.
```

instead of:

```latex
... prior work \citep{smith2022}\citep{jones2024}.
```

Only merge when:

- the command is identical;
- there are no optional prenote/postnote arguments that could change meaning;
- the citation is immediately adjacent to the target sentence;
- the key is not already present.

Do not merge:

```latex
\citep[see][p.~4]{smith2022}
```

without a more careful parser.

---

# 9. Do not convert textual and parenthetical citations automatically

These are semantically different:

```latex
\citet{smith2020} showed that ...
```

vs.

```latex
... has previously been demonstrated \citep{smith2020}.
```

Likewise:

```latex
\textcite{smith2020}
```

and:

```latex
\parencite{smith2020}
```

are not interchangeable formatting aliases.

Therefore:

- If the user already has a citation command at/near the intended insertion, preserve it exactly.
- If inserting a new citation at a sentence end, use the detected **project/local parenthetical convention**.
- Do not rewrite prose just to accommodate `\citet` / `\textcite`.
- Only use a textual citation command when the user explicitly asks for one or the AI is already rewriting the sentence under a separate edit action.

This is how we avoid disturbing the author.

---

# 10. Update AgentContext to return structured citation information

Current:

```ts
insertCitation: (query: string) => Promise<string>;
recommendCitations: (passage: string) => Promise<string>;
```

Recommended transition:

```ts
export interface CitationToolRecommendation {
  key: string;
  title?: string;
  author?: string;
  year?: string;
  score: number;
  confidence?: number;
  reason: string;
}

insertCitation: (query: string) => Promise<CitationToolRecommendation | null>;

recommendCitations: (
  passage: string,
) => Promise<CitationToolRecommendation[]>;
```

If changing the generic tool result transport is too large for the first patch, keep the string transport but serialize JSON.

---

# 11. Change the AI tool schema

Update `src/features/ai/aiTools.ts`.

Instead of:

```text
return the most relevant references (with \cite keys and reasons)
```

use:

```ts
{
  name: "recommend_citations",
  description:
    "Given paper prose, rank real references from the project's bibliography. " +
    "Returns bibliography keys and relevance evidence only. " +
    "Citation LaTeX syntax is chosen separately from the user's document style.",
  params: {
    passage: {
      type: "string",
      description:
        "The exact sentence or paragraph needing support. Pass actual prose.",
    },
  },
  required: ["passage"],
}
```

For `insert_citation`, rename it later to something less misleading such as:

```text
find_citation
```

because today it does not insert; it searches.

If backward compatibility matters, keep `insert_citation` as an alias temporarily.

---

# 12. Strengthen the AI system prompt

Update `src/features/ai/aiSystemPrompt.ts`.

Replace the current citation instruction with rules like:

```text
- Never fabricate citation keys. Citation keys must come from bibliography tools.
- When asked what to cite, call recommend_citations with the exact passage.
- A citation recommendation is a source choice, not permission to rewrite prose.
- Preserve the user's existing citation command and citation package conventions.
- Never replace \citep with \cite, \parencite with \cite, or otherwise normalize citation commands.
- When adding a citation, make the smallest possible editor change.
- Do not change prose, punctuation, or existing citations unless required for the requested operation.
- If citation relevance is uncertain, present candidates instead of inserting one.
```

This prompt is a defense layer, not the primary implementation.

The actual command preservation must happen deterministically in TypeScript.

---

# 13. Wire style detection into the existing `agentContext`

In the app file where `agentContext` is created:

```ts
recommendCitations: async (passage) => {
  const activePath = activeTextDocument?.relativePath ?? null;
  const documentText =
    editorRef.current?.getModel()?.getValue() ??
    activeTextDocument?.content ??
    "";

  const style = resolveCitationStyle({
    selectedText: passage,
    nearbyText: getNearbyCitationContext(editorRef.current),
    activeFilePath: activePath,
    activeDocumentText: documentText,
    usages: citationAnalysis.usages,
  });

  const localKeys = citationKeysInText(passage);

  const recommendations = recommendCitations(
    passage,
    citationAnalysis.entries,
    {
      citedKeys: localKeys,
      limit: 12,
    },
  );

  return JSON.stringify({
    citationStyle: style,
    recommendations: recommendations.map((rec) => ({
      key: rec.key,
      score: rec.score,
      title: rec.entry.title,
      author: rec.entry.author,
      year: rec.entry.year,
      reasons: rec.reasons,
      alreadyCited: rec.alreadyCited,
    })),
  });
},
```

The model now knows which sources rank well, while the application owns syntax.

---

# 14. Add nearby-text extraction

Use a small window around the selection/cursor, not the whole file, for local citation-style detection.

Example:

```ts
function getNearbyCitationContext(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  radius = 1200,
): string {
  if (!editor) return "";

  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return "";

  const start = model.getOffsetAt({
    lineNumber: selection.startLineNumber,
    column: selection.startColumn,
  });

  const end = model.getOffsetAt({
    lineNumber: selection.endLineNumber,
    column: selection.endColumn,
  });

  const text = model.getValue();

  return text.slice(
    Math.max(0, start - radius),
    Math.min(text.length, end + radius),
  );
}
```

This captures the citation habits in the same subsection without over-weighting a different chapter.

---

# 15. Fix knowledge-graph insertion

The current graph path should not do:

```ts
text: `\\cite{${key}}`
```

Replace it conceptually with:

```ts
const editor = editorRef.current;
const documentText = editor?.getModel()?.getValue() ?? "";

const style = resolveCitationStyle({
  nearbyText: getNearbyCitationContext(editor),
  activeFilePath: activeTextDocument?.relativePath ?? null,
  activeDocumentText: documentText,
  usages: citationAnalysis.usages,
});

const citationText = formatCitation(style.command, [key]);
```

Then insert `citationText`.

Status copy should also use:

```ts
setStatusMessage(`Inserted ${citationText}.`);
```

Similarly, recommendation status should not hardcode:

```ts
\cite{key}
```

Use:

```ts
const style = resolveCitationStyle(...);

setStatusMessage(
  `Suggested citations: ${recommendations
    .map((rec) => formatCitation(style.command, [rec.key]))
    .join(", ")}`,
);
```

---

# 16. Optional: claim-aware paragraph analysis

A paragraph can contain several independent claims.

Example:

```text
Transformers remove recurrence and enable greater parallelization.
They have subsequently become dominant in language modelling.
```

One citation may support the architectural statement and another the historical/adoption statement.

A better AI stage can first produce claim spans:

```json
{
  "claims": [
    {
      "text": "Transformers remove recurrence and enable greater parallelization.",
      "needsCitation": true
    },
    {
      "text": "They have subsequently become dominant in language modelling.",
      "needsCitation": true
    }
  ]
}
```

Then run citation retrieval per claim.

Do not add this to version 1 if it makes the first patch too broad. Citation-style preservation is more important.

---

# 17. Avoid duplicate and noisy citations

Before insertion:

```ts
if (localKeys.includes(best.key)) {
  // Already cited in the target passage.
  // Do not add it again.
}
```

Also reject recommendations whose bibliography entry is incomplete enough that the system cannot establish what the source is.

Use your existing citation quality information as a weak penalty, not an absolute exclusion.

Example:

```ts
const quality = citationQualityScore(entry) / 100;
adjustedScore *= 0.85 + 0.15 * quality;
```

A seminal old source should not be rejected just for age.

---

# 18. Do not apply a generic "newer is better" rule

Citation quality is not the same as recency.

For statements about:

- original algorithms;
- foundational theories;
- dataset introductions;
- architecture introductions;
- historical facts;

the canonical older paper can be the correct citation.

Use recency only when the claim itself implies recency, e.g.:

```text
Recent work...
Current state-of-the-art...
In the last few years...
```

---

# 19. Tests to add

## `src/latex/citationStyle.test.ts`

```ts
describe("resolveCitationStyle", () => {
  it("prefers a nearby citation command", () => {
    const result = resolveCitationStyle({
      nearbyText: "Prior work \\parencite{a}.",
      usages: [
        { key: "b", command: "citep", sourceFile: "main.tex", line: 10 },
      ],
      activeFilePath: "main.tex",
    });

    expect(result.command).toBe("parencite");
    expect(result.source).toBe("nearby");
  });

  it("prefers active-file style over project-wide style", () => {
    const result = resolveCitationStyle({
      activeFilePath: "chapter.tex",
      usages: [
        { key: "a", command: "citep", sourceFile: "other.tex", line: 1 },
        { key: "b", command: "citep", sourceFile: "other.tex", line: 2 },
        { key: "c", command: "parencite", sourceFile: "chapter.tex", line: 3 },
      ],
    });

    expect(result.command).toBe("parencite");
  });

  it("infers biblatex only when no actual usages exist", () => {
    const result = resolveCitationStyle({
      activeDocumentText:
        "\\usepackage{biblatex}\n\\addbibresource{refs.bib}",
      usages: [],
    });

    expect(result.command).toBe("parencite");
    expect(result.source).toBe("package");
  });

  it("falls back to cite", () => {
    expect(
      resolveCitationStyle({ usages: [] }).command,
    ).toBe("cite");
  });
});
```

## Citation recommender tests

Change:

```ts
expect(text).toContain("\\cite{vaswani2017}");
```

to:

```ts
expect(text).toContain("key=vaswani2017");
expect(text).not.toContain("\\cite{");
```

This test is important because it enforces separation between relevance and formatting.

## User-style regression tests

Add cases for:

```latex
\citep{...}
\citet{...}
\parencite{...}
\textcite{...}
\autocite{...}
\footcite{...}
\supercite{...}
```

For each, verify that a citation recommendation/insertion does not convert it to another command.

## Duplicate test

Input:

```latex
This method is efficient \citep{smith2024}.
```

Recommendation:

```text
smith2024
```

Expected: no edit.

## Same-command merge test

Input:

```latex
This method is efficient \citep{smith2024}.
```

New key:

```text
jones2025
```

Expected:

```latex
This method is efficient \citep{smith2024,jones2025}.
```

## Optional-argument safety test

Input:

```latex
This is related \citep[see][p.~4]{smith2024}.
```

Expected: do not automatically merge unless the insertion planner explicitly supports notes.

---

# 20. Suggested implementation order

### Phase 1 — ship this first

1. Add `citationStyle.ts`.
2. Remove hardcoded `\cite` formatting from `citationRecommender.ts`.
3. Use `resolveCitationStyle()` in knowledge-graph insertion.
4. Use local cited keys for paragraph recommendations.
5. Update AI tool descriptions/system prompt.
6. Add regression tests.

This gives a large UX improvement without requiring an additional AI request.

### Phase 2 — semantic reranker

1. Take the deterministic top 20 candidates.
2. Send only those candidates plus the paragraph to the configured AI model.
3. Require JSON.
4. Validate all returned keys.
5. Apply confidence thresholds.
6. Show ambiguous recommendations rather than auto-inserting.

### Phase 3 — claim-aware citations

Split paragraphs into citation-worthy claims and recommend sources per claim.

---

# 21. Important UX behavior

When a user runs "suggest citations":

- Do not rewrite their paragraph.
- Do not change an existing citation command.
- Do not change `natbib` to `biblatex` or vice versa.
- Do not change citation punctuation globally.
- Do not add a bibliography entry that does not already exist unless the user explicitly invokes a discovery/import flow.
- Do not invent keys.
- Prefer a suggestion when confidence is not strong.
- If inserting, make one minimal, undoable editor edit.

A good status message is:

```text
Best match: Vaswani et al. (2017) — strong support for the Transformer architecture claim.
```

If the user explicitly asked to insert it:

```text
Inserted \citep{vaswani2017} using this section's citation style.
```

Avoid noisy explanations during normal writing. The intelligence should feel invisible.

---

# 22. One more recommended refactor

The current tool named `insert_citation` actually searches and returns a key; it does not insert into the document.

That naming can cause the model to misunderstand the operation.

Long term:

```text
find_citation
recommend_citations
insert_citation
```

should be three distinct operations:

- `find_citation(query)` → lookup bibliography candidates;
- `recommend_citations(passage)` → semantic ranking;
- `insert_citation(key, target)` → deterministic safe insertion using `resolveCitationStyle`.

This makes responsibilities clear and substantially lowers the chance of model-generated formatting mistakes.

---

# Definition of done

The feature is ready when all of these are true:

- A paragraph in a `natbib` document using `\citep` receives `\citep{key}`, not `\cite{key}`.
- A `biblatex` paragraph using `\parencite` receives `\parencite{key}`.
- A locally different citation style beats a project-wide majority.
- The recommender never manufactures a bibliography key.
- A key already cited in the selected passage is not inserted twice.
- The user's paragraph is unchanged except for the minimum citation edit.
- Low-confidence matches are suggested rather than inserted.
- The graph UI and AI sidebar use the same citation-style resolver.
- Existing citation commands remain untouched.
- Tests cover natbib, biblatex, no-citation fallback, duplicates, and local-vs-project style.
