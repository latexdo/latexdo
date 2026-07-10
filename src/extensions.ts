export type ExtensionCategory =
  | "bibliography"
  | "checking"
  | "graphics"
  | "templates"
  | "writing"
  | "workflow";

export type LatexDoExtensionKind = "extension" | "template";

export type ExtensionFeatureFlag =
  | "acronymManagerEnabled"
  | "autoFixCommon"
  | "checkAbstractWordCount"
  | "checkCodeLink"
  | "checkDatasetLink"
  | "checkEmbeddedFonts"
  | "checkEvaluationMetrics"
  | "checkFigureReferences"
  | "checkHardwareDetails"
  | "checkHyperparameters"
  | "checkLicenseMentioned"
  | "checkPageCount"
  | "checkRandomSeeds"
  | "checkSectionsWithNoCitations"
  | "checkTableReferences"
  | "checkType3Fonts"
  | "checkUncitedCitations"
  | "checkUndefinedAcronym"
  | "checkUnreferencedFigures"
  | "citationAssistantEnabled"
  | "conferenceCheckerEnabled"
  | "detectBrokenLinks"
  | "detectDuplicateReferences"
  | "detectMissingCitations"
  | "detectNotation"
  | "detectNotationConflicts"
  | "detectUndefinedNotation"
  | "detectUnusedEntries"
  | "errorDoctorEnabled"
  | "explainErrors"
  | "importMetadataSources"
  | "notationManagerEnabled"
  | "pdfComplianceEnabled"
  | "reproducibilityEnabled"
  | "structureAssistantEnabled"
  | "suggestCitationKeys"
  | "suggestFixes"
  | "tikzConverterAutoOpen"
  | "tikzConverterEnabled"
  | "warnOldCitations";

export interface LatexDoExtensionSnippet {
  label: string;
  insertText: string;
  detail?: string;
  documentation?: string;
}

export interface LatexDoExtensionTemplate {
  id: string;
  name: string;
  summary: string;
  files: string;
  mainTex: string;
  bibTex?: string;
}

export interface LatexDoExtensionContributions {
  featureFlags?: Partial<Record<ExtensionFeatureFlag, boolean>>;
  snippets?: LatexDoExtensionSnippet[];
  templates?: LatexDoExtensionTemplate[];
}

export interface LatexDoExtensionManifest {
  schemaVersion: 1;
  id: string;
  kind: LatexDoExtensionKind;
  name: string;
  version: string;
  description: string;
  author: string;
  category: ExtensionCategory;
  tags: string[];
  homepage?: string;
  repository?: string;
  contributes: LatexDoExtensionContributions;
}

export interface LatexDoExtensionCatalog {
  schemaVersion: 1;
  product: "LatexDo";
  updatedAt: string;
  extensions: LatexDoExtensionManifest[];
}

export interface ExtensionCatalogLoadResult {
  catalog: LatexDoExtensionCatalog;
  source: "remote" | "fallback";
  error?: string;
}

type ExtensionCatalogJsonLoader = (catalogUrl: string) => Promise<unknown>;

export const extensionStoreSiteUrl = "https://store.latexdo.org/";
export const extensionStoreCatalogUrl =
  "https://store.latexdo.org/extensions/catalog.json";

export const extensionCategories: ExtensionCategory[] = [
  "writing",
  "checking",
  "bibliography",
  "graphics",
  "templates",
  "workflow",
];

const extensionFeatureFlags = new Set<ExtensionFeatureFlag>([
  "acronymManagerEnabled",
  "autoFixCommon",
  "checkAbstractWordCount",
  "checkCodeLink",
  "checkDatasetLink",
  "checkEmbeddedFonts",
  "checkEvaluationMetrics",
  "checkFigureReferences",
  "checkHardwareDetails",
  "checkHyperparameters",
  "checkLicenseMentioned",
  "checkPageCount",
  "checkRandomSeeds",
  "checkSectionsWithNoCitations",
  "checkTableReferences",
  "checkType3Fonts",
  "checkUncitedCitations",
  "checkUndefinedAcronym",
  "checkUnreferencedFigures",
  "citationAssistantEnabled",
  "conferenceCheckerEnabled",
  "detectBrokenLinks",
  "detectDuplicateReferences",
  "detectMissingCitations",
  "detectNotation",
  "detectNotationConflicts",
  "detectUndefinedNotation",
  "detectUnusedEntries",
  "errorDoctorEnabled",
  "explainErrors",
  "importMetadataSources",
  "notationManagerEnabled",
  "pdfComplianceEnabled",
  "reproducibilityEnabled",
  "structureAssistantEnabled",
  "suggestCitationKeys",
  "suggestFixes",
  "tikzConverterAutoOpen",
  "tikzConverterEnabled",
  "warnOldCitations",
]);

const extensionIdPattern = /^[a-z0-9][a-z0-9.-]{2,80}$/;
const extensionVersionPattern = /^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][a-z0-9.-]+)?$/i;

export const fallbackExtensionCatalog: LatexDoExtensionCatalog = {
  schemaVersion: 1,
  product: "LatexDo",
  updatedAt: "2026-07-03T00:00:00.000Z",
  extensions: [
    {
      schemaVersion: 1,
      id: "latexdo.conference-readiness",
      kind: "extension",
      name: "Conference Readiness Pack",
      version: "1.0.0",
      description:
        "Enables conference checks, PDF compliance, and compiler diagnostics for submission-ready papers.",
      author: "LatexDo",
      category: "checking",
      tags: ["conference", "pdf", "submission"],
      homepage: "https://store.latexdo.org/extensions/latexdo.conference-readiness/",
      repository: "https://github.com/latexdo/store.latexdo.org",
      contributes: {
        featureFlags: {
          conferenceCheckerEnabled: true,
          checkEmbeddedFonts: true,
          checkFigureReferences: true,
          checkTableReferences: true,
          errorDoctorEnabled: true,
          explainErrors: true,
          pdfComplianceEnabled: true,
          checkPageCount: true,
          checkType3Fonts: true,
        },
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.citation-workbench",
      kind: "extension",
      name: "Citation Workbench",
      version: "1.0.0",
      description:
        "Turns on citation analysis, duplicate detection, stale-reference warnings, and BibTeX helpers.",
      author: "LatexDo",
      category: "bibliography",
      tags: ["bibtex", "citations", "references"],
      homepage: "https://store.latexdo.org/extensions/latexdo.citation-workbench/",
      repository: "https://github.com/latexdo/store.latexdo.org",
      contributes: {
        featureFlags: {
          citationAssistantEnabled: true,
          detectMissingCitations: true,
          detectUnusedEntries: true,
          detectDuplicateReferences: true,
          detectBrokenLinks: true,
          suggestCitationKeys: true,
          importMetadataSources: true,
          warnOldCitations: true,
        },
        snippets: [
          {
            label: "annotatedbib",
            detail: "Annotated BibTeX note",
            documentation: "Creates a commented BibTeX placeholder for manual imports.",
            insertText:
              "% ${1:Paper note}\n@article{${2:key},\n  title = {${3:Title}},\n  author = {${4:Author}},\n  year = {${5:2026}}\n}",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.figure-lab",
      kind: "extension",
      name: "Figure Lab",
      version: "1.0.0",
      description:
        "Adds figure, subfigure, and TikZ helpers for papers that depend on diagrams and visual results.",
      author: "LatexDo",
      category: "graphics",
      tags: ["figures", "tikz", "graphics"],
      homepage: "https://store.latexdo.org/extensions/latexdo.figure-lab/",
      repository: "https://github.com/latexdo/store.latexdo.org",
      contributes: {
        featureFlags: {
          tikzConverterEnabled: true,
          tikzConverterAutoOpen: true,
          checkUnreferencedFigures: true,
        },
        snippets: [
          {
            label: "subfigures",
            detail: "Two-panel figure",
            documentation: "Requires the subcaption package.",
            insertText:
              "\\begin{figure}[t]\n  \\centering\n  \\begin{subfigure}{0.48\\textwidth}\n    \\includegraphics[width=\\linewidth]{${1:first}}\n    \\caption{${2:First panel}}\n  \\end{subfigure}\\hfill\n  \\begin{subfigure}{0.48\\textwidth}\n    \\includegraphics[width=\\linewidth]{${3:second}}\n    \\caption{${4:Second panel}}\n  \\end{subfigure}\n  \\caption{${5:Caption}}\n  \\label{fig:${6:label}}\n\\end{figure}",
          },
          {
            label: "tikzplot",
            detail: "PGFPlots figure",
            documentation: "Requires tikz and pgfplots packages.",
            insertText:
              "\\begin{tikzpicture}\n  \\begin{axis}[\n    xlabel={${1:x}},\n    ylabel={${2:y}},\n    grid=both\n  ]\n    \\addplot coordinates {${3:(0,0) (1,1)}};\n  \\end{axis}\n\\end{tikzpicture}",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.math-notation-kit",
      kind: "extension",
      name: "Math Notation Kit",
      version: "1.0.0",
      description:
        "Enables notation checks and adds theorem, proof, definition, and symbol snippets.",
      author: "LatexDo",
      category: "writing",
      tags: ["math", "theorems", "notation"],
      homepage: "https://store.latexdo.org/extensions/latexdo.math-notation-kit/",
      repository: "https://github.com/latexdo/store.latexdo.org",
      contributes: {
        featureFlags: {
          notationManagerEnabled: true,
          detectNotation: true,
          detectNotationConflicts: true,
          detectUndefinedNotation: true,
        },
        snippets: [
          {
            label: "theorem",
            detail: "Theorem environment",
            documentation: "Adds a labeled theorem block.",
            insertText:
              "\\begin{theorem}\n\\label{thm:${1:name}}\n${0:Statement.}\n\\end{theorem}",
          },
          {
            label: "proof",
            detail: "Proof environment",
            documentation: "Adds a proof block.",
            insertText: "\\begin{proof}\n${0:Proof.}\n\\end{proof}",
          },
          {
            label: "definition",
            detail: "Definition environment",
            documentation: "Adds a labeled definition block.",
            insertText:
              "\\begin{definition}\n\\label{def:${1:name}}\n${0:Definition.}\n\\end{definition}",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.reproducibility-kit",
      kind: "extension",
      name: "Reproducibility Kit",
      version: "1.0.0",
      description:
        "Checks code, data, hardware, hyperparameter, metric, seed, and license reporting.",
      author: "LatexDo",
      category: "checking",
      tags: ["reproducibility", "artifact", "checklist"],
      homepage: "https://store.latexdo.org/extensions/latexdo.reproducibility-kit/",
      repository: "https://github.com/latexdo/store.latexdo.org",
      contributes: {
        featureFlags: {
          reproducibilityEnabled: true,
          checkCodeLink: true,
          checkDatasetLink: true,
          checkLicenseMentioned: true,
          checkHyperparameters: true,
          checkHardwareDetails: true,
          checkRandomSeeds: true,
          checkEvaluationMetrics: true,
        },
        snippets: [
          {
            label: "artifactchecklist",
            detail: "Artifact checklist paragraph",
            documentation: "Adds a compact reproducibility statement.",
            insertText:
              "\\paragraph{Reproducibility.}\nCode is available at \\url{${1:https://...}}. Datasets, hyperparameters, hardware details, random seeds, and evaluation metrics are documented in Appendix~\\ref{${2:app:reproducibility}}.",
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      id: "latexdo.response-letter-kit",
      kind: "template",
      name: "Response Letter Kit",
      version: "1.0.0",
      description:
        "Adds reviewer-response snippets for rebuttals, revisions, and camera-ready letters.",
      author: "LatexDo",
      category: "templates",
      tags: ["review", "rebuttal", "response"],
      homepage: "https://store.latexdo.org/extensions/latexdo.response-letter-kit/",
      repository: "https://github.com/latexdo/store.latexdo.org",
      contributes: {
        templates: [
          {
            id: "reviewer-response-letter",
            name: "Reviewer Response Letter",
            summary: "A structured response letter with reviewer comments and replies.",
            files: "main.tex",
            mainTex: String.raw`\documentclass[11pt]{article}

\usepackage[margin=1in]{geometry}
\usepackage{hyperref}
\usepackage{xcolor}

\title{Response to Reviewers}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\section*{Summary of Revisions}

Thank you for the thoughtful reviews. We revised the manuscript to address the main concerns and clarify the presentation.

\section*{Reviewer 1}

\paragraph{Comment 1.}
\emph{Paste the reviewer comment here.}

\paragraph{Response.}
Thank you for this comment. We updated Section~\ref{sec:changes} to clarify the point.

\section*{Changes}
\label{sec:changes}

\begin{itemize}
  \item Clarified the main contribution.
  \item Expanded the experimental details.
  \item Revised the discussion of limitations.
\end{itemize}

\end{document}
`,
          },
        ],
        snippets: [
          {
            label: "reviewresponse",
            detail: "Reviewer response block",
            documentation: "Adds a concise response item for revision letters.",
            insertText:
              "\\paragraph{Reviewer ${1:1}, Comment ${2:1}.}\n\\emph{${3:Reviewer comment.}}\n\n\\paragraph{Response.}\n${0:Thank you for the helpful comment. We revised the manuscript to clarify this point.}",
          },
          {
            label: "revisionnote",
            detail: "Revision note",
            documentation: "Adds a short change summary paragraph.",
            insertText:
              "\\paragraph{Change made.}\nWe updated ${1:Section~\\ref{sec:...}} to ${0:describe the revision}.",
          },
        ],
      },
    },
  ],
};

export function categoryLabel(category: ExtensionCategory): string {
  switch (category) {
    case "bibliography":
      return "Bibliography";
    case "checking":
      return "Checking";
    case "graphics":
      return "Graphics";
    case "templates":
      return "Templates";
    case "workflow":
      return "Workflow";
    case "writing":
    default:
      return "Writing";
  }
}

export function contributionSummary(extension: LatexDoExtensionManifest): string[] {
  const featureCount = Object.keys(extension.contributes.featureFlags ?? {}).length;
  const snippetCount = extension.contributes.snippets?.length ?? 0;
  const templateCount = extension.contributes.templates?.length ?? 0;
  return [
    featureCount
      ? `${featureCount} feature toggle${featureCount === 1 ? "" : "s"}`
      : "",
    snippetCount ? `${snippetCount} snippet${snippetCount === 1 ? "" : "s"}` : "",
    templateCount ? `${templateCount} template${templateCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
}

export function validateExtensionCatalog(
  value: unknown,
): LatexDoExtensionCatalog | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schemaVersion !== 1 ||
    value.product !== "LatexDo" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.extensions)
  ) {
    return null;
  }

  const seen = new Set<string>();
  const extensions = value.extensions
    .map(normalizeExtensionManifest)
    .filter((extension): extension is LatexDoExtensionManifest => {
      if (!extension || seen.has(extension.id)) {
        return false;
      }
      seen.add(extension.id);
      return true;
    });

  return {
    schemaVersion: 1,
    product: "LatexDo",
    updatedAt: value.updatedAt,
    extensions,
  };
}

export async function fetchExtensionCatalog(
  catalogUrl = extensionStoreCatalogUrl,
  loadCatalogJson: ExtensionCatalogJsonLoader = defaultExtensionCatalogJsonLoader,
): Promise<ExtensionCatalogLoadResult> {
  try {
    const remoteCatalog = validateExtensionCatalog(await loadCatalogJson(catalogUrl));
    if (!remoteCatalog) {
      throw new Error("Store catalog is not a valid LatexDo extension catalog.");
    }

    return {
      catalog: mergeCatalogs(remoteCatalog),
      source: "remote",
    };
  } catch (error) {
    return {
      catalog: fallbackExtensionCatalog,
      source: "fallback",
      error:
        error instanceof Error
          ? error.message
          : "Could not load the LatexDo extension catalog.",
    };
  }
}

async function defaultExtensionCatalogJsonLoader(catalogUrl: string): Promise<unknown> {
  if (
    catalogUrl === extensionStoreCatalogUrl &&
    typeof window !== "undefined" &&
    typeof window.latexdo?.fetchExtensionCatalog === "function"
  ) {
    return window.latexdo.fetchExtensionCatalog();
  }

  return fetchExtensionCatalogJson(catalogUrl);
}

async function fetchExtensionCatalogJson(catalogUrl: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(catalogUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Store catalog returned HTTP ${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    window.clearTimeout(timeout);
  }
}

function mergeCatalogs(
  remoteCatalog: LatexDoExtensionCatalog,
): LatexDoExtensionCatalog {
  const extensionsById = new Map<string, LatexDoExtensionManifest>();

  for (const extension of fallbackExtensionCatalog.extensions) {
    extensionsById.set(extension.id, extension);
  }
  for (const extension of remoteCatalog.extensions) {
    extensionsById.set(extension.id, extension);
  }

  return {
    ...remoteCatalog,
    extensions: [...extensionsById.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

function normalizeExtensionManifest(value: unknown): LatexDoExtensionManifest | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schemaVersion !== 1 ||
    !isBoundedString(value.id, 3, 80) ||
    !extensionIdPattern.test(value.id) ||
    !isBoundedString(value.name, 2, 80) ||
    !isBoundedString(value.version, 1, 40) ||
    !extensionVersionPattern.test(value.version) ||
    !isBoundedString(value.description, 12, 260) ||
    !isBoundedString(value.author, 2, 80) ||
    !extensionCategories.includes(value.category as ExtensionCategory) ||
    !Array.isArray(value.tags) ||
    !isRecord(value.contributes)
  ) {
    return null;
  }

  const tags = value.tags
    .filter((tag): tag is string => isBoundedString(tag, 1, 28))
    .slice(0, 8);
  const kind: LatexDoExtensionKind =
    value.kind === "template" ? "template" : "extension";
  const homepage = optionalHttpsUrl(value.homepage);
  const repository = optionalHttpsUrl(value.repository);
  const featureFlags = normalizeFeatureFlags(value.contributes.featureFlags);
  const snippets = normalizeSnippets(value.contributes.snippets);
  const templates = normalizeTemplates(value.contributes.templates);
  const contributes: LatexDoExtensionContributions = {};

  if (Object.keys(featureFlags).length) {
    contributes.featureFlags = featureFlags;
  }
  if (snippets.length) {
    contributes.snippets = snippets;
  }
  if (templates.length) {
    contributes.templates = templates;
  }

  if (!contributes.featureFlags && !contributes.snippets && !contributes.templates) {
    return null;
  }

  return {
    schemaVersion: 1,
    id: value.id.trim(),
    kind,
    name: value.name.trim(),
    version: value.version.trim(),
    description: value.description.trim(),
    author: value.author.trim(),
    category: value.category as ExtensionCategory,
    tags,
    ...(homepage ? { homepage } : {}),
    ...(repository ? { repository } : {}),
    contributes,
  };
}

function normalizeFeatureFlags(
  value: unknown,
): Partial<Record<ExtensionFeatureFlag, boolean>> {
  if (!isRecord(value)) {
    return {};
  }

  const flags: Partial<Record<ExtensionFeatureFlag, boolean>> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (extensionFeatureFlags.has(key as ExtensionFeatureFlag)) {
      flags[key as ExtensionFeatureFlag] = enabled === true;
    }
  }
  return flags;
}

function normalizeSnippets(value: unknown): LatexDoExtensionSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((snippet): LatexDoExtensionSnippet | null => {
      if (
        !isRecord(snippet) ||
        !isBoundedString(snippet.label, 2, 48) ||
        !isBoundedString(snippet.insertText, 1, 4000)
      ) {
        return null;
      }

      const detail = isBoundedString(snippet.detail, 1, 120)
        ? snippet.detail.trim()
        : undefined;
      const documentation = isBoundedString(snippet.documentation, 1, 500)
        ? snippet.documentation.trim()
        : undefined;

      return {
        label: snippet.label.trim(),
        insertText: snippet.insertText,
        ...(detail ? { detail } : {}),
        ...(documentation ? { documentation } : {}),
      };
    })
    .filter((snippet): snippet is LatexDoExtensionSnippet => Boolean(snippet))
    .slice(0, 40);
}

function normalizeTemplates(value: unknown): LatexDoExtensionTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((template): LatexDoExtensionTemplate | null => {
      if (
        !isRecord(template) ||
        !isBoundedString(template.id, 2, 48) ||
        !/^[a-z0-9][a-z0-9.-]{1,47}$/.test(template.id) ||
        !isBoundedString(template.name, 2, 80) ||
        !isBoundedString(template.summary, 12, 220) ||
        !isBoundedString(template.files, 3, 120) ||
        !isBoundedString(template.mainTex, 20, 12000)
      ) {
        return null;
      }

      const bibTex = isBoundedString(template.bibTex, 1, 8000)
        ? template.bibTex
        : undefined;

      return {
        id: template.id.trim(),
        name: template.name.trim(),
        summary: template.summary.trim(),
        files: template.files.trim(),
        mainTex: template.mainTex,
        ...(bibTex ? { bibTex } : {}),
      };
    })
    .filter((template): template is LatexDoExtensionTemplate => Boolean(template))
    .slice(0, 12);
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (!isBoundedString(value, 8, 300)) {
    return undefined;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minLength &&
    value.length <= maxLength
  );
}
