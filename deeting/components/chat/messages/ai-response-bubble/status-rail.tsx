"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import {
  MinimalStatusIndicator,
  useStepProgress,
  resolveStageIndex,
} from "@/components/chat/visuals/status-visuals";

const MIN_RAIL_DISPLAY_MS = 800;
const STATUS_FLOW_STEP_KEYS = ["listen", "remember", "evolve", "render"] as const;

type StatusFlowStepKey = (typeof STATUS_FLOW_STEP_KEYS)[number];
type StatusFlowStep = { key: StatusFlowStepKey; label: string };
type Translator = ReturnType<typeof useI18n>;

function buildStatusFlowSteps(t: Translator): StatusFlowStep[] {
  return STATUS_FLOW_STEP_KEYS.map((key) => ({
    key,
    label: t(`status.flow.${key}`),
  }));
}

function useMinRailDisplay(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (active && !shownAtRef.current) {
      shownAtRef.current = Date.now();
      setHeld(true);
    }
    if (!active && shownAtRef.current) {
      const elapsed = Date.now() - shownAtRef.current;
      const remaining = MIN_RAIL_DISPLAY_MS - elapsed;
      if (remaining > 0) {
        const timer = setTimeout(() => {
          setHeld(false);
          shownAtRef.current = null;
        }, remaining);
        return () => clearTimeout(timer);
      }
      setHeld(false);
      shownAtRef.current = null;
    }
  }, [active]);

  return active || held;
}

// Slow-upstream hint thresholds (seconds). Once the assistant has been "active"
// (request in flight, no content yet) for this long, surface a friendly hint so
// users don't think the app is stuck on a poor network.
const SLOW_HINT_SOFT_S = 6;
const SLOW_HINT_MEDIUM_S = 15;
const SLOW_HINT_STRONG_S = 30;

function useElapsedSeconds(active: boolean, resetKey?: string | number | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSeconds(0);
    const tick = () => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [active, resetKey]);
  return seconds;
}

const UPSTREAM_REQUEST_CODES = new Set([
  "upstream.request.stream",
  "upstream.request.batch",
]);

function useUpstreamRoundCounter(statusCode: string | null): number {
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (statusCode && UPSTREAM_REQUEST_CODES.has(statusCode)) {
      setRound((prev) => prev + 1);
    }
  }, [statusCode]);
  return round;
}

function resolveSlowUpstreamHint(elapsedSeconds: number): string | null {
  if (elapsedSeconds < SLOW_HINT_SOFT_S) return null;
  if (elapsedSeconds < SLOW_HINT_MEDIUM_S) {
    return `等上游响应 · ${elapsedSeconds}s`;
  }
  if (elapsedSeconds < SLOW_HINT_STRONG_S) {
    return `网络较慢,还在等 · ${elapsedSeconds}s`;
  }
  return `上游响应慢 · ${elapsedSeconds}s(没卡住,可稍候)`;
}

type BubbleUiState = {
  stableActiveStep: number;
  detailRepeat: number;
  stableDetail: string | null;
};

type BubbleUiAction =
  | { type: "reset" }
  | { type: "advance_step"; step: number }
  | { type: "increment_detail_repeat" }
  | { type: "set_detail"; detail: string };

const INITIAL_BUBBLE_UI_STATE: BubbleUiState = {
  stableActiveStep: 0,
  detailRepeat: 1,
  stableDetail: null,
};

function bubbleUiReducer(
  state: BubbleUiState,
  action: BubbleUiAction,
): BubbleUiState {
  switch (action.type) {
    case "reset":
      return INITIAL_BUBBLE_UI_STATE;
    case "advance_step":
      if (action.step <= state.stableActiveStep) return state;
      return {
        ...state,
        stableActiveStep: action.step,
      };
    case "increment_detail_repeat":
      return {
        ...state,
        detailRepeat: state.detailRepeat + 1,
      };
    case "set_detail":
      return {
        ...state,
        stableDetail: action.detail,
        detailRepeat: 1,
      };
    default:
      return state;
  }
}

export function AIResponseStatusRail({
  isActive,
  hasContent,
  statusStage,
  statusCode,
  statusMeta,
}: {
  isActive: boolean;
  hasContent: boolean;
  hasToolActivity: boolean;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  streamEnabled: boolean;
  shouldRevealCallChain: boolean;
}) {
  const t = useI18n("chat");
  const steps = useMemo(
    () => buildStatusFlowSteps(t),
    [t],
  );
  const timerStep = useStepProgress(isActive && !statusStage, steps.length);
  const activeStep = statusStage
    ? resolveStageIndex(statusStage, steps)
    : timerStep;
  const [bubbleUiState, dispatchBubbleUi] = useReducer(
    bubbleUiReducer,
    INITIAL_BUBBLE_UI_STATE,
  );
  const { stableActiveStep, stableDetail } = bubbleUiState;
  const lastDetailRef = useRef<string | null>(null);

  const statusDetail = useMemo(
    () => resolveStatusDetail(t, statusCode, statusMeta),
    [t, statusCode, statusMeta],
  );

  useEffect(() => {
    if (!isActive && !hasContent) {
      lastDetailRef.current = null;
      dispatchBubbleUi({ type: "reset" });
    }
  }, [hasContent, isActive]);

  useEffect(() => {
    if (!isActive) return;
    dispatchBubbleUi({ type: "advance_step", step: activeStep });
  }, [activeStep, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const nextDetail =
      typeof statusDetail === "string" ? statusDetail.trim() : "";
    if (!nextDetail) return;
    if (lastDetailRef.current === nextDetail) {
      dispatchBubbleUi({ type: "increment_detail_repeat" });
      return;
    }
    lastDetailRef.current = nextDetail;
    dispatchBubbleUi({ type: "set_detail", detail: nextDetail });
  }, [isActive, statusDetail]);

  const currentStepLabel = steps[stableActiveStep]?.label ?? t("status.header.processing");
  const upstreamRound = useUpstreamRoundCounter(statusCode);
  const elapsedSeconds = useElapsedSeconds(isActive && !hasContent, upstreamRound);
  const slowUpstreamHint = resolveSlowUpstreamHint(elapsedSeconds);
  const terminalDetail = isActive
    ? (slowUpstreamHint ?? stableDetail ?? statusDetail)
    : null;

  // Show the status rail whenever the bubble is active and has not yet
  // produced user-visible answer content (text / thought / error / UI block).
  // Hold for a minimum window so users actually see the loader on fast paths.
  const rawShow = isActive && !hasContent;
  const shouldShowStatusRail = useMinRailDisplay(rawShow);

  return (
    <AnimatePresence mode="popLayout">
      {shouldShowStatusRail && (
        <motion.div
          key="minimal-status"
          initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
          animate={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
          }}
          exit={{
            opacity: 0,
            y: -20,
            filter: "blur(6px)",
            transition: { duration: 0.45, ease: [0.4, 0, 1, 1] },
          }}
          className="mb-2 will-change-[transform,opacity,filter]"
        >
          <MinimalStatusIndicator
            label={currentStepLabel}
            status={terminalDetail}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Compact presence indicator shown *after* the rail has handed off — i.e. once
// the bubble has user-visible answer content but is still streaming or otherwise
// active. Sits inline below the GhostCursor at the tail of the content so the
// user's eye (which is at the bottom reading the latest token) keeps seeing
// "still alive" without the heavy rail dominating their attention.
export function AIResponseStreamingTail({
  isActive,
  hasContent,
  statusStage,
  statusCode,
}: {
  isActive: boolean;
  hasContent: boolean;
  statusStage: string | null;
  statusCode: string | null;
}) {
  const t = useI18n("chat");
  const steps = useMemo(
    () => buildStatusFlowSteps(t),
    [t],
  );
  const timerStep = useStepProgress(isActive && !statusStage, steps.length);
  const activeStep = statusStage
    ? resolveStageIndex(statusStage, steps)
    : timerStep;
  const currentLabel =
    steps[activeStep]?.label ?? t("status.header.processing");
  const upstreamRound = useUpstreamRoundCounter(statusCode);
  const elapsedSeconds = useElapsedSeconds(isActive, upstreamRound);

  const visible = isActive && hasContent;

  return (
    <AnimatePresence mode="popLayout">
      {visible && (
        <motion.div
          key="streaming-tail"
          initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
          animate={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.1 },
          }}
          exit={{
            opacity: 0,
            y: -14,
            filter: "blur(4px)",
            transition: { duration: 0.35, ease: [0.4, 0, 1, 1] },
          }}
          className="mt-1 flex items-center gap-2 will-change-[transform,opacity,filter] origin-bottom"
        >
          <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500/40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500/70" />
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-[0.1em] text-muted-foreground/55">
            <span>{currentLabel}</span>
            <span className="text-muted-foreground/35 normal-case tracking-normal">
              · {elapsedSeconds}s
            </span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
