type DiagnosticType = "error" | "warn" | "ok";
type StatusType = "ok" | "busy" | "error";

interface Diagnostic {
  type: DiagnosticType;
  title: string;
  detail: string;
  token: string;
}

interface DownloadFile {
  id: string;
  label: string;
  platform: string;
  arch: string;
  filename: string;
  note?: string;
  size?: number;
  sizeLabel?: string;
  sha256?: string;
  url: string;
}

interface DownloadManifest {
  version: string | null;
  publishedAt: string | null;
  downloadsPage: string;
  files: DownloadFile[];
}

const sampleSource = String.raw`\documentclass{article}
\title{Reliable Paper Writing}
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

function query<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function queryAll<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

function setText(selector: string, text: string): void {
  const element = query(selector);
  if (element) element.textContent = text;
}

function titleFromSource(source: string): string {
  return source.match(/\\title\{([^}]+)\}/)?.[1] ?? "Untitled Paper";
}

function abstractFromSource(source: string): string {
  return (
    source
      .match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ?? "No abstract found yet."
  );
}

function sectionsFromSource(source: string): Array<{ title: string; token: string }> {
  return Array.from(source.matchAll(/\\section\{([^}]+)\}/g), (match) => ({
    title: match[1] ?? "Section",
    token: match[0],
  }));
}

function wordsFromSource(source: string): string[] {
  return source
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ")
    .replace(/[%$#_{}^]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function previewText(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("motivation")) {
    return "A focused writing surface reduces switching while preserving source precision.";
  }
  if (lower.includes("method")) {
    return "The desktop app connects source, build output, and rendered PDF locations.";
  }
  if (lower.includes("result")) {
    return "Authors keep review, diagnostics, and submission checks in the same workspace.";
  }
  return "LatexDo turns paper editing into a clear source-to-preview workflow.";
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return "Installer";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "latest build";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "latest build";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initNavigation(): void {
  const toggle = query<HTMLButtonElement>("[data-nav-toggle]");
  const links = query<HTMLElement>("[data-nav-links]");
  if (!toggle || !links) return;

  toggle.addEventListener("click", () => {
    const open = !links.classList.contains("open");
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  links.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

function initReveal(): void {
  const elements = queryAll<HTMLElement>(".reveal");
  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 },
  );

  elements.forEach((element) => observer.observe(element));
}

function initHeroCommands(): void {
  const state = query<HTMLElement>("[data-hero-build-state]");
  const commands = queryAll<HTMLButtonElement>("[data-hero-command]");
  const labels: Record<string, string> = {
    compile: "Compiled",
    review: "Review ready",
    export: "PDF exported",
  };

  commands.forEach((button) => {
    button.addEventListener("click", () => {
      commands.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const command = button.dataset.heroCommand ?? "compile";
      if (state) state.textContent = labels[command] ?? "Ready";
    });
  });
}

function initEditorDemo(): void {
  const sourceEditor = query<HTMLTextAreaElement>("#source-editor");
  const editorLines = query<HTMLOListElement>("#editor-lines");
  const compileButton = query<HTMLButtonElement>("#compile-demo");
  const insertCitationButton = query<HTMLButtonElement>("#insert-citation");
  const fixErrorButton = query<HTMLButtonElement>("#fix-error");
  const syncSourceButton = query<HTMLButtonElement>("#sync-source");
  const statusText = query<HTMLElement>("#status-text");
  const statusDot = query<HTMLElement>("#status-dot");
  const buildState = query<HTMLElement>("#build-state");
  const diagnosticsList = query<HTMLUListElement>("#diagnostics");
  const pdfSections = query<HTMLElement>("#pdf-sections");
  const modeButtons = queryAll<HTMLButtonElement>(".mode");

  if (
    !sourceEditor ||
    !editorLines ||
    !compileButton ||
    !statusText ||
    !statusDot ||
    !buildState ||
    !diagnosticsList ||
    !pdfSections
  ) {
    return;
  }

  sourceEditor.value = sampleSource;

  const setStatus = (message: string, type: StatusType = "ok") => {
    statusText.textContent = message;
    buildState.textContent = message;
    statusDot.className = `status-dot ${type === "busy" ? "busy" : ""} ${
      type === "error" ? "error" : ""
    }`.trim();
  };

  const updateLines = (activeLine = 0) => {
    const lineTotal = sourceEditor.value.split("\n").length;
    editorLines.innerHTML = "";
    for (let index = 1; index <= lineTotal; index += 1) {
      const item = document.createElement("li");
      item.textContent = String(index);
      if (index === activeLine) item.classList.add("active");
      editorLines.append(item);
    }
  };

  const selectToken = (token: string) => {
    const index = sourceEditor.value.indexOf(token);
    if (index < 0) return;
    sourceEditor.focus();
    sourceEditor.setSelectionRange(index, index + token.length);
    const activeLine = sourceEditor.value.slice(0, index).split("\n").length;
    updateLines(activeLine);
    setStatus(`Jumped to source line ${activeLine}.`);
  };

  const buildDiagnostics = (source: string): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
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
        title: "Preview checks passed",
        detail: "The desktop app adds real compiler logs and PDF compliance checks.",
        token: "\\begin{document}",
      });
    }
    return diagnostics;
  };

  const renderDiagnostics = (diagnostics: Diagnostic[]) => {
    diagnosticsList.innerHTML = "";
    diagnostics.forEach((diagnostic) => {
      const item = document.createElement("li");
      item.className = diagnostic.type;
      item.innerHTML = `<strong>${escapeHtml(diagnostic.title)}</strong><span>${escapeHtml(
        diagnostic.detail,
      )}</span>`;
      item.addEventListener("click", () => selectToken(diagnostic.token));
      diagnosticsList.append(item);
    });
    const issueTotal = diagnostics.filter((item) => item.type !== "ok").length;
    setText("#check-count", issueTotal === 1 ? "1 issue" : `${issueTotal} issues`);
  };

  const renderPreview = (source: string) => {
    const sections = sectionsFromSource(source);
    setText("#pdf-title", titleFromSource(source));
    setText("#pdf-abstract", abstractFromSource(source));
    pdfSections.innerHTML = "";
    sections.slice(0, 4).forEach((section) => {
      const block = document.createElement("div");
      block.className = "pdf-section";
      block.dataset.token = section.token;
      block.innerHTML = `<h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(
        previewText(section.title),
      )}</p>`;
      block.addEventListener("click", () => {
        queryAll(".pdf-section").forEach((item) => item.classList.remove("active"));
        block.classList.add("active");
        selectToken(section.token);
      });
      pdfSections.append(block);
    });
  };

  const compileDemo = () => {
    setStatus("Compiling preview...", "busy");
    compileButton.disabled = true;
    window.setTimeout(() => {
      const source = sourceEditor.value;
      const diagnostics = buildDiagnostics(source);
      renderPreview(source);
      renderDiagnostics(diagnostics);
      setText("#word-count", String(wordsFromSource(source).length));
      setText(
        "#citation-count",
        String((source.match(/\\cite[t|p]?\{/g) ?? []).length),
      );
      setText("#section-count", String(sectionsFromSource(source).length));
      compileButton.disabled = false;
      const hasError = diagnostics.some((item) => item.type === "error");
      setStatus(
        hasError
          ? "Preview built with one fixable error."
          : "Preview built. Desktop compilation is available in the app.",
        hasError ? "error" : "ok",
      );
    }, 280);
  };

  const insertAtCursor = (text: string) => {
    const start = sourceEditor.selectionStart;
    const end = sourceEditor.selectionEnd;
    sourceEditor.value =
      sourceEditor.value.slice(0, start) + text + sourceEditor.value.slice(end);
    sourceEditor.focus();
    sourceEditor.setSelectionRange(start + text.length, start + text.length);
    updateLines();
  };

  insertCitationButton?.addEventListener("click", () => {
    insertAtCursor(" \\cite{latexdo2026}");
    compileDemo();
  });

  fixErrorButton?.addEventListener("click", () => {
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

  syncSourceButton?.addEventListener("click", () => selectToken("\\begin{equation}"));
  compileButton.addEventListener("click", compileDemo);
  sourceEditor.addEventListener("input", () => {
    updateLines();
    setStatus("Source changed. Compile the preview.", "busy");
  });
  sourceEditor.addEventListener("scroll", () => {
    editorLines.scrollTop = sourceEditor.scrollTop;
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      modeButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      setStatus(`${button.dataset.mode ?? "author"} mode selected.`);
    });
  });

  query(".pdf-equation")?.addEventListener("click", () =>
    selectToken("\\begin{equation}"),
  );
  updateLines();
  compileDemo();
}

function renderDownloadFallback(container: HTMLElement): void {
  container.innerHTML = `
    <article class="download-card">
      <h3>Downloads page</h3>
      <p>Open the direct downloads page for macOS and Windows installers.</p>
      <a class="button primary" href="downloads/">View downloads</a>
    </article>
    <article class="download-card">
      <h3>Update manifest</h3>
      <p>The desktop app checks the public manifest for update information.</p>
      <a class="button secondary" href="downloads/manifest.json">View manifest</a>
    </article>
    <article class="download-card">
      <h3>Checksums</h3>
      <p>Verify installer integrity with SHA-256 checksums from the website.</p>
      <a class="button secondary" href="downloads/SHA256SUMS.txt">View checksums</a>
    </article>`;
}

async function initDownloads(): Promise<void> {
  const container = query<HTMLElement>("#download-grid");
  if (!container) return;

  try {
    const response = await fetch("downloads/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
    const manifest = (await response.json()) as DownloadManifest;
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!files.length) {
      renderDownloadFallback(container);
      return;
    }

    container.innerHTML = files
      .map((file) => {
        const label = escapeHtml(file.label || file.id);
        const note = escapeHtml(file.note || `${file.platform} ${file.arch}`);
        const meta = escapeHtml(
          `${file.sizeLabel ?? formatBytes(file.size)} · ${formatDate(manifest.publishedAt)}`,
        );
        const url = escapeHtml(file.url || `downloads/files/${file.filename}`);
        return `<article class="download-card">
          <div>
            <h3>${label}</h3>
            <p>${note}</p>
            <small>${meta}</small>
          </div>
          <a class="button primary" href="${url}">Download</a>
        </article>`;
      })
      .join("");
  } catch {
    renderDownloadFallback(container);
  }
}

function initFooter(): void {
  const year = new Date().getFullYear();
  setText("#copyright", `Copyright ${year} LatexDo.`);
}

function init(): void {
  initNavigation();
  initReveal();
  initHeroCommands();
  initEditorDemo();
  void initDownloads();
  initFooter();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
