import type { ProductEvent } from "./ProductEvents";

export type TourMode = "explain" | "demonstrate" | "user-action";

export interface TourDefinition {
  id: string;
  version: number;
  title: string;
  intro: string;
  steps: TourStep[];
}

export interface TourStep {
  id: string;
  featureId: string;
  targetId: string;
  title: string;
  body: string;
  mode: TourMode;
  cta: string;
  expectedEvent?: ProductEvent["type"];
  success: string;
  fallback?: string;
}

export type TourRuntimeState =
  | "idle"
  | "preparing"
  | "showing"
  | "waiting-for-user"
  | "success"
  | "transitioning"
  | "paused"
  | "completed";
