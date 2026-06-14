import {
  ArrowRight,
  Circle,
  Copy,
  CornerUpRight,
  Database,
  Diamond,
  Download,
  Eraser,
  Grid,
  Hand,
  Hexagon,
  Minus,
  MousePointer2,
  MoveHorizontal,
  Pen,
  Plus,
  Redo2,
  Square,
  Trash2,
  Triangle,
  Type,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DrawShape, ShapeKind } from "./tikzGenerator";
import { generateFullDocument, generateTikzCode } from "./tikzGenerator";

// ---------- constants ----------

const GRID_SIZE = 25;
const DEFAULT_STROKE = "#d6dae2";
const DEFAULT_FILL = "none";
const DEFAULT_STROKE_WIDTH = 1.5;
const DEFAULT_FONT_SIZE = 14;

const COLORS = [
  "#d6dae2",
  "#000000",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#ffffff",
  "#a0522d",
];

// ---------- helpers ----------

let _idCounter = 0;
function uid(): string {
  return `s${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

function snapGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function defaultShape(kind: ShapeKind): DrawShape {
  return {
    id: uid(),
    kind,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    label: "",
    points: [],
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    dashed: false,
    fontSize: DEFAULT_FONT_SIZE,
    rotation: 0,
  };
}

function shapeContains(s: DrawShape, px: number, py: number): boolean {
  const margin = 6;
  if (
    s.kind === "line" ||
    s.kind === "arrow" ||
    s.kind === "freehand"
  ) {
    for (let i = 0; i < s.points.length - 1; i++) {
      const [ax, ay] = s.points[i];
      const [bx, by] = s.points[i + 1];
      const dist = pointToSegmentDist(px, py, ax, ay, bx, by);
      if (dist < 8) return true;
    }
    return false;
  }

  if (s.kind === "text") {
    return (
      px >= s.x - 40 &&
      px <= s.x + 80 &&
      py >= s.y - 16 &&
      py <= s.y + 16
    );
  }

  return (
    px >= s.x - margin &&
    px <= s.x + s.w + margin &&
    py >= s.y - margin &&
    py <= s.y + s.h + margin
  );
}

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------- Component ----------

type ToolType =
  | "select"
  | "pan"
  | ShapeKind;

interface HistoryEntry {
  shapes: DrawShape[];
}

export interface TikzCanvasProps {
  onInsertCode?: (code: string) => void;
}

export default function TikzCanvas({ onInsertCode }: TikzCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const codeRef = useRef<HTMLPreElement>(null);

  // -- state --
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [tool, setTool] = useState<ToolType>("select");
  const [stroke, setStroke] = useState(DEFAULT_STROKE);
  const [fill, setFill] = useState(DEFAULT_FILL);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_WIDTH);
  const [dashed, setDashed] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [codeMode, setCodeMode] = useState<"tikz" | "full">("tikz");
  const [copied, setCopied] = useState(false);

  // -- undo / redo --
  const [history, setHistory] = useState<HistoryEntry[]>([{ shapes: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const pushHistory = useCallback(
    (next: DrawShape[]) => {
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        return [...trimmed, { shapes: next }];
      });
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex],
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setShapes(history[newIndex].shapes);
    setSelected(null);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setShapes(history[newIndex].shapes);
    setSelected(null);
  }, [history, historyIndex]);

  // -- canvas dimensions --
  const canvasWidth = 1200;
  const canvasHeight = 800;

  // -- generated code --
  const tikzCode = useMemo(() => {
    if (codeMode === "full") {
      return generateFullDocument(shapes, canvasWidth, canvasHeight);
    }
    return generateTikzCode(shapes, canvasWidth, canvasHeight);
  }, [shapes, codeMode]);

  // -- snap helper --
  const snap = useCallback(
    (v: number) => (snapEnabled ? snapGrid(v) : v),
    [snapEnabled],
  );

  // -- keyboard shortcuts --
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected) {
          const next = shapes.filter((s) => s.id !== selected);
          setShapes(next);
          pushHistory(next);
          setSelected(null);
        }
      }
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
      }
      // tool shortcuts
      if (!mod && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "v": setTool("select"); break;
          case "h": setTool("pan"); break;
          case "r": setTool("rect"); break;
          case "c": setTool("circle"); break;
          case "e": setTool("ellipse"); break;
          case "l": setTool("line"); break;
          case "a": setTool("arrow"); break;
          case "t": setTool("text"); break;
          case "d": setTool("diamond"); break;
          case "p": setTool("freehand"); break;
          // added tools
          case "g": setTool("grid"); break;
          case "x": setTool("axes"); break;
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [selected, shapes, pushHistory, undo, redo]);

  // -- helper: commit shape with history --
  const commitShape = useCallback(
    (next: DrawShape[]) => {
      setShapes(next);
      pushHistory(next);
    },
    [pushHistory],
  );

  // -- event handlers --
  const getSvgPoint = (e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pt = getSvgPoint(e);
    const x = snap(pt.x);
    const y = snap(pt.y);

    if (tool === "select") {
      // check if clicking a shape
      const hit = [...shapes].reverse().find((s) => shapeContains(s, pt.x, pt.y));
      if (hit) {
        setSelected(hit.id);
        setDragStart(pt);
        setDragOffset({ x: pt.x - hit.x, y: pt.y - hit.y });
      } else {
        setSelected(null);
      }
      return;
    }

    if (tool === "pan") return;

    if (tool === "text") {
      const label = prompt("Enter text:") || "";
      if (!label) return;
      const shape: DrawShape = {
        ...defaultShape("text"),
        x,
        y,
        label,
        stroke,
        fontSize: DEFAULT_FONT_SIZE,
      };
      commitShape([...shapes, shape]);
      return;
    }

    setDrawing(true);
    setDragStart({ x, y });

    if (tool === "line" || tool === "arrow") {
      const shape: DrawShape = {
        ...defaultShape(tool),
        stroke,
        fill,
        strokeWidth,
        dashed,
        points: [[x, y], [x, y]],
      };
      setShapes([...shapes, shape]);
      return;
    }

    if (tool === "freehand") {
      const shape: DrawShape = {
        ...defaultShape("freehand"),
        stroke,
        fill,
        strokeWidth,
        dashed,
        points: [[pt.x, pt.y]],
      };
      setShapes([...shapes, shape]);
      return;
    }

    // shape-based tools
    const shape: DrawShape = {
      ...defaultShape(tool as ShapeKind),
      x,
      y,
      w: 0,
      h: 0,
      stroke,
      fill,
      strokeWidth,
      dashed,
    };
    setShapes([...shapes, shape]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pt = getSvgPoint(e);

    // dragging in select mode
    if (tool === "select" && dragStart && selected) {
      const dx = pt.x - dragStart.x;
      const dy = pt.y - dragStart.y;
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== selected) return s;
          if (s.kind === "line" || s.kind === "arrow" || s.kind === "freehand") {
            const origPoints = history[historyIndex].shapes.find(
              (h) => h.id === s.id,
            )?.points;
            if (!origPoints) return s;
            return {
              ...s,
              points: origPoints.map(([ox, oy]) => [ox + dx, oy + dy] as [number, number]),
            };
          }
          const orig = history[historyIndex].shapes.find((h) => h.id === s.id);
          if (!orig) return s;
          return { ...s, x: orig.x + dx, y: orig.y + dy };
        }),
      );
      return;
    }

    if (!drawing || !dragStart) return;

    const x = snap(pt.x);
    const y = snap(pt.y);

    if (tool === "line" || tool === "arrow") {
      setShapes((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        const pts = [...last.points];
        pts[pts.length - 1] = [x, y];
        return [...prev.slice(0, -1), { ...last, points: pts }];
      });
      return;
    }

    if (tool === "freehand") {
      setShapes((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        return [
          ...prev.slice(0, -1),
          { ...last, points: [...last.points, [pt.x, pt.y]] },
        ];
      });
      return;
    }

    // rect, circle, ellipse, diamond, triangle, parallelogram, cylinder, grid, axes
    setShapes((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      const nx = Math.min(dragStart.x, x);
      const ny = Math.min(dragStart.y, y);
      const nw = Math.abs(x - dragStart.x);
      const nh = Math.abs(y - dragStart.y);
      return [
        ...prev.slice(0, -1),
        { ...last, x: nx, y: ny, w: nw, h: nh },
      ];
    });
  };

  const handleMouseUp = () => {
    if (tool === "select" && dragStart && selected) {
      // commit drag
      pushHistory([...shapes]);
      setDragStart(null);
      setDragOffset(null);
      return;
    }

    if (!drawing) return;
    setDrawing(false);
    setDragStart(null);

    // simplify freehand: reduce points
    if (tool === "freehand") {
      setShapes((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.points.length < 3) return prev;
        // Douglas-Peucker-like simplification: take every 3rd point
        const simplified = last.points.filter((_, i) =>
          i === 0 || i === last.points.length - 1 || i % 3 === 0,
        );
        return [...prev.slice(0, -1), { ...last, points: simplified }];
      });
    }

    // Remove shapes with zero size
    setShapes((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      if (
        (last.kind === "rect" ||
          last.kind === "circle" ||
          last.kind === "ellipse" ||
          last.kind === "diamond" ||
          last.kind === "triangle" ||
          last.kind === "parallelogram" ||
          last.kind === "cylinder" ||
          last.kind === "grid" ||
          last.kind === "axes") &&
        last.w < 4 &&
        last.h < 4
      ) {
        return prev.slice(0, -1);
      }
      if (
        (last.kind === "line" || last.kind === "arrow") &&
        last.points.length >= 2
      ) {
        const [x1, y1] = last.points[0];
        const [x2, y2] = last.points[last.points.length - 1];
        if (Math.abs(x2 - x1) < 4 && Math.abs(y2 - y1) < 4) {
          return prev.slice(0, -1);
        }
      }
      pushHistory(prev);
      return prev;
    });
  };

  // -- copy code --
  const handleCopy = async () => {
    await navigator.clipboard.writeText(tikzCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const fullDoc = generateFullDocument(shapes, canvasWidth, canvasHeight);
    const blob = new Blob([fullDoc], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tikz-drawing.tex";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (shapes.length && !confirm("Clear all shapes?")) return;
    commitShape([]);
    setSelected(null);
  };

  const handleDeleteSelected = () => {
    if (!selected) return;
    const next = shapes.filter((s) => s.id !== selected);
    commitShape(next);
    setSelected(null);
  };

  // -- render SVG shapes --
  function renderShape(s: DrawShape) {
    const isSelected = s.id === selected;
    const base = {
      stroke: s.stroke,
      strokeWidth: s.strokeWidth,
      fill: s.fill === "none" || s.fill === "transparent" ? "none" : s.fill,
      strokeDasharray: s.dashed ? "8 4" : undefined,
      filter: isSelected ? "drop-shadow(0 0 6px rgba(114,155,240,0.5))" : undefined,
      cursor: tool === "select" ? "move" : undefined,
    };

    switch (s.kind) {
      case "rect":
        return (
          <g key={s.id}>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={2} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                rx={3}
              />
            )}
            {s.label && (
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      case "circle": {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        const r = Math.min(s.w, s.h) / 2;
        return (
          <g key={s.id}>
            <circle cx={cx} cy={cy} r={r} {...base} />
            {isSelected && (
              <circle
                cx={cx}
                cy={cy}
                r={r + 3}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "ellipse": {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        return (
          <g key={s.id}>
            <ellipse cx={cx} cy={cy} rx={s.w / 2} ry={s.h / 2} {...base} />
            {isSelected && (
              <ellipse
                cx={cx}
                cy={cy}
                rx={s.w / 2 + 3}
                ry={s.h / 2 + 3}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "line":
      case "freehand": {
        if (s.points.length < 2) return null;
        const d = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
          .join(" ");
        return (
          <g key={s.id}>
            <path d={d} {...base} fill="none" />
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke="#729bf0"
                strokeWidth={s.strokeWidth + 4}
                opacity={0.3}
              />
            )}
          </g>
        );
      }
      case "arrow": {
        if (s.points.length < 2) return null;
        const d = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
          .join(" ");
        return (
          <g key={s.id}>
            <defs>
              <marker
                id={`arrow-${s.id}`}
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" fill={s.stroke} />
              </marker>
            </defs>
            <path
              d={d}
              {...base}
              fill="none"
              markerEnd={`url(#arrow-${s.id})`}
            />
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke="#729bf0"
                strokeWidth={s.strokeWidth + 4}
                opacity={0.3}
              />
            )}
          </g>
        );
      }
      case "text":
        return (
          <g key={s.id}>
            {isSelected && (
              <rect
                x={s.x - 4}
                y={s.y - s.fontSize}
                width={s.label.length * s.fontSize * 0.6 + 8}
                height={s.fontSize * 1.4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                rx={3}
              />
            )}
            <text
              x={s.x}
              y={s.y}
              fill={s.stroke}
              fontSize={s.fontSize}
              dominantBaseline="auto"
              style={{ cursor: tool === "select" ? "move" : "text" }}
            >
              {s.label || "text"}
            </text>
          </g>
        );
      case "diamond": {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        const points = [
          `${cx},${s.y}`,
          `${s.x + s.w},${cy}`,
          `${cx},${s.y + s.h}`,
          `${s.x},${cy}`,
        ].join(" ");
        return (
          <g key={s.id}>
            <polygon points={points} {...base} />
            {isSelected && (
              <rect
                x={s.x - 2}
                y={s.y - 2}
                width={s.w + 4}
                height={s.h + 4}
                fill="none"
                stroke="#729bf0"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {s.label && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill={s.stroke}
                fontSize={s.fontSize}
                style={{ pointerEvents: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      }
      case "triangle": {
        const points = [
          `${s.x + s.w / 2},${s.y}`,
          `${s.x},${s.y + s.h}`,
          `${s.x + s.w},${s.y + s.h}`,
        ].join(" ");
        return (
          <g key={s.id}>
            <polygon points={points} {...base} />
            {isSelected && (
              <rect x={s.x - 2} y={s.y - 2} width={s.w + 4} height={s.h + 4} fill="none" stroke="#729bf0" strokeWidth={1.5} strokeDasharray="4 3" />
            )}
            {s.label && (
              <text x={s.x + s.w / 2} y={s.y + s.h * 0.6} textAnchor="middle" dominantBaseline="central" fill={s.stroke} fontSize={s.fontSize} style={{ pointerEvents: "none" }}>{s.label}</text>
            )}
          </g>
        );
      }
      case "parallelogram": {
        const points = [
          `${s.x + s.w * 0.2},${s.y}`,
          `${s.x + s.w},${s.y}`,
          `${s.x + s.w * 0.8},${s.y + s.h}`,
          `${s.x},${s.y + s.h}`,
        ].join(" ");
        return (
          <g key={s.id}>
            <polygon points={points} {...base} />
            {isSelected && (
              <rect x={s.x - 2} y={s.y - 2} width={s.w + 4} height={s.h + 4} fill="none" stroke="#729bf0" strokeWidth={1.5} strokeDasharray="4 3" />
            )}
            {s.label && (
              <text x={s.x + s.w / 2} y={s.y + s.h / 2} textAnchor="middle" dominantBaseline="central" fill={s.stroke} fontSize={s.fontSize} style={{ pointerEvents: "none" }}>{s.label}</text>
            )}
          </g>
        );
      }
      case "cylinder": {
        const cx = s.x + s.w / 2;
        const topY = s.y + s.h * 0.15;
        const bottomY = s.y + s.h - s.h * 0.15;
        const rx = s.w / 2;
        const ry = Math.max(s.h * 0.15, 2);
        const d = `M ${s.x} ${topY} L ${s.x} ${bottomY} A ${rx} ${ry} 0 0 0 ${s.x + s.w} ${bottomY} L ${s.x + s.w} ${topY}`;
        return (
          <g key={s.id}>
            <ellipse cx={cx} cy={topY} rx={rx} ry={ry} {...base} />
            <path d={d} {...base} />
            {isSelected && (
              <rect x={s.x - 2} y={s.y - 2} width={s.w + 4} height={s.h + 4} fill="none" stroke="#729bf0" strokeWidth={1.5} strokeDasharray="4 3" />
            )}
            {s.label && (
              <text x={cx} y={s.y + s.h / 2} textAnchor="middle" dominantBaseline="central" fill={s.stroke} fontSize={s.fontSize} style={{ pointerEvents: "none" }}>{s.label}</text>
            )}
          </g>
        );
      }
      case "grid": {
        const lines = [];
        const step = Math.max(25, s.w / 5);
        for (let x = 0; x <= s.w; x += step) {
          lines.push(<line key={`gx${x}`} x1={s.x + x} y1={s.y} x2={s.x + x} y2={s.y + s.h} stroke={s.stroke} strokeWidth={0.5} />);
        }
        for (let y = 0; y <= s.h; y += step) {
          lines.push(<line key={`gy${y}`} x1={s.x} y1={s.y + y} x2={s.x + s.w} y2={s.y + y} stroke={s.stroke} strokeWidth={0.5} />);
        }
        return (
          <g key={s.id} {...base} fill="none">
            {lines}
            {isSelected && (
              <rect x={s.x - 2} y={s.y - 2} width={s.w + 4} height={s.h + 4} fill="none" stroke="#729bf0" strokeWidth={1.5} strokeDasharray="4 3" />
            )}
          </g>
        );
      }
      case "axes": {
        return (
          <g key={s.id} {...base} fill="none">
            <defs>
              <marker id={`axes-arrow-${s.id}`} markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill={s.stroke} />
              </marker>
            </defs>
            <path d={`M ${s.x} ${s.y + s.h} L ${s.x + s.w} ${s.y + s.h}`} markerEnd={`url(#axes-arrow-${s.id})`} stroke={s.stroke} strokeWidth={s.strokeWidth} />
            <path d={`M ${s.x} ${s.y + s.h} L ${s.x} ${s.y}`} markerEnd={`url(#axes-arrow-${s.id})`} stroke={s.stroke} strokeWidth={s.strokeWidth} />
            <text x={s.x + s.w + 8} y={s.y + s.h} fill={s.stroke} fontSize={12} dominantBaseline="central">x</text>
            <text x={s.x} y={s.y - 8} fill={s.stroke} fontSize={12} textAnchor="middle">y</text>
            {isSelected && (
              <rect x={s.x - 2} y={s.y - 2} width={s.w + 4} height={s.h + 4} fill="none" stroke="#729bf0" strokeWidth={1.5} strokeDasharray="4 3" />
            )}
          </g>
        );
      }
    }
  }

  // -- grid pattern --
  function renderGrid() {
    if (!showGrid) return null;
    const lines: JSX.Element[] = [];
    for (let x = 0; x <= canvasWidth; x += GRID_SIZE) {
      lines.push(
        <line
          key={`gv${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={canvasHeight}
          stroke="#252a34"
          strokeWidth={0.5}
        />,
      );
    }
    for (let y = 0; y <= canvasHeight; y += GRID_SIZE) {
      lines.push(
        <line
          key={`gh${y}`}
          x1={0}
          y1={y}
          x2={canvasWidth}
          y2={y}
          stroke="#252a34"
          strokeWidth={0.5}
        />,
      );
    }
    return <g className="tikz-grid">{lines}</g>;
  }

  // -- tool buttons --
  const tools: { id: ToolType; icon: JSX.Element; label: string; key: string }[] = [
    { id: "select", icon: <MousePointer2 size={16} />, label: "Select", key: "V" },
    { id: "pan", icon: <Hand size={16} />, label: "Pan", key: "H" },
    { id: "rect", icon: <Square size={16} />, label: "Rectangle", key: "R" },
    { id: "circle", icon: <Circle size={16} />, label: "Circle", key: "C" },
    { id: "ellipse", icon: <MoveHorizontal size={16} />, label: "Ellipse", key: "E" },
    { id: "parallelogram", icon: <Hexagon size={16} />, label: "Parallelogram", key: "" },
    { id: "cylinder", icon: <Database size={16} />, label: "Cylinder", key: "" },
    { id: "line", icon: <Minus size={16} />, label: "Line", key: "L" },
    { id: "arrow", icon: <ArrowRight size={16} />, label: "Arrow", key: "A" },
    { id: "text", icon: <Type size={16} />, label: "Text", key: "T" },
    { id: "diamond", icon: <Diamond size={16} />, label: "Diamond", key: "D" },
    { id: "triangle", icon: <Triangle size={16} />, label: "Triangle", key: "" },
    { id: "freehand", icon: <Pen size={16} />, label: "Freehand", key: "P" },
    { id: "grid", icon: <Grid size={16} />, label: "Grid", key: "G" },
    { id: "axes", icon: <CornerUpRight size={16} />, label: "Axes", key: "X" },
  ];

  // -- selected shape for property editing --
  const selectedShape = shapes.find((s) => s.id === selected);

  const updateSelected = (updates: Partial<DrawShape>) => {
    if (!selected) return;
    const next = shapes.map((s) =>
      s.id === selected ? { ...s, ...updates } : s,
    );
    setShapes(next);
    pushHistory(next);
  };

  return (
    <div className="tikz-canvas-root">
      {/* ===== LEFT: Drawing Area ===== */}
      <div className="tikz-draw-area">
        {/* Toolbar */}
        <div className="tikz-toolbar">
          <div className="tikz-toolbar-tools">
            {tools.map((t) => (
              <button
                key={t.id}
                className={`tikz-tool-btn ${tool === t.id ? "active" : ""}`}
                onClick={() => setTool(t.id)}
                title={`${t.label}${t.key ? ` (${t.key})` : ""}`}
              >
                {t.icon}
              </button>
            ))}
          </div>

          <div className="tikz-toolbar-divider" />

          {/* Colors */}
          <div className="tikz-toolbar-colors">
            <span className="tikz-prop-label">Stroke</span>
            <div className="tikz-color-row">
              {COLORS.map((c) => (
                <button
                  key={`s-${c}`}
                  className={`tikz-color-swatch ${stroke === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setStroke(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="tikz-toolbar-colors">
            <span className="tikz-prop-label">Fill</span>
            <div className="tikz-color-row">
              <button
                className={`tikz-color-swatch tikz-no-fill ${fill === "none" ? "active" : ""}`}
                onClick={() => setFill("none")}
                title="No fill"
              >
                <Eraser size={10} />
              </button>
              {COLORS.map((c) => (
                <button
                  key={`f-${c}`}
                  className={`tikz-color-swatch ${fill === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setFill(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="tikz-toolbar-divider" />

          <div className="tikz-toolbar-props">
            <label className="tikz-prop-group">
              <span className="tikz-prop-label">Width</span>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
              />
              <span className="tikz-prop-value">{strokeWidth}px</span>
            </label>
            <label className="tikz-prop-group tikz-checkbox-group">
              <input
                type="checkbox"
                checked={dashed}
                onChange={(e) => setDashed(e.target.checked)}
              />
              <span className="tikz-prop-label">Dashed</span>
            </label>
            <label className="tikz-prop-group tikz-checkbox-group">
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(e) => setSnapEnabled(e.target.checked)}
              />
              <span className="tikz-prop-label">Snap</span>
            </label>
            <label className="tikz-prop-group tikz-checkbox-group">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              <span className="tikz-prop-label">Grid</span>
            </label>
          </div>

          <div className="tikz-toolbar-divider" />

          <div className="tikz-toolbar-actions">
            <button
              className="tikz-action-btn"
              onClick={undo}
              disabled={historyIndex <= 0}
              title="Undo (Ctrl/⌘+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              className="tikz-action-btn"
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              title="Redo (Ctrl/⌘+Shift+Z)"
            >
              <Redo2 size={14} />
            </button>
            {selected && (
              <button
                className="tikz-action-btn tikz-delete-btn"
                onClick={handleDeleteSelected}
                title="Delete selected (Del)"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              className="tikz-action-btn tikz-clear-btn"
              onClick={handleClear}
              title="Clear canvas"
            >
              <Eraser size={14} />
            </button>
          </div>
        </div>

        {/* SVG Canvas */}
        <div className="tikz-svg-container">
          <svg
            ref={svgRef}
            className="tikz-svg"
            width={canvasWidth}
            height={canvasHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              cursor:
                tool === "select"
                  ? "default"
                  : tool === "pan"
                    ? "grab"
                    : tool === "text"
                      ? "text"
                      : "crosshair",
            }}
          >
            {/* Background */}
            <rect width={canvasWidth} height={canvasHeight} fill="#15181e" />
            {renderGrid()}
            {shapes.map(renderShape)}
          </svg>
        </div>

        {/* Selected shape properties */}
        {selectedShape && (
          <div className="tikz-selected-props">
            <span className="tikz-prop-label">Selected: {selectedShape.kind}</span>
            <div className="tikz-selected-props-row">
              {selectedShape.kind !== "line" &&
                selectedShape.kind !== "arrow" &&
                selectedShape.kind !== "freehand" && (
                  <>
                    <label className="tikz-mini-prop">
                      <span>X</span>
                      <input
                        type="number"
                        value={Math.round(selectedShape.x)}
                        onChange={(e) =>
                          updateSelected({ x: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="tikz-mini-prop">
                      <span>Y</span>
                      <input
                        type="number"
                        value={Math.round(selectedShape.y)}
                        onChange={(e) =>
                          updateSelected({ y: Number(e.target.value) })
                        }
                      />
                    </label>
                  </>
                )}
              {selectedShape.kind !== "text" &&
                selectedShape.kind !== "line" &&
                selectedShape.kind !== "arrow" &&
                selectedShape.kind !== "freehand" && (
                  <>
                    <label className="tikz-mini-prop">
                      <span>W</span>
                      <input
                        type="number"
                        value={Math.round(selectedShape.w)}
                        onChange={(e) =>
                          updateSelected({ w: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="tikz-mini-prop">
                      <span>H</span>
                      <input
                        type="number"
                        value={Math.round(selectedShape.h)}
                        onChange={(e) =>
                          updateSelected({ h: Number(e.target.value) })
                        }
                      />
                    </label>
                  </>
                )}
              {(selectedShape.kind === "rect" ||
                selectedShape.kind === "circle" ||
                selectedShape.kind === "ellipse" ||
                selectedShape.kind === "diamond" ||
                selectedShape.kind === "triangle" ||
                selectedShape.kind === "parallelogram" ||
                selectedShape.kind === "cylinder" ||
                selectedShape.kind === "text") && (
                <label className="tikz-mini-prop tikz-mini-prop-wide">
                  <span>Label</span>
                  <input
                    type="text"
                    value={selectedShape.label}
                    onChange={(e) =>
                      updateSelected({ label: e.target.value })
                    }
                    placeholder="Text…"
                  />
                </label>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== RIGHT: Code Panel ===== */}
      <div className="tikz-code-panel">
        <div className="tikz-code-header">
          <div className="tikz-code-title">
            <span className="tikz-code-icon">T<sub>i</sub><em>k</em>Z</span>
            <span>Generated Code</span>
          </div>
          <div className="tikz-code-tabs">
            <button
              className={`tikz-code-tab ${codeMode === "tikz" ? "active" : ""}`}
              onClick={() => setCodeMode("tikz")}
            >
              TikZ only
            </button>
            <button
              className={`tikz-code-tab ${codeMode === "full" ? "active" : ""}`}
              onClick={() => setCodeMode("full")}
            >
              Full document
            </button>
          </div>
          <div className="tikz-code-actions">
            <button
              className="tikz-code-action-btn"
              onClick={() => void handleCopy()}
              title="Copy to clipboard"
            >
              <Copy size={13} />
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              className="tikz-code-action-btn"
              onClick={handleDownload}
              title="Download .tex file"
            >
              <Download size={13} />
              Download
            </button>
            {onInsertCode && (
              <button
                className="tikz-code-action-btn tikz-insert-btn"
                onClick={() => onInsertCode(tikzCode)}
                title="Insert into editor"
              >
                <Plus size={13} />
                Insert
              </button>
            )}
          </div>
        </div>
        <div className="tikz-code-body">
          <pre ref={codeRef} className="tikz-code-pre">
            <code>{tikzCode}</code>
          </pre>
        </div>
        <div className="tikz-code-footer">
          <span>{shapes.length} shape{shapes.length !== 1 ? "s" : ""}</span>
          <span>Canvas: {canvasWidth}×{canvasHeight}px</span>
          <span>Scale: 1px = 0.02cm</span>
        </div>
      </div>
    </div>
  );
}
