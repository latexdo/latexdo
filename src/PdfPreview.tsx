import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { BookOpenText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BibliographyPreviewPopover } from "./components/BibliographyPreviewPopover";
import type { CitationEntry } from "./latex/latexIndex";
import type { SyncTexPdfLocation } from "./types";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfClickLocation {
  page: number;
  x: number;
  y: number;
  word?: string;
}

interface PdfPreviewProps {
  data: Uint8Array;
  scale: number;
  rotation?: number;
  target: SyncTexPdfLocation | null;
  onNavigate?: (location: PdfClickLocation) => void;
  citationEntries?: CitationEntry[];
  onShowCitation?: (key: string) => void;
  onOpenExternal?: (url: string) => void;
}

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  target: SyncTexPdfLocation | null;
  onNavigate?: (location: PdfClickLocation) => void;
  citationEntriesByKey: Map<string, CitationEntry>;
  onShowCitation?: (key: string) => void;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CitationAnchor extends HighlightRect {
  key: string;
}

type PdfAnnotation = {
  rect?: unknown;
  dest?: unknown;
  url?: unknown;
  unsafeUrl?: unknown;
  title?: unknown;
  contents?: unknown;
};

const wordPattern = /[\p{L}\p{N}_'-]+/gu;

function wordsIn(text: string): Array<{ word: string; start: number; end: number }> {
  return Array.from(text.matchAll(wordPattern), (match) => ({
    word: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function wordAtPoint(event: React.MouseEvent): string | undefined {
  const element = event.target instanceof Element ? event.target : null;
  const span = element?.closest(".textLayer span");
  if (!(span instanceof HTMLElement)) {
    return undefined;
  }

  const text = span.textContent ?? "";
  const words = wordsIn(text);
  if (!words.length) {
    return undefined;
  }

  const pointDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = pointDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
  let offset = -1;
  if (range?.startContainer.nodeType === Node.TEXT_NODE) {
    offset = range.startOffset;
  }

  if (offset < 0) {
    const bounds = span.getBoundingClientRect();
    const ratio =
      bounds.width > 0
        ? Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
        : 0;
    offset = Math.round(text.length * ratio);
  }

  return (
    words.find(({ start, end }) => offset >= start && offset <= end)?.word ??
    words.reduce((nearest, word) =>
      Math.abs((word.start + word.end) / 2 - offset) <
      Math.abs((nearest.start + nearest.end) / 2 - offset)
        ? word
        : nearest,
    ).word
  );
}

function findWordHighlight(
  textLayer: HTMLElement,
  pageElement: HTMLElement,
  word: string,
  targetX: number,
  targetY: number,
): HighlightRect | null {
  const pageBounds = pageElement.getBoundingClientRect();
  let best:
    | {
        distance: number;
        rect: HighlightRect;
      }
    | undefined;

  for (const span of textLayer.querySelectorAll("span")) {
    const textNode = Array.from(span.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    const text = textNode?.textContent ?? "";
    let start = text.indexOf(word);

    while (textNode && start >= 0) {
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + word.length);
      const bounds = range.getBoundingClientRect();
      const rect = {
        left: bounds.left - pageBounds.left,
        top: bounds.top - pageBounds.top,
        width: bounds.width,
        height: bounds.height,
      };
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(centerX - targetX, centerY - targetY);

      if (!best || distance < best.distance) {
        best = { distance, rect };
      }
      start = text.indexOf(word, start + word.length);
    }
  }

  return best?.rect ?? null;
}

function textValuesFromAnnotationValue(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(textValuesFromAnnotationValue);
  }
  if (value && typeof value === "object") {
    const fields = value as { name?: unknown; url?: unknown; unsafeUrl?: unknown };
    return [
      ...textValuesFromAnnotationValue(fields.name),
      ...textValuesFromAnnotationValue(fields.url),
      ...textValuesFromAnnotationValue(fields.unsafeUrl),
    ];
  }
  return [];
}

function decodeAnnotationToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function candidateKeysFromAnnotationText(text: string): string[] {
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9_:./-]*/g) ?? [];
  const candidates: string[] = [];

  for (const token of tokens) {
    for (const value of [token, decodeAnnotationToken(token)]) {
      candidates.push(value);
      candidates.push(value.replace(/^(?:cite|bib)[.:_-]+/i, ""));

      const markerMatch = value.match(/(?:^|[#:./_-])(?:cite|bib)[.:_-]+(.+)$/i);
      if (markerMatch) {
        candidates.push(markerMatch[1]);
      }
    }
  }

  return candidates;
}

function citationKeyFromAnnotation(
  annotation: PdfAnnotation,
  citationEntriesByKey: Map<string, CitationEntry>,
): string | null {
  if (!citationEntriesByKey.size) {
    return null;
  }

  const texts = [
    annotation.dest,
    annotation.url,
    annotation.unsafeUrl,
    annotation.title,
    annotation.contents,
  ].flatMap(textValuesFromAnnotationValue);

  for (const text of texts) {
    for (const candidate of candidateKeysFromAnnotationText(text)) {
      if (citationEntriesByKey.has(candidate)) {
        return candidate;
      }
    }
  }

  const loweredTexts = texts.map((text) => text.toLowerCase());
  for (const key of citationEntriesByKey.keys()) {
    const loweredKey = key.toLowerCase();
    if (
      loweredTexts.some(
        (text) =>
          text.includes(`cite.${loweredKey}`) ||
          text.includes(`cite:${loweredKey}`) ||
          text.includes(`cite_${loweredKey}`) ||
          text.includes(`bib.${loweredKey}`),
      )
    ) {
      return key;
    }
  }

  return null;
}

function citationAnchorFromAnnotation(
  annotation: PdfAnnotation,
  viewport: { convertToViewportRectangle: (rect: number[]) => number[] },
  citationEntriesByKey: Map<string, CitationEntry>,
): CitationAnchor | null {
  const rect = Array.isArray(annotation.rect) ? annotation.rect : null;
  if (
    !rect ||
    rect.length !== 4 ||
    !rect.every((value): value is number => typeof value === "number")
  ) {
    return null;
  }

  const key = citationKeyFromAnnotation(annotation, citationEntriesByKey);
  if (!key) {
    return null;
  }

  const converted = viewport.convertToViewportRectangle(rect);
  const left = Math.min(converted[0], converted[2]);
  const top = Math.min(converted[1], converted[3]);
  const width = Math.abs(converted[0] - converted[2]);
  const height = Math.abs(converted[1] - converted[3]);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { key, left, top, width, height };
}

function PdfPage({
  document: pdfDocument,
  pageNumber,
  scale,
  rotation,
  target,
  onNavigate,
  citationEntriesByKey,
  onShowCitation,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const [citationAnchors, setCitationAnchors] = useState<CitationAnchor[]>([]);
  const cssScale = scale / 100;

  useEffect(() => {
    const pageElement = pageRef.current;
    const canvas = canvasRef.current;
    const textLayerElement = textLayerRef.current;
    if (!pageElement || !canvas || !textLayerElement) {
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setRendered(false);
    setHighlight(null);
    setCitationAnchors([]);
    textLayerElement.replaceChildren();

    void pdfDocument
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: cssScale, rotation });
        const outputScale = window.devicePixelRatio || 1;
        pageElement.style.width = `${viewport.width}px`;
        pageElement.style.height = `${viewport.height}px`;
        pageElement.style.setProperty("--scale-factor", String(cssScale));
        pageElement.style.setProperty("--total-scale-factor", String(cssScale));
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) {
          throw new Error("Could not create the PDF canvas context.");
        }

        const annotationsPromise = citationEntriesByKey.size
          ? page
              .getAnnotations({ intent: "display" })
              .then((annotations) => annotations as PdfAnnotation[])
              .catch(() => [])
          : Promise.resolve([]);

        renderTask = page.render({
          canvasContext,
          viewport,
          transform:
            outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        textLayer = new TextLayer({
          textContentSource: await page.getTextContent(),
          container: textLayerElement,
          viewport,
        });

        const [, , annotations] = await Promise.all([
          renderTask.promise,
          textLayer.render(),
          annotationsPromise,
        ]);
        if (!cancelled) {
          setCitationAnchors(
            annotations
              .map((annotation) =>
                citationAnchorFromAnnotation(
                  annotation,
                  viewport,
                  citationEntriesByKey,
                ),
              )
              .filter((anchor): anchor is CitationAnchor => anchor !== null),
          );
          setRendered(true);
        }
      })
      .catch((error: unknown) => {
        if (
          !cancelled &&
          (error as { name?: string }).name !== "RenderingCancelledException"
        ) {
          console.error(`Could not render PDF page ${pageNumber}`, error);
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [citationEntriesByKey, cssScale, pageNumber, pdfDocument, rotation]);

  useEffect(() => {
    if (!rendered || target?.page !== pageNumber || !pageRef.current) {
      if (target?.page !== pageNumber) {
        setHighlight(null);
      }
      return;
    }

    const targetX = target.x * cssScale;
    const targetY = target.y * cssScale;
    const exactHighlight =
      target.word && textLayerRef.current
        ? findWordHighlight(
            textLayerRef.current,
            pageRef.current,
            target.word,
            targetX,
            targetY,
          )
        : null;
    setHighlight(
      exactHighlight ?? {
        left: Math.max(0, targetX - 4),
        top: Math.max(0, targetY - Math.max(10, target.height * cssScale)),
        width: Math.max(8, Math.min(120, target.width * cssScale)),
        height: Math.max(12, target.height * cssScale),
      },
    );
    pageRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [cssScale, pageNumber, rendered, target]);

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onNavigate) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onNavigate({
      page: pageNumber,
      x: (event.clientX - bounds.left) / cssScale,
      y: (event.clientY - bounds.top) / cssScale,
      word: wordAtPoint(event),
    });
  };

  return (
    <div
      ref={pageRef}
      className={`pdf-page ${onNavigate ? "pdf-page-interactive" : ""}`}
      data-page-number={pageNumber}
      title={onNavigate ? "Double-click to jump to source" : undefined}
      onDoubleClick={onNavigate ? handleDoubleClick : undefined}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer" />
      {citationAnchors.map((anchor, index) => (
        <button
          key={`${anchor.key}:${index}`}
          type="button"
          className="pdf-citation-anchor"
          style={{
            left: anchor.left,
            top: anchor.top,
            width: anchor.width,
            height: anchor.height,
          }}
          title={`Show bibliography for ${anchor.key}`}
          aria-label={`Show bibliography for ${anchor.key}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onShowCitation?.(anchor.key);
          }}
          onFocus={() => onShowCitation?.(anchor.key)}
          onMouseEnter={() => onShowCitation?.(anchor.key)}
        />
      ))}
      {highlight ? (
        <div
          className="pdf-sync-highlight"
          style={{
            left: highlight.left,
            top: highlight.top,
            width: highlight.width,
            height: highlight.height,
          }}
        />
      ) : null}
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  );
}

export default function PdfPreview({
  data,
  scale,
  rotation = 0,
  target,
  onNavigate,
  citationEntries = [],
  onShowCitation,
  onOpenExternal,
}: PdfPreviewProps) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [bibliographyOpen, setBibliographyOpen] = useState(false);
  const [bibliographyQuery, setBibliographyQuery] = useState("");
  const [selectedCitationKey, setSelectedCitationKey] = useState<string | null>(null);
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const citationEntriesByKey = useMemo(
    () => new Map(citationEntries.map((entry) => [entry.key, entry])),
    [citationEntries],
  );
  const openCitation = (key: string) => {
    if (onShowCitation) {
      onShowCitation(key);
      return;
    }

    setSelectedCitationKey(key);
    setBibliographyOpen(true);
  };

  useEffect(() => {
    if (!citationEntries.length) {
      setBibliographyOpen(false);
      setSelectedCitationKey(null);
      setBibliographyQuery("");
      return;
    }

    if (selectedCitationKey && !citationEntriesByKey.has(selectedCitationKey)) {
      setSelectedCitationKey(null);
    }
  }, [citationEntries.length, citationEntriesByKey, selectedCitationKey]);

  useEffect(() => {
    const loadingTask = getDocument({ data: data.slice() });
    let active = true;
    let loadedDocument: PDFDocumentProxy | null = null;
    setError("");

    void loadingTask.promise
      .then((document) => {
        loadedDocument = document;
        if (active) {
          const previousDocument = pdfDocumentRef.current;
          if (previousDocument && previousDocument !== document) {
            void previousDocument.destroy();
          }
          pdfDocumentRef.current = document;
          setPdfDocument(document);
        } else {
          void document.destroy();
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load PDF",
          );
        }
      });

    return () => {
      active = false;
      if (!loadedDocument) {
        void loadingTask.destroy();
      }
    };
  }, [data]);

  useEffect(
    () => () => {
      const currentDocument = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      if (currentDocument) {
        void currentDocument.destroy();
      }
    },
    [],
  );

  if (error) {
    return <div className="pdf-error">{error}</div>;
  }
  if (!pdfDocument) {
    return <div className="pdf-loading">Loading PDF…</div>;
  }

  return (
    <div className="pdf-document">
      {citationEntries.length && !onShowCitation ? (
        <div className="pdf-bibliography-ui">
          <button
            type="button"
            className={`pdf-bibliography-toggle ${bibliographyOpen ? "active" : ""}`}
            onClick={() => {
              setSelectedCitationKey(null);
              setBibliographyOpen((open) => !open);
            }}
            title="Show bibliography preview"
            aria-label="Show bibliography preview"
            aria-expanded={bibliographyOpen}
          >
            <BookOpenText size={14} />
          </button>

          {bibliographyOpen ? (
            <BibliographyPreviewPopover
              entries={citationEntries}
              query={bibliographyQuery}
              selectedKey={selectedCitationKey}
              onQueryChange={setBibliographyQuery}
              onSelectKey={setSelectedCitationKey}
              onClose={() => {
                setBibliographyOpen(false);
                setSelectedCitationKey(null);
              }}
              onOpenExternal={onOpenExternal}
              ariaLabel="PDF bibliography preview"
            />
          ) : null}
        </div>
      ) : null}
      {Array.from({ length: pdfDocument.numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          document={pdfDocument}
          pageNumber={index + 1}
          scale={scale}
          rotation={rotation}
          target={target}
          onNavigate={onNavigate}
          citationEntriesByKey={citationEntriesByKey}
          onShowCitation={openCitation}
        />
      ))}
    </div>
  );
}
