// ---------- shared types ----------

export type ShapeKind =
  | "rect"
  | "circle"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | "diamond"
  | "triangle"
  | "freehand"
  | "parallelogram"
  | "cylinder"
  | "grid"
  | "axes";

export interface DrawShape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** For text shapes */
  label: string;
  /** For line/arrow/freehand: list of [x, y] points */
  points: [number, number][];
  stroke: string;
  fill: string;
  strokeWidth: number;
  dashed: boolean;
  fontSize: number;
  rotation: number;
}

// ---------- helpers ----------

/** Coordinate scale: 1 canvas-px → tikz cm */
const SCALE = 1 / 50;

function round(value: number, precision = 2): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}

function tikzPt(px: number, py: number, canvasHeight: number): string {
  // TikZ y-axis goes up while canvas y goes down
  const x = round(px * SCALE);
  const y = round((canvasHeight - py) * SCALE);
  return `(${x},${y})`;
}

function tikzColor(hex: string): string {
  const map: Record<string, string> = {
    "#000000": "black",
    "#ffffff": "white",
    "#ff0000": "red",
    "#00ff00": "green",
    "#0000ff": "blue",
    "#ffff00": "yellow",
    "#ff00ff": "magenta",
    "#00ffff": "cyan",
    "#808080": "gray",
    "#ffa500": "orange",
    "#800080": "purple",
    "#a0522d": "brown",
    "#ffc0cb": "pink",
    "#90ee90": "lime",
    "#008080": "teal",
    "#000080": "violet",
  };
  const lower = hex.toLowerCase();
  if (map[lower]) return map[lower];
  // Return a custom rgb color
  const r = parseInt(lower.slice(1, 3), 16);
  const g = parseInt(lower.slice(3, 5), 16);
  const b = parseInt(lower.slice(5, 7), 16);
  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
}

function drawOptions(shape: DrawShape, includeStroke = true): string {
  const opts: string[] = [];

  if (includeStroke && shape.stroke && shape.stroke !== "#000000") {
    opts.push(`draw=${tikzColor(shape.stroke)}`);
  } else if (includeStroke) {
    opts.push("draw");
  }

  if (shape.fill && shape.fill !== "none" && shape.fill !== "transparent") {
    opts.push(`fill=${tikzColor(shape.fill)}`);
  }

  if (shape.strokeWidth !== 1) {
    if (shape.strokeWidth <= 0.4) opts.push("ultra thin");
    else if (shape.strokeWidth <= 0.6) opts.push("very thin");
    else if (shape.strokeWidth <= 0.8) opts.push("thin");
    else if (shape.strokeWidth >= 3.2) opts.push("ultra thick");
    else if (shape.strokeWidth >= 2.4) opts.push("very thick");
    else if (shape.strokeWidth >= 1.6) opts.push("thick");
    else if (shape.strokeWidth >= 1.2) opts.push("semithick");
  }

  if (shape.dashed) {
    opts.push("dashed");
  }

  if (shape.rotation !== 0) {
    opts.push(`rotate=${round(shape.rotation)}`);
  }

  return opts.length ? `[${opts.join(", ")}]` : "";
}

// ---------- per-shape generators ----------

function genRect(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const p1 = tikzPt(s.x, s.y, ch);
  const p2 = tikzPt(s.x + s.w, s.y + s.h, ch);
  let code = `  \\draw${opts} ${p1} rectangle ${p2};`;
  if (s.label) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genCircle(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const r = round((Math.min(s.w, s.h) / 2) * SCALE);
  let code = `  \\draw${opts} ${tikzPt(cx, cy, ch)} circle (${r});`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genEllipse(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const rx = round((s.w / 2) * SCALE);
  const ry = round((s.h / 2) * SCALE);
  let code = `  \\draw${opts} ${tikzPt(cx, cy, ch)} ellipse (${rx} and ${ry});`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genLine(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  if (s.points.length < 2) return "";
  const parts = s.points.map(([px, py]) => tikzPt(px, py, ch));
  return `  \\draw${opts} ${parts.join(" -- ")};`;
}

function genArrow(s: DrawShape, ch: number): string {
  const baseOpts = drawOptions(s);
  // Inject arrow tip before first option or after opening bracket
  let opts: string;
  if (baseOpts.startsWith("[")) {
    opts = `[->,>=stealth, ${baseOpts.slice(1)}`;
  } else {
    opts = "[->,>=stealth]";
  }
  if (s.points.length < 2) return "";
  const parts = s.points.map(([px, py]) => tikzPt(px, py, ch));
  return `  \\draw${opts} ${parts.join(" -- ")};`;
}

function genText(s: DrawShape, ch: number): string {
  const opts: string[] = [];
  if (s.stroke && s.stroke !== "#000000") {
    opts.push(`text=${tikzColor(s.stroke)}`);
  }
  if (s.fontSize && s.fontSize !== 14) {
    opts.push(
      `font=\\fontsize{${round(s.fontSize * 0.75)}}{${round(s.fontSize * 0.9)}}\\selectfont`,
    );
  }
  if (s.rotation !== 0) {
    opts.push(`rotate=${round(s.rotation)}`);
  }
  const optStr = opts.length ? `[${opts.join(", ")}]` : "";
  return `  \\node${optStr} at ${tikzPt(s.x, s.y, ch)} {${s.label || "text"}};`;
}

function genDiamond(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const top = tikzPt(cx, s.y, ch);
  const right = tikzPt(s.x + s.w, cy, ch);
  const bottom = tikzPt(cx, s.y + s.h, ch);
  const left = tikzPt(s.x, cy, ch);
  let code = `  \\draw${opts} ${top} -- ${right} -- ${bottom} -- ${left} -- cycle;`;
  if (s.label) {
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genTriangle(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const top = tikzPt(s.x + s.w / 2, s.y, ch);
  const bl = tikzPt(s.x, s.y + s.h, ch);
  const br = tikzPt(s.x + s.w, s.y + s.h, ch);
  let code = `  \\draw${opts} ${top} -- ${bl} -- ${br} -- cycle;`;
  if (s.label) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h * 0.6;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genFreehand(s: DrawShape, ch: number): string {
  if (s.points.length < 2) return "";
  const opts = drawOptions(s);
  const parts = s.points.map(([px, py]) => tikzPt(px, py, ch));
  return `  \\draw${opts} ${parts.join(" -- ")};`;
}

function genParallelogram(s: DrawShape, ch: number): string {
  const opts = drawOptions(s);
  const tl = tikzPt(s.x + s.w * 0.2, s.y, ch);
  const tr = tikzPt(s.x + s.w, s.y, ch);
  const br = tikzPt(s.x + s.w * 0.8, s.y + s.h, ch);
  const bl = tikzPt(s.x, s.y + s.h, ch);
  let code = `  \\draw${opts} ${tl} -- ${tr} -- ${br} -- ${bl} -- cycle;`;
  if (s.label) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genCylinder(s: DrawShape, ch: number): string {
  const rx = round((s.w / 2) * SCALE);
  const ry = round(Math.max(s.h * 0.15, 2) * SCALE);

  const cx = s.x + s.w / 2;
  const topY = s.y + s.h * 0.15;
  const bottomY = s.y + s.h - s.h * 0.15;

  const topCenter = tikzPt(cx, topY, ch);
  const bottomLeft = tikzPt(s.x, bottomY, ch);
  const bottomRight = tikzPt(s.x + s.w, bottomY, ch);
  const topLeft = tikzPt(s.x, topY, ch);
  const topRight = tikzPt(s.x + s.w, topY, ch);

  let code = "";
  if (s.fill && s.fill !== "none" && s.fill !== "transparent") {
    code += `  \\fill[${tikzColor(s.fill)}] ${topLeft} -- ${bottomLeft} arc (180:360:${rx} and ${ry}) -- ${topRight} -- cycle;\n`;
    code += `  \\fill[${tikzColor(s.fill)}] ${topCenter} ellipse (${rx} and ${ry});\n`;
  }

  let drawOpt = "draw";
  if (s.stroke && s.stroke !== "#000000") drawOpt += `=${tikzColor(s.stroke)}`;

  code += `  \\draw[${drawOpt}] ${topCenter} ellipse (${rx} and ${ry});\n`;
  code += `  \\draw[${drawOpt}] ${topLeft} -- ${bottomLeft} arc (180:360:${rx} and ${ry}) -- ${topRight};`;

  if (s.label) {
    const cy = s.y + s.h / 2;
    code += `\n  \\node at ${tikzPt(cx, cy, ch)} {${s.label}};`;
  }
  return code;
}

function genGrid(s: DrawShape, ch: number): string {
  let styleOpts = "step=0.5cm, gray, very thin";
  if (s.stroke && s.stroke !== "#000000") styleOpts += `, ${tikzColor(s.stroke)}`;
  const p1 = tikzPt(s.x, s.y + s.h, ch);
  const p2 = tikzPt(s.x + s.w, s.y, ch);
  return `  \\draw[${styleOpts}] ${p1} grid ${p2};`;
}

function genAxes(s: DrawShape, ch: number): string {
  const pOrigin = tikzPt(s.x, s.y + s.h, ch);
  const pX = tikzPt(s.x + s.w, s.y + s.h, ch);
  const pY = tikzPt(s.x, s.y, ch);
  let drawOpt = "draw, ->, >=stealth";
  if (s.stroke && s.stroke !== "#000000") drawOpt += `, ${tikzColor(s.stroke)}`;
  return `  \\draw[${drawOpt}] ${pOrigin} -- ${pX} node[right] {$x$};\n  \\draw[${drawOpt}] ${pOrigin} -- ${pY} node[above] {$y$};`;
}

// ---------- main export ----------

const generators: Record<ShapeKind, (s: DrawShape, ch: number) => string> = {
  rect: genRect,
  circle: genCircle,
  ellipse: genEllipse,
  line: genLine,
  arrow: genArrow,
  text: genText,
  diamond: genDiamond,
  triangle: genTriangle,
  freehand: genFreehand,
  parallelogram: genParallelogram,
  cylinder: genCylinder,
  grid: genGrid,
  axes: genAxes,
};

export function generateTikzCode(
  shapes: DrawShape[],
  canvasWidth: number,
  canvasHeight: number,
): string {
  if (!shapes.length) {
    return (
      "\\begin{tikzpicture}\n" +
      "  % Draw on the canvas — TikZ code appears here in real time\n" +
      "\\end{tikzpicture}"
    );
  }

  const lines = shapes
    .map((shape) => {
      const gen = generators[shape.kind];
      return gen ? gen(shape, canvasHeight) : `  % Unknown shape: ${shape.kind}`;
    })
    .filter(Boolean);

  return "\\begin{tikzpicture}\n" + lines.join("\n") + "\n\\end{tikzpicture}";
}

/** Full document wrapper that can be compiled standalone */
export function generateFullDocument(
  shapes: DrawShape[],
  canvasWidth: number,
  canvasHeight: number,
): string {
  const tikz = generateTikzCode(shapes, canvasWidth, canvasHeight);
  return (
    "\\documentclass[border=10pt]{standalone}\n" +
    "\\usepackage{tikz}\n\n" +
    "\\begin{document}\n" +
    tikz +
    "\n\\end{document}\n"
  );
}
