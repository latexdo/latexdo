const sourceEditor = document.getElementById("source-editor");
const editorLines = document.getElementById("editor-lines");
const compileButton = document.getElementById("compile-demo");
const insertCitationButton = document.getElementById("insert-citation");
const fixErrorButton = document.getElementById("fix-error");
const syncSourceButton = document.getElementById("sync-source");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const buildState = document.getElementById("build-state");
const diagnosticsList = document.getElementById("diagnostics");
const pdfTitle = document.getElementById("pdf-title");
const pdfAbstract = document.getElementById("pdf-abstract");
const pdfSections = document.getElementById("pdf-sections");
const wordCount = document.getElementById("word-count");
const citationCount = document.getElementById("citation-count");
const sectionCount = document.getElementById("section-count");
const checkCount = document.getElementById("check-count");
const modeButtons = Array.from(document.querySelectorAll(".mode"));

const sampleSource = String.raw`\documentclass{article}
\title{A Better Way to Write Papers}
\author{LatexDo Team}

\begin{document}
\maketitle

\begin{abstract}
LatexDo keeps source, PDF preview, diagnostics, and review work in one focused workspace.
\end{abstract}

\section{Motivation}
Writing papers should feel precise. The editor should show build feedback while keeping the source readable.

\section{Method}
The desktop app compiles with latexmk, renders the PDF, and connects source lines to preview positions.

\begin{equation}
L(\theta) = \sum_i \log p(y_i | x_i, \theta)
\end{equation}

\section{Result}
Authors can fix LaTeX issues, inspect citations, and prepare submissions faster.

\badcommand
\end{document}
`;

sourceEditor.value = sampleSource;

function setStatus(message, type = "ok") {
  statusText.textContent = message;
  buildState.textContent = message;
  statusDot.className = `status-dot ${type === "busy" ? "busy" : ""} ${
    type === "error" ? "error" : ""
  }`.trim();
}

function titleFromSource(source) {
  return source.match(/\\title\{([^}]+)\}/)?.[1] ?? "Untitled Paper";
}

function abstractFromSource(source) {
  return (
    source
      .match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ?? "No abstract found yet."
  );
}

function sectionsFromSource(source) {
  return Array.from(source.matchAll(/\\section\{([^}]+)\}/g), (match) => ({
    title: match[1],
    token: match[0],
    index: match.index ?? 0,
  }));
}

function wordsFromSource(source) {
  return source
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ")
    .replace(/[%$#_{}^]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function updateLines(activeLine = 0) {
  const lineTotal = sourceEditor.value.split("\n").length;
  editorLines.innerHTML = "";
  for (let index = 1; index <= lineTotal; index += 1) {
    const item = document.createElement("li");
    item.textContent = String(index);
    if (index === activeLine) item.classList.add("active");
    editorLines.append(item);
  }
}

function selectToken(token) {
  const index = sourceEditor.value.indexOf(token);
  if (index < 0) return;
  sourceEditor.focus();
  sourceEditor.setSelectionRange(index, index + token.length);
  const activeLine = sourceEditor.value.slice(0, index).split("\n").length;
  updateLines(activeLine);
  setStatus(`Jumped to source line ${activeLine}.`);
}

function buildDiagnostics(source) {
  const diagnostics = [];
  if (source.includes("\\badcommand")) {
    diagnostics.push({
      type: "error",
      title: "Undefined control sequence",
      detail: "The demo found \\badcommand. Press Fix to replace it.",
      token: "\\badcommand",
    });
  }
  if (!/\\cite[t|p]?\{/.test(source)) {
    diagnostics.push({
      type: "warn",
      title: "No citation in this sample",
      detail: "Insert a citation to preview citation-aware checks.",
      token: "\\section{Motivation}",
    });
  }
  if (sectionsFromSource(source).length < 3) {
    diagnostics.push({
      type: "warn",
      title: "Short structure",
      detail: "Papers are easier to scan with clear sections.",
      token: "\\section",
    });
  }
  if (!diagnostics.length) {
    diagnostics.push({
      type: "ok",
      title: "Browser demo checks passed",
      detail: "The desktop app adds real compiler logs and PDF compliance checks.",
      token: "\\begin{document}",
    });
  }
  return diagnostics;
}

function renderDiagnostics(diagnostics) {
  diagnosticsList.innerHTML = "";
  diagnostics.forEach((diagnostic) => {
    const item = document.createElement("li");
    item.className = diagnostic.type;
    item.innerHTML = `<strong>${diagnostic.title}</strong><span>${diagnostic.detail}</span>`;
    item.addEventListener("click", () => selectToken(diagnostic.token));
    diagnosticsList.append(item);
  });
  const issueTotal = diagnostics.filter((item) => item.type !== "ok").length;
  checkCount.textContent = issueTotal === 1 ? "1 issue" : `${issueTotal} issues`;
}

function renderPreview(source) {
  const sections = sectionsFromSource(source);
  pdfTitle.textContent = titleFromSource(source);
  pdfAbstract.textContent = abstractFromSource(source);
  pdfSections.innerHTML = "";
  sections.slice(0, 4).forEach((section) => {
    const block = document.createElement("div");
    block.className = "pdf-section";
    block.dataset.token = section.token;
    block.innerHTML = `<h3>${section.title}</h3><p>${previewText(section.title)}</p>`;
    block.addEventListener("click", () => {
      document.querySelectorAll(".pdf-section").forEach((item) => {
        item.classList.remove("active");
      });
      block.classList.add("active");
      selectToken(section.token);
    });
    pdfSections.append(block);
  });
}

function previewText(title) {
  const lower = title.toLowerCase();
  if (lower.includes("motivation")) {
    return "A focused writing surface reduces context switching while preserving precision.";
  }
  if (lower.includes("method")) {
    return "The desktop app connects source, build output, and rendered PDF locations.";
  }
  if (lower.includes("result")) {
    return "Authors keep review, diagnostics, and submission checks in the same workspace.";
  }
  return "LatexDo turns paper editing into a clear source-to-preview workflow.";
}

function compileDemo() {
  setStatus("Compiling browser preview...", "busy");
  compileButton.disabled = true;
  window.setTimeout(() => {
    const source = sourceEditor.value;
    const diagnostics = buildDiagnostics(source);
    renderPreview(source);
    renderDiagnostics(diagnostics);
    wordCount.textContent = String(wordsFromSource(source).length);
    citationCount.textContent = String((source.match(/\\cite[t|p]?\{/g) ?? []).length);
    sectionCount.textContent = String(sectionsFromSource(source).length);
    compileButton.disabled = false;
    const hasError = diagnostics.some((item) => item.type === "error");
    setStatus(
      hasError
        ? "Preview built with one fixable demo error."
        : "Preview built. Install the desktop app for real PDF compilation.",
      hasError ? "error" : "ok",
    );
  }, 360);
}

function insertAtCursor(text) {
  const start = sourceEditor.selectionStart;
  const end = sourceEditor.selectionEnd;
  sourceEditor.value =
    sourceEditor.value.slice(0, start) + text + sourceEditor.value.slice(end);
  sourceEditor.focus();
  sourceEditor.setSelectionRange(start + text.length, start + text.length);
  updateLines();
}

insertCitationButton.addEventListener("click", () => {
  insertAtCursor(" \\cite{latexdo2026}");
  compileDemo();
});

fixErrorButton.addEventListener("click", () => {
  if (sourceEditor.value.includes("\\badcommand")) {
    sourceEditor.value = sourceEditor.value.replace(
      "\\badcommand",
      "\\textbf{Ready for submission.}",
    );
    selectToken("\\textbf{Ready for submission.}");
    compileDemo();
  } else {
    setStatus("No demo error is present.");
  }
});

syncSourceButton.addEventListener("click", () => {
  selectToken("\\begin{equation}");
});

compileButton.addEventListener("click", compileDemo);

sourceEditor.addEventListener("input", () => {
  updateLines();
  setStatus("Source changed. Compile the browser preview.", "busy");
});

sourceEditor.addEventListener("scroll", () => {
  editorLines.scrollTop = sourceEditor.scrollTop;
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    modeButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    setStatus(`${button.dataset.mode} mode selected in the browser preview.`);
  });
});

document.querySelector(".pdf-equation")?.addEventListener("click", () => {
  selectToken("\\begin{equation}");
});

updateLines();
compileDemo();
