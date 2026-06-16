import { describe, it, expect } from "vitest";
import { runStructureChecks } from "../structureAssistant";
import { runAcronymChecks } from "../acronymManager";
import { runCitationChecks } from "../citationAssistant";
import { runReproducibilityChecks } from "../reproducibility";
import { runNotationChecks } from "../notationManager";
import { runPdfComplianceChecks } from "../pdfCompliance";
import { runConferenceChecks } from "../conferenceChecker";
import { analyzeCompileOutput } from "../errorDoctor";
import type {
  StructureAssistantSettings, AcronymManagerSettings, CitationAssistantSettings,
  ReproducibilitySettings, NotationManagerSettings, PdfComplianceSettings,
  ConferenceCheckerSettings, ErrorDoctorSettings, ConferenceRequirements,
} from "../../types";

const baseDoc = "\\documentclass{article}\\begin{document}\\section{Intro}Content.\\section{Method}Approach.\\section{Results}Data.\\section{Conclusion}Summary.\\end{document}";
const output = "Output written on paper.pdf (8 pages). No type 3 fonts.";

const confReqs: ConferenceRequirements = { name: "T", pageLimit: 10, sectionRequirements: ["Intro", "Method", "Results", "Conclusion"], formatStyle: "single-column", maxAbstractWords: 300, citationStyle: "numeric", figureRequirements: { maxFigures: 10, requiredFormats: ["PDF"] } };

// ── 1. Structure — all 2^9 combos (sampled 24) ──────────────────────────
const structCases: StructureAssistantSettings[] = [
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: true, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: true, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: true, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: true, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: true, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: true, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: true, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: true, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: false, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: true },
  { enabled: true, checkMissingAbstract: true, checkSectionOrder: true, checkSectionEmpty: true, checkFigurePlacement: true, checkTablePlacement: true, checkCrossReferences: true, checkEquationNumbering: true, checkAppendixFormat: true, checkConclusion: true },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: true, checkSectionEmpty: false, checkFigurePlacement: true, checkTablePlacement: false, checkCrossReferences: true, checkEquationNumbering: false, checkAppendixFormat: true, checkConclusion: false },
  { enabled: true, checkMissingAbstract: true, checkSectionOrder: false, checkSectionEmpty: true, checkFigurePlacement: false, checkTablePlacement: true, checkCrossReferences: false, checkEquationNumbering: true, checkAppendixFormat: false, checkConclusion: true },
  { enabled: true, checkMissingAbstract: true, checkSectionOrder: true, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: false, checkEquationNumbering: true, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: true, checkSectionEmpty: true, checkFigurePlacement: false, checkTablePlacement: false, checkCrossReferences: true, checkEquationNumbering: false, checkAppendixFormat: false, checkConclusion: false },
  { enabled: true, checkMissingAbstract: false, checkSectionOrder: true, checkSectionEmpty: false, checkFigurePlacement: false, checkTablePlacement: true, checkCrossReferences: false, checkEquationNumbering: true, checkAppendixFormat: false, checkConclusion: false },
];
describe("Structure — settings combos", () => {
  it.each(structCases)("config", (s) => {
    expect(Array.isArray(runStructureChecks(baseDoc, s))).toBe(true);
  });
});

// ── 2. Acronym — all 2^4 = 16 combos ────────────────────────────────────
const acroSettings: AcronymManagerSettings[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((mask) => ({
  enabled: true,
  checkUndefinedAcronym: !!(mask & 1),
  checkDuplicateDefinition: !!(mask & 2),
  checkUnusedAcronym: !!(mask & 4),
  checkConflictingDefinitions: !!(mask & 8),
}));
describe("Acronym — settings combos", () => {
  it.each(acroSettings)("config", (s) => {
    expect(Array.isArray(runAcronymChecks(baseDoc, s))).toBe(true);
  });
});

// ── 3. Citation — all 2^5 = 32 combos ───────────────────────────────────
const citeSettings: CitationAssistantSettings[] = Array.from({ length: 32 }, (_, mask) => ({
  enabled: true,
  checkMissingCitations: !!(mask & 1),
  checkInconsistentStyle: !!(mask & 2),
  checkMissingBibliography: !!(mask & 4),
  checkOvercitation: !!(mask & 8),
  checkStaleReferences: !!(mask & 16),
}));
describe("Citation — settings combos", () => {
  it.each(citeSettings)("config", (s) => {
    expect(Array.isArray(runCitationChecks(baseDoc, s))).toBe(true);
  });
});

// ── 4. Reproducibility — all 2^7 = 128 combos ───────────────────────────
const reproSettings: ReproducibilitySettings[] = Array.from({ length: 128 }, (_, mask) => ({
  enabled: true,
  checkCodeLink: !!(mask & 1),
  checkDatasetLink: !!(mask & 2),
  checkLicenseMentioned: !!(mask & 4),
  checkHyperparameters: !!(mask & 8),
  checkHardwareDetails: !!(mask & 16),
  checkRandomSeeds: !!(mask & 32),
  checkEvaluationMetrics: !!(mask & 64),
}));
describe("Reproducibility — settings combos", () => {
  it.each(reproSettings)("config", (s) => {
    expect(Array.isArray(runReproducibilityChecks(baseDoc, s))).toBe(true);
  });
});

// ── 5. Notation — all 2^3 = 8 combos ────────────────────────────────────
const notoSettings: NotationManagerSettings[] = Array.from({ length: 8 }, (_, mask) => ({
  enabled: true,
  detectSymbols: !!(mask & 1),
  detectConflicts: !!(mask & 2),
  detectUndefinedNotation: !!(mask & 4),
}));
describe("Notation — settings combos", () => {
  it.each(notoSettings)("config", (s) => {
    const r = runNotationChecks(baseDoc, s);
    expect(Array.isArray(r.diagnostics)).toBe(true);
    expect(Array.isArray(r.symbols)).toBe(true);
  });
});

// ── 6. PDF Compliance — all 2^6 = 64 combos ─────────────────────────────
const pdfSettings: PdfComplianceSettings[] = Array.from({ length: 64 }, (_, mask) => ({
  enabled: true, maxPages: 8, maxAbstractWords: 250,
  checkPageCount: !!(mask & 1),
  checkUnreferencedFigures: !!(mask & 2),
  checkUncitedCitations: !!(mask & 4),
  checkSectionsWithNoCitations: !!(mask & 8),
  checkType3Fonts: !!(mask & 16),
  checkAbstractWordCount: !!(mask & 32),
}));
describe("PDF Compliance — settings combos", () => {
  it.each(pdfSettings)("config", (s) => {
    expect(Array.isArray(runPdfComplianceChecks(baseDoc, output, s))).toBe(true);
  });
});

// ── 7. Conference — all 2^6 = 64 combos ─────────────────────────────────
const confSettings: ConferenceCheckerSettings[] = Array.from({ length: 64 }, (_, mask) => ({
  enabled: true,
  checkFormatting: !!(mask & 1),
  checkPageLimit: !!(mask & 2),
  checkSectionRequirements: !!(mask & 4),
  checkCitationStyle: !!(mask & 8),
  checkFigureRequirements: !!(mask & 16),
  checkAbstractLimit: !!(mask & 32),
}));
describe("Conference — settings combos", () => {
  it.each(confSettings)("config", (s) => {
    expect(Array.isArray(runConferenceChecks(baseDoc, output, confReqs, s))).toBe(true);
  });
});

// ── 8. Error Doctor — all 2^3 = 8 combos ────────────────────────────────
const errSettings: ErrorDoctorSettings[] = Array.from({ length: 8 }, (_, mask) => ({
  enabled: !!(mask & 1),
  explainErrors: !!(mask & 2),
  suggestFixes: !!(mask & 4),
  autoFixCommon: false,
}));
const errOutput = "! Undefined control sequence.\nl.10 \\bad\n! LaTeX Error: File `foo.sty' not found.";
describe("Error Doctor — settings combos", () => {
  it.each(errSettings)("config", (s) => {
    const r = analyzeCompileOutput(errOutput, baseDoc, s);
    expect(Array.isArray(r.diagnostics)).toBe(true);
    expect(typeof r.explain).toBe("string");
    expect(Array.isArray(r.fixes)).toBe(true);
  });
});
