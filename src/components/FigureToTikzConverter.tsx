import React, { useCallback, useRef, useState } from "react";
import { Copy, Download, ImageUp, Plus, RefreshCw, Upload } from "lucide-react";

interface DetectedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label: string;
}

interface DetectedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface DetectedArrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface DetectedText {
  x: number;
  y: number;
  text: string;
  color: string;
}

interface DetectionResult {
  boxes: DetectedBox[];
  lines: DetectedLine[];
  arrows: DetectedArrow[];
  texts: DetectedText[];
}

function hexColor(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

function rgbDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  return Math.sqrt(
    (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2,
  );
}

function isGrayish(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 30;
}

function analyzeImage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): DetectionResult {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const boxes: DetectedBox[] = [];
  const lines: DetectedLine[] = [];
  const arrows: DetectedArrow[] = [];
  const texts: DetectedText[] = [];

  const visited = new Uint8Array(width * height);

  const scale = Math.max(1, Math.min(width, height) / 400);
  const minBoxSize = 8 * scale;
  const maxBoxSize = width * 0.9;

  function getPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    const idx = (y * width + x) * 4;
    return {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
      a: data[idx + 3],
    };
  }

  function floodFill(
    startX: number,
    startY: number,
    tolerance: number,
  ): { pixels: [number, number][]; minX: number; minY: number; maxX: number; maxY: number } | null {
    const start = getPixel(startX, startY);
    if (!start || start.a < 20) return null;

    const queue: [number, number][] = [[startX, startY]];
    const pixels: [number, number][] = [];
    let minX = startX, minY = startY, maxX = startX, maxY = startY;

    while (queue.length > 0 && pixels.length < 50000) {
      const [x, y] = queue.pop()!;
      const idx = y * width + x;
      if (visited[idx]) continue;
      visited[idx] = 1;

      const p = getPixel(x, y);
      if (!p || p.a < 20) continue;

      const dist = rgbDistance(p.r, p.g, p.b, start.r, start.g, start.b);
      if (dist > tolerance) continue;

      pixels.push([x, y]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0) queue.push([x - 1, y]);
      if (x < width - 1) queue.push([x + 1, y]);
      if (y > 0) queue.push([x, y - 1]);
      if (y < height - 1) queue.push([x, y + 1]);
    }

    return pixels.length > 50 ? { pixels, minX, minY, maxX, maxY } : null;
  }

  function isLineRegion(pixels: [number, number][], minX: number, minY: number, maxX: number, maxY: number): boolean {
    const w = maxX - minX;
    const h = maxY - minY;
    const area = w * h;
    const pixelCount = pixels.length;
    if (area === 0) return false;
    const density = pixelCount / area;
    const aspectRatio = w / Math.max(h, 1);
    return (
      pixelCount < 2000 &&
      density < 0.4 &&
      (aspectRatio > 5 || aspectRatio < 0.2)
    );
  }

  for (let y = 0; y < height; y += Math.max(2, Math.floor(scale))) {
    for (let x = 0; x < width; x += Math.max(2, Math.floor(scale))) {
      const idx = y * width + x;
      if (visited[idx]) continue;

      const p = getPixel(x, y);
      if (!p || p.a < 20) continue;

      const isEdge =
        isGrayish(p.r, p.g, p.b) &&
        (p.r < 100 || p.g < 100 || p.b < 100);

      if (!isEdge && !(p.r < 100 && p.g < 100 && p.b < 100)) continue;

      const region = floodFill(x, y, 40);
      if (!region) continue;

      const { pixels, minX, minY, maxX, maxY } = region;
      const boxWidth = maxX - minX;
      const boxHeight = maxY - minY;

      if (boxWidth < minBoxSize || boxHeight < minBoxSize) continue;
      if (boxWidth > maxBoxSize || boxHeight > maxBoxSize) continue;

      const pixelCount = pixels.length;
      const bboxArea = boxWidth * boxHeight;
      const density = bboxArea > 0 ? pixelCount / bboxArea : 0;

      if (density > 0.15 && density < 0.85 && boxWidth < width * 0.5 && boxHeight < height * 0.5) {
        const avgR: number[] = [], avgG: number[] = [], avgB: number[] = [];
        for (const [px, py] of pixels) {
          const pp = getPixel(px, py);
          if (pp) {
            avgR.push(pp.r);
            avgG.push(pp.g);
            avgB.push(pp.b);
          }
        }
        const color = hexColor(
          Math.round(avgR.reduce((a, b) => a + b, 0) / avgR.length),
          Math.round(avgG.reduce((a, b) => a + b, 0) / avgG.length),
          Math.round(avgB.reduce((a, b) => a + b, 0) / avgB.length),
        );
        if (isLineRegion(pixels, minX, minY, maxX, maxY)) {
          const aspect = boxWidth / Math.max(boxHeight, 1);
          if (aspect > 2) {
            lines.push({
              x1: minX,
              y1: (minY + maxY) / 2,
              x2: maxX,
              y2: (minY + maxY) / 2,
              color,
            });
          } else if (aspect < 0.5) {
            lines.push({
              x1: (minX + maxX) / 2,
              y1: minY,
              x2: (minX + maxX) / 2,
              y2: maxY,
              color,
            });
          }
        } else {
          boxes.push({
            x: minX,
            y: minY,
            w: boxWidth,
            h: boxHeight,
            color,
            label: "",
          });
        }
      }
    }
  }

  return { boxes, lines, arrows, texts };
}

function generateTikzFromDetection(
  result: DetectionResult,
  imgWidth: number,
  imgHeight: number,
): string {
  const scale = 1 / 50;
  const lines: string[] = [];

  function pt(x: number, y: number): string {
    return `(${(x * scale).toFixed(2)},${((imgHeight - y) * scale).toFixed(2)})`;
  }

  function tikzColor(hex: string): string {
    const map: Record<string, string> = {
      "#000000": "black", "#ffffff": "white",
      "#ff0000": "red", "#00ff00": "green", "#0000ff": "blue",
    };
    const lower = hex.toLowerCase();
    if (map[lower]) return map[lower];
    const r = parseInt(lower.slice(1, 3), 16);
    const g = parseInt(lower.slice(3, 5), 16);
    const b = parseInt(lower.slice(5, 7), 16);
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  }

  lines.push("\\begin{tikzpicture}");
  lines.push(`  % Auto-generated from image (${imgWidth}x${imgHeight}px)`);

  for (const box of result.boxes) {
    const p1 = pt(box.x, box.y);
    const p2 = pt(box.x + box.w, box.y + box.h);
    const color = tikzColor(box.color);
    const opts = color !== "black" ? `[draw=${color}]` : "";
    lines.push(`  \\draw${opts} ${p1} rectangle ${p2};`);
    if (box.label) {
      const cx = pt(box.x + box.w / 2, box.y + box.h / 2);
      lines.push(`  \\node at ${cx} {${box.label}};`);
    }
  }

  for (const line of result.lines) {
    const p1 = pt(line.x1, line.y1);
    const p2 = pt(line.x2, line.y2);
    const color = tikzColor(line.color);
    const opts = color !== "black" ? `[draw=${color}]` : "";
    lines.push(`  \\draw${opts} ${p1} -- ${p2};`);
  }

  for (const arrow of result.arrows) {
    const p1 = pt(arrow.x1, arrow.y1);
    const p2 = pt(arrow.x2, arrow.y2);
    const color = tikzColor(arrow.color);
    const opts = color !== "black"
      ? `[->,>=stealth,draw=${color}]`
      : "[->,>=stealth]";
    lines.push(`  \\draw${opts} ${p1} -- ${p2};`);
  }

  for (const text of result.texts) {
    const p = pt(text.x, text.y);
    const color = tikzColor(text.color);
    const opts = color !== "black" ? `[text=${color}]` : "";
    lines.push(`  \\node${opts} at ${p} {${text.text}};`);
  }

  lines.push("\\end{tikzpicture}");

  return lines.join("\n");
}

interface FigureToTikzConverterProps {
  onInsertCode?: (code: string) => void;
}

export function FigureToTikzConverter({ onInsertCode }: FigureToTikzConverterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tikzCode, setTikzCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);

  const detectShapes = useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const maxW = 800;
    const maxH = 600;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, w, h);

    setAnalyzing(true);

    setTimeout(() => {
      const result = analyzeImage(ctx, w, h);
      const code = generateTikzFromDetection(result, w, h);
      setTikzCode(code);
      setAnalyzing(false);
    }, 100);
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        detectShapes(img);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [detectShapes]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) handleFile(file);
      }
    }
  }, [handleFile]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tikzCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([tikzCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tikz-figure.tex";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReanalyze = () => {
    if (image) detectShapes(image);
  };

  return (
    <div className="tikz-converter-root">
      <div className="tikz-converter-header">
        <span className="tikz-converter-title">
          <ImageUp size={16} />
          <span>Figure → TikZ Converter</span>
        </span>
        <div className="tikz-converter-hints">
          <span>Drop an image, click to upload, or paste (Ctrl+V)</span>
        </div>
      </div>

      {!image ? (
        <div
          className="tikz-converter-upload"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onPaste={handlePaste}
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={40} />
          <span className="tikz-converter-upload-text">
            Drop an image here, click to upload, or paste from clipboard
          </span>
          <span className="tikz-converter-upload-hint">
            Supports PNG, JPG, SVG, screenshots, hand-drawn sketches
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      ) : (
        <div className="tikz-converter-body">
          <div className="tikz-converter-preview">
            <div className="tikz-converter-preview-header">
              <span>Original Image</span>
              <div className="tikz-converter-preview-actions">
                <button
                  className="tikz-converter-btn"
                  onClick={() => {
                    setImage(null);
                    setTikzCode("");
                  }}
                >
                  <Upload size={13} /> Upload New
                </button>
                <button
                  className="tikz-converter-btn"
                  onClick={handleReanalyze}
                  disabled={analyzing}
                >
                  <RefreshCw size={13} /> {analyzing ? "Analyzing..." : "Re-analyze"}
                </button>
              </div>
            </div>
            <div className="tikz-converter-canvas-wrap">
              <canvas
                ref={canvasRef}
                className="tikz-converter-canvas"
                style={{ maxWidth: "100%", maxHeight: "400px" }}
              />
            </div>
          </div>

          <div className="tikz-converter-code">
            <div className="tikz-converter-code-header">
              <span>TikZ Code</span>
              <div className="tikz-converter-code-actions">
                <button className="tikz-converter-btn" onClick={handleCopy} disabled={!tikzCode}>
                  <Copy size={13} /> {copied ? "Copied!" : "Copy"}
                </button>
                <button className="tikz-converter-btn" onClick={handleDownload} disabled={!tikzCode}>
                  <Download size={13} /> Download
                </button>
                {onInsertCode && tikzCode && (
                  <button
                    className="tikz-converter-btn tikz-insert-btn"
                    onClick={() => onInsertCode(tikzCode)}
                  >
                    <Plus size={13} /> Insert
                  </button>
                )}
              </div>
            </div>
            <pre className="tikz-converter-code-pre">
              <code>{tikzCode || (analyzing ? "// Analyzing image... please wait" : "// Upload an image to generate TikZ code")}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
