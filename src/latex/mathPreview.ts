import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
// Load TeX extensions explicitly instead of AllPackages: the full bundle
// includes loader machinery that evaluates code at import time, which the
// renderer CSP (script-src 'self') forbids.
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js";

const texPackages = [
  "base",
  "ams",
  "newcommand",
  "noundefined",
  "boldsymbol",
  "color",
  "cancel",
  "mathtools",
  "textmacros",
];

export { parseMathAtPosition } from "./mathParse";
export type { MathAtPosition } from "./mathParse";

let renderer: {
  convert: (tex: string, display: boolean) => string;
} | null = null;

function ensureRenderer() {
  if (renderer) return renderer;

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({
    packages: texPackages,
    formatError: (_jax: unknown, error: { message: string }) => {
      throw new Error(error.message);
    },
  });
  const svg = new SVG({ fontCache: "local" });
  const document = mathjax.document("", { InputJax: tex, OutputJax: svg });

  renderer = {
    convert: (texSource: string, display: boolean) => {
      // Tag and label state survives between conversions, so an equation
      // carrying \label renders once and then fails with "Label ... multiply
      // defined" on every later preview. Reset before each render.
      tex.reset();
      document.reset();
      const node = document.convert(texSource, { display });
      return adaptor.innerHTML(node as Parameters<typeof adaptor.innerHTML>[0]);
    },
  };
  return renderer;
}

/**
 * Renders TeX math to an SVG data URI with a transparent background and the
 * given foreground color, ready to embed in a Markdown hover. Returns null
 * when the expression cannot be rendered.
 */
export function mathPreviewDataUri(
  tex: string,
  display: boolean,
  color: string,
): string | null {
  try {
    const svgMarkup = ensureRenderer().convert(tex, display);
    if (!svgMarkup.includes("<svg") || svgMarkup.includes("data-mjx-error")) {
      return null;
    }
    // MathJax paints glyphs with currentColor; pin it to the theme foreground.
    // The background stays transparent so the preview always matches the
    // surrounding UI.
    const themed = svgMarkup.replace(/^<svg /, `<svg style="color:${color};" `);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themed)}`;
  } catch {
    return null;
  }
}
