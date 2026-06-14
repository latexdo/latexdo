/// <reference types="vite/client" />

import type { LatexDoApi } from "../electron/preload.cjs";

declare global {
  interface Window {
    latexdo: LatexDoApi;
  }
}

export {};
