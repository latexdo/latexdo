import type { RebuttalItem, RebuttalGeneratorSettings } from "./types";

const DEFAULT_SUMMARY =
  "We revised the manuscript substantially in response to the reviewers' comments.";

function esc(s: string): string {
  return s.replace(/&/g, "\\&").replace(/%/g, "\\%").replace(/#/g, "\\#");
}

function preamble(settings: RebuttalGeneratorSettings): string {
  const fontSize = settings.fontSize || "11pt";
  const paperSize = settings.paperSize || "a4paper";
  const lm = "2.3cm";
  const rm = "2.3cm";
  const tm = "2.2cm";
  const bm = "2.2cm";
  const primary = settings.colorPrimary || "1E1E1E";
  const accent = settings.colorAccent || "D9D9D9";

  let fontPkg: string;
  switch (settings.fontFamily) {
    case "lmodern":
      fontPkg = "\\usepackage{lmodern}";
      break;
    case "times":
      fontPkg = "\\usepackage{mathptmx}";
      break;
    default:
      fontPkg = "\\usepackage{newpxtext,newpxmath}";
  }

  return [
    `\\documentclass[${fontSize},${paperSize}]{article}`,
    "",
    "\\usepackage[",
    `    top=${tm},`,
    `    bottom=${bm},`,
    `    left=${lm},`,
    `    right=${rm}`,
    "]{geometry}",
    "",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage[utf8]{inputenc}",
    fontPkg,
    "\\usepackage{microtype}",
    settings.useOnehalfSpacing ? "\\usepackage{setspace}\n\\onehalfspacing" : "",
    "\\usepackage{parskip}",
    "\\usepackage{enumitem}",
    "\\usepackage{xcolor}",
    "\\usepackage{titlesec}",
    "\\usepackage{hyperref}",
    "\\usepackage{tcolorbox}",
    "\\tcbuselibrary{breakable,skins}",
    "",
    `\\definecolor{Ink}{HTML}{${primary}}`,
    `\\definecolor{Accent}{HTML}{${accent}}`,
    "\\definecolor{SoftGray}{HTML}{F6F6F6}",
    "\\definecolor{PanelGray}{HTML}{FAFAFA}",
    "\\definecolor{DarkGray}{HTML}{3A3A3A}",
    "",
    "\\hypersetup{",
    "    colorlinks=true,",
    "    linkcolor=Ink,",
    "    urlcolor=Ink,",
    "    citecolor=Ink",
    "}",
    "",
    "\\titleformat{\\section}",
    "  {\\Large\\bfseries\\color{Ink}}",
    "  {}",
    "  {0pt}",
    "  {}",
    "",
    "\\titleformat{\\subsection}",
    "  {\\large\\bfseries\\color{Ink}}",
    "  {}",
    "  {0pt}",
    "  {}",
    "",
    "\\newenvironment{ReviewCard}[2]",
    "{",
    "\\begin{tcolorbox}[",
    "    enhanced,",
    "    breakable,",
    "    colback=white,",
    "    colframe=Ink,",
    "    boxrule=0.9pt,",
    "    arc=1mm,",
    "    left=0mm,",
    "    right=0mm,",
    "    top=0mm,",
    "    bottom=3mm,",
    "    before skip=1.5em,",
    "    after skip=1.5em",
    "]",
    "\\begin{tcolorbox}[",
    "    enhanced,",
    "    colback=Ink,",
    "    colframe=Ink,",
    "    boxrule=0pt,",
    "    arc=0mm,",
    "    left=4mm,",
    "    right=4mm,",
    "    top=2mm,",
    "    bottom=2mm",
    "]",
    "{\\color{white}\\bfseries ##1 \\hfill ##2}",
    "\\end{tcolorbox}",
    "\\vspace{0.3em}",
    "}",
    "{",
    "\\end{tcolorbox}",
    "}",
    "",
    "\\newenvironment{ReviewerComment}",
    "{",
    "\\begin{tcolorbox}[",
    "    enhanced,",
    "    breakable,",
    "    colback=PanelGray,",
    "    colframe=Accent,",
    "    boxrule=0.5pt,",
    "    arc=1mm,",
    "    left=4mm,",
    "    right=4mm,",
    "    top=2mm,",
    "    bottom=2mm,",
    "    before skip=0.6em,",
    "    after skip=0.6em,",
    "    borderline west={3pt}{0pt}{Ink}",
    "]",
    "\\textbf{\\MakeUppercase{Reviewer comment}}\\par",
    "\\vspace{0.35em}",
    "}",
    "{",
    "\\end{tcolorbox}",
    "}",
    "",
    "\\newenvironment{AuthorResponse}",
    "{",
    "\\begin{tcolorbox}[",
    "    enhanced,",
    "    breakable,",
    "    colback=white,",
    "    colframe=Ink,",
    "    boxrule=0.6pt,",
    "    arc=1mm,",
    "    left=4mm,",
    "    right=4mm,",
    "    top=2mm,",
    "    bottom=2mm,",
    "    before skip=0.6em,",
    "    after skip=0.6em",
    "]",
    "\\textbf{\\MakeUppercase{Author response}}\\par",
    "\\vspace{0.35em}",
    "}",
    "{",
    "\\end{tcolorbox}",
    "}",
    "",
    "\\newenvironment{ManuscriptChange}",
    "{",
    "\\begin{tcolorbox}[",
    "    enhanced,",
    "    breakable,",
    "    colback=SoftGray,",
    "    colframe=DarkGray,",
    "    boxrule=0.6pt,",
    "    arc=1mm,",
    "    left=4mm,",
    "    right=4mm,",
    "    top=2mm,",
    "    bottom=2mm,",
    "    before skip=0.6em,",
    "    after skip=0.6em,",
    "    borderline north={1.5pt}{0pt}{Ink}",
    "]",
    "\\textbf{\\MakeUppercase{Manuscript change}}\\par",
    "\\vspace{0.35em}",
    "}",
    "{",
    "\\end{tcolorbox}",
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

function titleBlock(settings: RebuttalGeneratorSettings): string {
  const lines: string[] = [
    "\\begin{center}",
    "    \\vspace*{0.5em}",
    "    {\\Huge\\bfseries Response to Reviewers}\\\\[0.5em]",
  ];
  if (settings.manuscriptId) {
    lines.push(`    {\\Large Manuscript ${esc(settings.manuscriptId)}}\\\\[0.3em]`);
  }
  if (settings.manuscriptTitle) {
    lines.push(`    {\\large ${esc(settings.manuscriptTitle)}}`);
  }
  lines.push("\\end{center}", "");

  const summary = settings.summaryText || DEFAULT_SUMMARY;
  lines.push(
    "\\vspace{1em}",
    "\\begin{tcolorbox}[",
    "    enhanced,",
    "    colback=SoftGray,",
    "    colframe=Ink,",
    "    boxrule=0.8pt,",
    "    arc=1mm,",
    "    left=4mm,",
    "    right=4mm,",
    "    top=3mm,",
    "    bottom=3mm",
    "]",
    "\\textbf{Summary of revision.}",
    esc(summary),
    "\\end{tcolorbox}",
  );

  return lines.join("\n");
}

function reviewerSections(items: RebuttalItem[]): string {
  if (items.length === 0) {
    return "% No rebuttal items to include.";
  }

  const parts: string[] = [];
  let reviewerNum = 1;

  for (const item of items) {
    const label = `R${reviewerNum}`;
    parts.push("");
    parts.push(
      `\\begin{ReviewCard}{${esc(item.reviewerComment.split("\\n")[0] || "Comment")}}{${label}}`,
    );

    parts.push("\\begin{ReviewerComment}");
    parts.push(esc(item.reviewerComment));
    parts.push("\\end{ReviewerComment}");
    parts.push("");

    parts.push("\\begin{AuthorResponse}");
    parts.push(esc(item.authorComment || "Thank you for this comment."));
    parts.push("\\end{AuthorResponse}");
    parts.push("");

    if (item.modificationMade) {
      parts.push("\\begin{ManuscriptChange}");
      parts.push(esc(item.modificationMade));
      parts.push("\\end{ManuscriptChange}");
    }

    parts.push("\\end{ReviewCard}");

    reviewerNum++;
  }

  return parts.join("\n");
}

export function generateRebuttalLetter(
  items: RebuttalItem[],
  settings: RebuttalGeneratorSettings,
): string {
  const parts: string[] = [];

  parts.push(preamble(settings));
  parts.push("");
  parts.push("\\begin{document}");
  parts.push("");
  parts.push(titleBlock(settings));
  parts.push("");

  if (settings.includeDiff) {
    parts.push("Dear Editor-in-Chief and Reviewers,");
    parts.push("");
    parts.push(
      "We sincerely thank the Editor-in-Chief and the reviewers for their careful reading " +
        "of our manuscript and for their constructive comments. We have revised the manuscript " +
        "substantially.",
    );
    if (settings.diffOutput) {
      parts.push("");
      parts.push(
        `Please refer to \\texttt{${esc(settings.diffOutput)}} for a detailed list of changes.`,
      );
    }
    parts.push("");
  }

  parts.push("\\newpage");
  parts.push("\\section*{Response to Reviewers}");
  parts.push("");

  parts.push(reviewerSections(items));

  parts.push("");
  parts.push("\\end{document}");

  return parts.join("\n");
}

export function latexdiffCommand(settings: RebuttalGeneratorSettings): string {
  if (!settings.diffOldFile || !settings.diffNewFile) return "";
  const out = settings.diffOutput || "diff.tex";
  return `latexdiff ${esc(settings.diffOldFile)} ${esc(settings.diffNewFile)} > ${esc(out)}`;
}
