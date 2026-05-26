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
    () => [
      { key: "listen", label: t("status.flow.listen") },
      { key: "remember", label: t("status.flow.remember") },
      { key: "evolve", label: t("status.flow.evolve") },
      { key: "render", label: t("status.flow.render") },
    ],
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
  // Tool calls and intermediate execution blocks are deliberately ignored
  // here so the loading indicator keeps spinning between phases (e.g. while
  // the model is still composing a reply after a tool result has arrived).
  const shouldShowStatusRail = isActive && !hasContent;

  return (
    <AnimatePresence>
      {shouldShowStatusRail && (
        <motion.div
          key="minimal-status"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          className="mb-2"
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
    () => [
      { key: "listen", label: t("status.flow.listen") },
      { key: "remember", label: t("status.flow.remember") },
      { key: "evolve", label: t("status.flow.evolve") },
      { key: "render", label: t("status.flow.render") },
    ],
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
    <AnimatePresence>
      {visible && (
        <motion.div
          key="streaming-tail"
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.4, ease: "easeOut" } }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.1 }}
          className="mt-1 flex items-center gap-2"
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
