import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Copy, Plus, Search } from "lucide-react";
import type { NotedSymbol } from "../types";
import { analyzeNotation } from "../checks/notationManager";

interface NotationManagerProps {
  content: string;
  onInsertCode?: (code: string) => void;
}

interface NotationEntry {
  symbol: string;
  description: string;
}

interface EquationTemplate {
  label: string;
  code: string;
  desc: string;
  preview: ReactNode;
  previewKind?:
    | "inline"
    | "equation"
    | "align"
    | "cases"
    | "matrix"
    | "fraction"
    | "definition";
}

function equationPreview(value: string, number?: string): ReactNode {
  return (
    <span className="notation-preview-equation">
      <span>{value}</span>
      {number ? <span className="notation-preview-number">{number}</span> : null}
    </span>
  );
}

function alignPreview(): ReactNode {
  return (
    <span className="notation-preview-align">
      <span>
        <em>a</em>
        <strong>=</strong>
        <em>b</em>
      </span>
      <span>
        <strong>=</strong>
        <em>c</em>
      </span>
    </span>
  );
}

function casesPreview(): ReactNode {
  return (
    <span className="notation-preview-cases">
      <span className="notation-preview-cases-left">f(x) =</span>
      <span className="notation-preview-cases-brace">{`{`}</span>
      <span className="notation-preview-cases-rows">
        <span>
          <strong>0</strong>
          <em>x &lt; 0</em>
        </span>
        <span>
          <strong>1</strong>
          <em>{"x >= 0"}</em>
        </span>
      </span>
    </span>
  );
}

function matrixPreview(): ReactNode {
  return (
    <span className="notation-preview-matrix">
      <span>a</span>
      <span>b</span>
      <span>c</span>
      <span>d</span>
    </span>
  );
}

function fractionPreview(): ReactNode {
  return (
    <span className="notation-preview-fraction">
      <span>a</span>
      <span>b</span>
    </span>
  );
}

function operatorPreview(
  symbol: string,
  upper: string,
  lower: string,
  body: string,
): ReactNode {
  return (
    <span className="notation-preview-operator">
      <span className="notation-preview-limits">
        <span>{upper}</span>
        <strong>{symbol}</strong>
        <span>{lower}</span>
      </span>
      <span>{body}</span>
    </span>
  );
}

type NotationTab = "templates" | "symbols" | "custom";

const NOTATION_TABS: Array<{ id: NotationTab; label: string }> = [
  { id: "templates", label: "Templates" },
  { id: "symbols", label: "Symbols" },
  { id: "custom", label: "Custom" },
];

const EQUATION_TEMPLATES: EquationTemplate[] = [
  {
    label: "Inline",
    code: "$x$",
    desc: "Inline math",
    preview: <span className="notation-preview-inline">x</span>,
    previewKind: "inline",
  },
  {
    label: "Display",
    code: "\\[\n  x = y\n\\]",
    desc: "Unnumbered display math",
    preview: equationPreview("x = y"),
    previewKind: "equation",
  },
  {
    label: "Equation",
    code: "\\begin{equation}\n  \\label{eq:label}\n  x = y\n\\end{equation}",
    desc: "Numbered equation",
    preview: equationPreview("x = y", "(1)"),
    previewKind: "equation",
  },
  {
    label: "Align",
    code: "\\begin{align}\n  a &= b \\\\\n    &= c\n\\end{align}",
    desc: "Aligned multi-line equations",
    preview: alignPreview(),
    previewKind: "align",
  },
  {
    label: "Cases",
    code:
      "\\begin{equation}\n" +
      "  f(x) = \\begin{cases}\n" +
      "    0, & x < 0 \\\\\n" +
      "    1, & x \\ge 0\n" +
      "  \\end{cases}\n" +
      "\\end{equation}",
    desc: "Piecewise definition",
    preview: casesPreview(),
    previewKind: "cases",
  },
  {
    label: "Matrix",
    code: "\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}",
    desc: "Bracketed matrix",
    preview: matrixPreview(),
    previewKind: "matrix",
  },
  {
    label: "Fraction",
    code: "\\frac{a}{b}",
    desc: "Fraction",
    preview: fractionPreview(),
    previewKind: "fraction",
  },
  {
    label: "Sum",
    code: "\\sum_{i=1}^{n} x_i",
    desc: "Summation",
    preview: operatorPreview("Σ", "n", "i=1", "x_i"),
    previewKind: "equation",
  },
  {
    label: "Integral",
    code: "\\int_{a}^{b} f(x)\\,dx",
    desc: "Definite integral",
    preview: operatorPreview("∫", "b", "a", "f(x) dx"),
    previewKind: "equation",
  },
  {
    label: "Norm",
    code: "\\left\\lVert x \\right\\rVert_2",
    desc: "Vector norm",
    preview: (
      <span className="notation-preview-expression">
        ||x||<sub>2</sub>
      </span>
    ),
    previewKind: "equation",
  },
  {
    label: "Expectation",
    code: "\\mathbb{E}\\left[X\\right]",
    desc: "Expected value",
    preview: <span className="notation-preview-expression">E[X]</span>,
    previewKind: "equation",
  },
  {
    label: "Definition",
    code: "\\newcommand{\\mySymbol}{x}",
    desc: "Reusable notation command",
    preview: <span className="notation-preview-definition">{"\\mySymbol := x"}</span>,
    previewKind: "definition",
  },
];

const SYMBOL_PALETTE = [
  { latex: "\\alpha", display: "α" },
  { latex: "\\beta", display: "β" },
  { latex: "\\gamma", display: "γ" },
  { latex: "\\delta", display: "δ" },
  { latex: "\\epsilon", display: "ε" },
  { latex: "\\varepsilon", display: "ε" },
  { latex: "\\zeta", display: "ζ" },
  { latex: "\\eta", display: "η" },
  { latex: "\\theta", display: "θ" },
  { latex: "\\vartheta", display: "ϑ" },
  { latex: "\\iota", display: "ι" },
  { latex: "\\kappa", display: "κ" },
  { latex: "\\lambda", display: "λ" },
  { latex: "\\mu", display: "μ" },
  { latex: "\\nu", display: "ν" },
  { latex: "\\xi", display: "ξ" },
  { latex: "\\pi", display: "π" },
  { latex: "\\varpi", display: "ϖ" },
  { latex: "\\rho", display: "ρ" },
  { latex: "\\sigma", display: "σ" },
  { latex: "\\tau", display: "τ" },
  { latex: "\\upsilon", display: "υ" },
  { latex: "\\phi", display: "φ" },
  { latex: "\\varphi", display: "φ" },
  { latex: "\\chi", display: "χ" },
  { latex: "\\psi", display: "ψ" },
  { latex: "\\omega", display: "ω" },
  { latex: "\\Gamma", display: "Γ" },
  { latex: "\\Delta", display: "Δ" },
  { latex: "\\Theta", display: "Θ" },
  { latex: "\\Lambda", display: "Λ" },
  { latex: "\\Xi", display: "Ξ" },
  { latex: "\\Pi", display: "Π" },
  { latex: "\\Sigma", display: "Σ" },
  { latex: "\\Phi", display: "Φ" },
  { latex: "\\Psi", display: "Ψ" },
  { latex: "\\Omega", display: "Ω" },
  { latex: "\\mathcal{A}", display: "𝒜" },
  { latex: "\\mathcal{B}", display: "ℬ" },
  { latex: "\\mathcal{C}", display: "𝒞" },
  { latex: "\\mathcal{D}", display: "𝒟" },
  { latex: "\\mathcal{L}", display: "ℒ" },
  { latex: "\\mathcal{M}", display: "ℳ" },
  { latex: "\\mathcal{N}", display: "𝒩" },
  { latex: "\\mathcal{R}", display: "ℛ" },
  { latex: "\\mathbb{R}", display: "ℝ" },
  { latex: "\\mathbb{N}", display: "ℕ" },
  { latex: "\\mathbb{Z}", display: "ℤ" },
  { latex: "\\mathbb{Q}", display: "ℚ" },
  { latex: "\\mathbb{C}", display: "ℂ" },
  { latex: "\\mathbf{x}", display: "𝐱" },
  { latex: "\\mathbf{w}", display: "𝐰" },
  { latex: "\\mathbf{y}", display: "𝐲" },
  { latex: "\\infty", display: "∞" },
  { latex: "\\partial", display: "∂" },
  { latex: "\\nabla", display: "∇" },
  { latex: "\\sum", display: "∑" },
  { latex: "\\prod", display: "∏" },
  { latex: "\\int", display: "∫" },
  { latex: "\\iint", display: "∬" },
  { latex: "\\iiint", display: "∭" },
  { latex: "\\oint", display: "∮" },
  { latex: "\\to", display: "→" },
  { latex: "\\mapsto", display: "↦" },
  { latex: "\\rightarrow", display: "→" },
  { latex: "\\leftarrow", display: "←" },
  { latex: "\\Rightarrow", display: "⇒" },
  { latex: "\\Leftarrow", display: "⇐" },
  { latex: "\\approx", display: "≈" },
  { latex: "\\sim", display: "∼" },
  { latex: "\\simeq", display: "≃" },
  { latex: "\\cong", display: "≅" },
  { latex: "\\equiv", display: "≡" },
  { latex: "\\propto", display: "∝" },
  { latex: "\\subset", display: "⊂" },
  { latex: "\\supset", display: "⊃" },
  { latex: "\\subseteq", display: "⊆" },
  { latex: "\\supseteq", display: "⊇" },
  { latex: "\\in", display: "∈" },
  { latex: "\\notin", display: "∉" },
  { latex: "\\forall", display: "∀" },
  { latex: "\\exists", display: "∃" },
  { latex: "\\neg", display: "¬" },
  { latex: "\\emptyset", display: "∅" },
  { latex: "\\varnothing", display: "∅" },
  { latex: "\\cup", display: "∪" },
  { latex: "\\cap", display: "∩" },
  { latex: "\\oplus", display: "⊕" },
  { latex: "\\otimes", display: "⊗" },
  { latex: "\\pm", display: "±" },
  { latex: "\\times", display: "×" },
  { latex: "\\div", display: "÷" },
  { latex: "\\cdot", display: "·" },
  { latex: "\\circ", display: "∘" },
];

export function NotationManager({ content, onInsertCode }: NotationManagerProps) {
  const [customEntries, setCustomEntries] = useState<NotationEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<NotationTab>("templates");
  const [newSymbol, setNewSymbol] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const analysis = useMemo(() => {
    return analyzeNotation(content);
  }, [content]);
  const undefinedCount = analysis.filter((symbol) => !symbol.defined).length;
  const conflictCount = analysis.filter(
    (symbol) => symbol.similarSymbols.length > 0,
  ).length;
  const activeTabLabel =
    NOTATION_TABS.find((tab) => tab.id === activeTab)?.label ?? activeTab;

  const filteredPalette = useMemo(() => {
    if (!searchQuery) return SYMBOL_PALETTE;
    const q = searchQuery.toLowerCase();
    return SYMBOL_PALETTE.filter(
      (s) => s.latex.toLowerCase().includes(q) || s.display.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const handleAddCustomEntry = useCallback(() => {
    if (!newSymbol.trim()) return;
    setCustomEntries((prev) => [
      ...prev,
      {
        symbol: newSymbol.trim(),
        description: newDescription.trim(),
      },
    ]);
    setNewSymbol("");
    setNewDescription("");
  }, [newSymbol, newDescription]);

  const handleInsertDefinition = useCallback(
    (symbol: string) => {
      if (!onInsertCode) return;
      const code = `\\newcommand{\\${symbol.replace(/^\\/, "")}}{${symbol}}`;
      onInsertCode(code);
    },
    [onInsertCode],
  );

  const handleCopy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const handleInsertEquation = useCallback(
    (template: string) => {
      if (!onInsertCode) return;
      onInsertCode(template);
    },
    [onInsertCode],
  );

  return (
    <div className="notation-manager-root">
      <section
        className="notation-manager-detected-area"
        aria-label="Detected notation"
      >
        <div className="notation-manager-section-header">
          <span>Detected Notation</span>
          <span className="notation-manager-section-count">
            {analysis.length} symbols
          </span>
        </div>
        <div className="notation-manager-summary">
          <span>{undefinedCount} undefined</span>
          <span>{conflictCount} conflicts</span>
          <span>
            {copied
              ? `Copied ${copied.length > 22 ? `${copied.slice(0, 22)}...` : copied}`
              : "Live from active document"}
          </span>
        </div>
        {analysis.length > 0 ? (
          <div className="notation-manager-detected">
            {analysis.map((sym: NotedSymbol, i: number) => (
              <div key={i} className="notation-manager-detected-item">
                <div className="notation-manager-detected-header">
                  <code className="notation-manager-detected-symbol">{sym.symbol}</code>
                  <span
                    className={`notation-manager-detected-badge ${
                      sym.defined ? "defined" : "undefined"
                    }`}
                  >
                    {sym.defined ? "Defined" : "Undefined"}
                  </span>
                  <span className="notation-manager-detected-count">
                    {sym.usageCount}x
                  </span>
                </div>
                <div className="notation-manager-detected-location">
                  line {sym.firstUseLine} · {sym.firstUseSection}
                </div>
                {sym.similarSymbols.length > 0 && (
                  <div className="notation-manager-detected-conflict">
                    Similar: {sym.similarSymbols.join(", ")}
                  </div>
                )}
                <div className="notation-manager-detected-actions">
                  <button
                    className="notation-manager-copy-btn"
                    onClick={() => handleCopy(sym.symbol)}
                  >
                    Copy
                  </button>
                  {!sym.defined && (
                    <button
                      className="notation-manager-def-btn"
                      onClick={() => handleInsertDefinition(sym.symbol)}
                    >
                      Define
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="notation-manager-empty">
            No notation symbols detected in the active document.
          </div>
        )}
      </section>

      <section className="notation-manager-tools-area" aria-label="Notation tools">
        <div className="notation-manager-tools-header">
          <span>Notation Tools</span>
          <span>{activeTabLabel}</span>
        </div>

        <div className="notation-manager-tabs">
          {NOTATION_TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="notation-manager-body">
          {activeTab === "templates" ? (
            <div className="notation-manager-section notation-manager-section-fill">
              <div className="notation-manager-section-header">
                <span>Equation Templates & Math Blocks</span>
              </div>
              <div className="notation-manager-templates">
                {EQUATION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    className="notation-manager-template-btn"
                    onClick={() => handleInsertEquation(tpl.code)}
                    title={tpl.desc}
                  >
                    <span
                      className={`notation-manager-template-preview ${
                        tpl.previewKind ?? "equation"
                      }`}
                      aria-label={`${tpl.label} output preview`}
                    >
                      {tpl.preview}
                    </span>
                    <span className="notation-manager-template-label">{tpl.label}</span>
                    <span className="notation-manager-template-desc">{tpl.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {activeTab === "symbols" ? (
            <div className="notation-manager-section notation-manager-section-fill">
              <div className="notation-manager-section-header">
                <span>Symbol Palette</span>
                <span className="notation-manager-section-count">
                  {filteredPalette.length} symbols
                </span>
              </div>
              <div className="notation-manager-search">
                <Search size={13} />
                <input
                  type="text"
                  placeholder="Search symbols..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="notation-manager-palette">
                {filteredPalette.map((sym) => (
                  <button
                    key={sym.latex}
                    className="notation-manager-symbol-btn"
                    onClick={() => handleCopy(sym.latex)}
                    title={`${sym.latex} — Click to copy`}
                  >
                    <span className="notation-manager-symbol-display">
                      {sym.display}
                    </span>
                    <span className="notation-manager-symbol-latex">{sym.latex}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {activeTab === "custom" ? (
            <div className="notation-manager-section notation-manager-section-fill">
              <div className="notation-manager-section-header">
                <span>Custom Notation</span>
                <span className="notation-manager-section-count">
                  {customEntries.length} entries
                </span>
              </div>
              <div className="notation-manager-custom-form">
                <input
                  type="text"
                  placeholder="\\lambda"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  className="notation-manager-custom-input"
                />
                <input
                  type="text"
                  placeholder="Description (e.g., regularization weight)"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="notation-manager-custom-input"
                />
                <button
                  className="notation-manager-custom-add"
                  onClick={handleAddCustomEntry}
                  disabled={!newSymbol.trim()}
                >
                  <Plus size={13} /> Add
                </button>
              </div>
              {customEntries.length > 0 ? (
                <div className="notation-manager-custom-list">
                  {customEntries.map((entry, i) => (
                    <div key={i} className="notation-manager-custom-item">
                      <code className="notation-manager-custom-symbol">
                        {entry.symbol}
                      </code>
                      <span className="notation-manager-custom-desc">
                        {entry.description}
                      </span>
                      <button
                        className="notation-manager-copy-btn"
                        onClick={() => {
                          const def = `\\newcommand{\\${entry.symbol.replace(/^\\/, "")}}{${entry.symbol}}`;
                          handleCopy(def);
                        }}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="notation-manager-empty">No custom notation yet.</div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
