/// <reference types="vite/client" />

import type { TexlyApi } from "../electron/preload.cjs";

declare global {
  interface Window {
    texly: TexlyApi;
  }
}

export {};
