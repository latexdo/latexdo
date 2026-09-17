import React from "react";
import { Check, ChevronRight, Eye, FastForward, Play } from "lucide-react";
import {
  getTourProgress,
  markFeatureDiscovery,
  recordOnboardingAnalytics,
  updateTourProgress,
} from "../core/DiscoveryStore";
import { subscribeProductEvents, type ProductEvent } from "../core/ProductEvents";
import type { TourDefinition, TourRuntimeState, TourStep } from "../core/TourTypes";

interface TourOverlayProps {
  tour: TourDefinition;
  launchNonce: number;
  onPrepare: () => void;
  onRestore: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectForTarget(targetId: string): TargetRect | null {
  const element = document.querySelector<HTMLElement>(`[data-tour-id="${targetId}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function stepMatchesEvent(step: TourStep, event: ProductEvent): boolean {
  return step.expectedEvent === event.type;
}

export const TourOverlay: React.FC<TourOverlayProps> = ({
  tour,
  launchNonce,
  onPrepare,
  onRestore,
}) => {
  const [runtimeState, setRuntimeState] = React.useState<TourRuntimeState>("idle");
  const [visible, setVisible] = React.useState(false);
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);
  const [targetRect, setTargetRect] = React.useState<TargetRect | null>(null);
  const [successMessage, setSuccessMessage] = React.useState("");
  const [startedAt, setStartedAt] = React.useState(0);
  const [attemptCount, setAttemptCount] = React.useState(0);
  const shownStepRef = React.useRef<string | null>(null);
  const currentStep = tour.steps[currentStepIndex];

  const updateTargetRect = React.useCallback(() => {
    if (!currentStep) {
      setTargetRect(null);
      return;
    }
    setTargetRect(rectForTarget(currentStep.targetId));
  }, [currentStep]);

  React.useEffect(() => {
    if (launchNonce <= 0) return;
    const progress = getTourProgress(tour.id, tour.version);
    if (progress.state === "completed" || progress.state === "dismissed") return;
    const timer = window.setTimeout(() => {
      setVisible(true);
      setRuntimeState("showing");
      updateTourProgress({
        ...progress,
        state: "introduced",
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [launchNonce, tour.id, tour.version]);

  React.useEffect(() => {
    if (!visible || runtimeState === "showing" || runtimeState === "idle") return;
    updateTargetRect();
    const onResize = () => updateTargetRect();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const timer = window.setInterval(updateTargetRect, 500);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.clearInterval(timer);
    };
  }, [runtimeState, updateTargetRect, visible]);

  React.useEffect(() => {
    if (!visible || runtimeState !== "waiting-for-user" || !currentStep) return;
    const shownStepKey = `${tour.id}:${tour.version}:${currentStep.id}`;
    if (shownStepRef.current === shownStepKey) return;
    shownStepRef.current = shownStepKey;
    const progress = getTourProgress(tour.id, tour.version);
    updateTourProgress({
      ...progress,
      state: "started",
    });
    markFeatureDiscovery(currentStep.featureId, "introduced");
    recordOnboardingAnalytics({
      type: "tour_step_shown",
      tourId: tour.id,
      tourVersion: tour.version,
      stepId: currentStep.id,
      featureId: currentStep.featureId,
      attemptCount,
    });
  }, [attemptCount, currentStep, runtimeState, tour.id, tour.version, visible]);

  React.useEffect(() => {
    if (runtimeState !== "waiting-for-user" || !currentStep?.expectedEvent) return;
    return subscribeProductEvents((event) => {
      if (!stepMatchesEvent(currentStep, event)) return;
      completeStep("event");
    });
    // completeStep intentionally reads current runtime state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, runtimeState]);

  const startTour = () => {
    setRuntimeState("preparing");
    onPrepare();
    shownStepRef.current = null;
    setCurrentStepIndex(0);
    setSuccessMessage("");
    setStartedAt(Date.now());
    setAttemptCount(1);
    window.setTimeout(() => {
      setRuntimeState("waiting-for-user");
      updateTargetRect();
      recordOnboardingAnalytics({
        type: "tour_step_started",
        tourId: tour.id,
        tourVersion: tour.version,
        stepId: tour.steps[0]?.id,
        featureId: tour.steps[0]?.featureId,
        attemptCount: 1,
      });
    }, 80);
  };

  const completeTour = (completionMethod: "manual" | "skip") => {
    const progress = getTourProgress(tour.id, tour.version);
    updateTourProgress({
      ...progress,
      state: completionMethod === "skip" ? "dismissed" : "completed",
    });
    recordOnboardingAnalytics({
      type: completionMethod === "skip" ? "tour_dismissed" : "tour_completed",
      tourId: tour.id,
      tourVersion: tour.version,
      elapsedMs: Date.now() - startedAt,
      completionMethod,
    });
    setRuntimeState("completed");
    setVisible(false);
    setSuccessMessage("");
    onRestore();
  };

  const completeStep = (completionMethod: "event" | "show-me" | "skip" | "manual") => {
    if (!currentStep) return;
    const progress = getTourProgress(tour.id, tour.version);
    const completedSteps =
      completionMethod === "skip"
        ? progress.completedSteps
        : Array.from(new Set([...progress.completedSteps, currentStep.id]));
    const skippedSteps =
      completionMethod === "skip"
        ? Array.from(new Set([...progress.skippedSteps, currentStep.id]))
        : progress.skippedSteps;
    updateTourProgress({
      ...progress,
      state: "started",
      completedSteps,
      skippedSteps,
    });
    markFeatureDiscovery(
      currentStep.featureId,
      completionMethod === "skip"
        ? "dismissed"
        : completionMethod === "event"
          ? "mastered"
          : "tried",
    );
    recordOnboardingAnalytics({
      type: completionMethod === "skip" ? "tour_step_skipped" : "tour_step_succeeded",
      tourId: tour.id,
      tourVersion: tour.version,
      stepId: currentStep.id,
      featureId: currentStep.featureId,
      elapsedMs: Date.now() - startedAt,
      attemptCount,
      completionMethod,
    });
    setSuccessMessage(completionMethod === "skip" ? "Skipped." : currentStep.success);
    setRuntimeState("success");
    window.setTimeout(
      () => {
        if (currentStepIndex >= tour.steps.length - 1) {
          completeTour("manual");
          return;
        }
        setCurrentStepIndex((index) => index + 1);
        setAttemptCount((count) => count + 1);
        setSuccessMessage("");
        setRuntimeState("waiting-for-user");
      },
      completionMethod === "skip" ? 180 : 650,
    );
  };

  const markStepInteracted = () => {
    if (!currentStep) return;
    setAttemptCount((count) => count + 1);
    recordOnboardingAnalytics({
      type: "tour_step_interacted",
      tourId: tour.id,
      tourVersion: tour.version,
      stepId: currentStep.id,
      featureId: currentStep.featureId,
      elapsedMs: Date.now() - startedAt,
      attemptCount: attemptCount + 1,
      completionMethod: "manual",
    });
    setSuccessMessage("Good. Now complete the action in LatexDo.");
  };

  const abandonTour = () => completeTour("skip");

  if (!visible) return null;

  if (runtimeState === "showing") {
    return (
      <div className="tour-prompt-backdrop" role="presentation">
        <section
          className="tour-prompt"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-prompt-title"
        >
          <div className="tour-prompt-icon">
            <Play size={18} />
          </div>
          <h2 id="tour-prompt-title">{tour.title}</h2>
          <p>{tour.intro}</p>
          <div className="tour-prompt-actions">
            <button type="button" className="tour-primary" onClick={startTour}>
              Start interactive tour <ChevronRight size={15} />
            </button>
            <button type="button" className="tour-secondary" onClick={abandonTour}>
              Skip for now
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="tour-layer" role="presentation">
      <div className="tour-scrim" />
      {targetRect ? (
        <div
          className="tour-spotlight"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      ) : null}
      <section
        className="tour-coachmark"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-step-title"
      >
        <div className="tour-progress" aria-label="Tour progress">
          <span>
            {currentStepIndex + 1} / {tour.steps.length}
          </span>
          <div>
            <i
              style={{
                width: `${((currentStepIndex + 1) / tour.steps.length) * 100}%`,
              }}
            />
          </div>
        </div>
        <h2 id="tour-step-title">{currentStep?.title}</h2>
        <p>{currentStep?.body}</p>
        {currentStep?.fallback ? (
          <small className="tour-fallback">{currentStep.fallback}</small>
        ) : null}
        {successMessage ? (
          <div className="tour-success" role="status">
            <Check size={14} /> {successMessage}
          </div>
        ) : null}
        <div className="tour-actions">
          <button
            type="button"
            className="tour-primary"
            onClick={() =>
              completeStep(currentStep?.expectedEvent ? "show-me" : "manual")
            }
          >
            {currentStep?.expectedEvent ? (
              <>
                <Eye size={14} /> Show me
              </>
            ) : (
              <>
                {currentStep?.cta ?? "Continue"} <ChevronRight size={14} />
              </>
            )}
          </button>
          {currentStep?.expectedEvent ? (
            <button
              type="button"
              className="tour-secondary"
              onClick={markStepInteracted}
            >
              {currentStep.cta}
            </button>
          ) : null}
          <button
            type="button"
            className="tour-ghost"
            onClick={() => completeStep("skip")}
          >
            <FastForward size={14} /> Skip step
          </button>
          <button type="button" className="tour-ghost" onClick={abandonTour}>
            Skip tour
          </button>
        </div>
      </section>
    </div>
  );
};
