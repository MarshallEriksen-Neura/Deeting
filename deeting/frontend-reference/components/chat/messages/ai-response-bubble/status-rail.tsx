"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { motion } from "framer-motion";

import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import {
  TerminalStream,
  type TerminalStreamHistoryItem,
  useStepProgress,
  resolveStageIndex,
} from "@/components/chat/visuals/status-visuals";

type BubbleUiState = {
  stableActiveStep: number;
  detailRepeat: number;
  stableDetail: string | null;
  stageHistory: TerminalStreamHistoryItem[];
};

type BubbleUiAction =
  | { type: "reset" }
  | { type: "advance_step"; step: number }
  | { type: "increment_detail_repeat" }
  | { type: "set_detail"; detail: string }
  | { type: "append_stage"; entry: TerminalStreamHistoryItem };

const INITIAL_BUBBLE_UI_STATE: BubbleUiState = {
  stableActiveStep: 0,
  detailRepeat: 1,
  stableDetail: null,
  stageHistory: [],
};

function bubbleUiReducer(
  state: BubbleUiState,
  action: BubbleUiAction,
): BubbleUiState {
  switch (action.type) {
    case "reset":
      if (
        state.stableActiveStep === 0 &&
        state.detailRepeat === 1 &&
        state.stableDetail === null &&
        state.stageHistory.length === 0
      ) {
        return state;
      }
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
    case "append_stage": {
      const currentLast = state.stageHistory[state.stageHistory.length - 1];
      if (currentLast?.key === action.entry.key) {
        return state;
      }
      const withoutDuplicate = state.stageHistory.filter(
        (entry) => entry.key !== action.entry.key,
      );
      return {
        ...state,
        stageHistory: [...withoutDuplicate, action.entry].slice(-6),
      };
    }
    default:
      return state;
  }
}

export function AIResponseStatusRail({
  isActive,
  hasContent,
  hasToolActivity,
  statusStage,
  statusCode,
  statusMeta,
  streamEnabled,
  shouldRevealCallChain,
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
  const { stableActiveStep, detailRepeat, stableDetail } = bubbleUiState;
  const lastDetailRef = useRef<string | null>(null);

  const statusDetail = useMemo(
    () => resolveStatusDetail(t, statusCode, statusMeta),
    [t, statusCode, statusMeta],
  );
  const repeatCountFromMeta = useMemo(() => {
    const raw = statusMeta?.repeat_count;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
    return Math.max(1, Math.floor(raw));
  }, [statusMeta]);

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

  useEffect(() => {
    if (!isActive) return;
    const fallbackStage =
      steps[Math.min(stableActiveStep, steps.length - 1)]?.key ?? null;
    const stageKey =
      statusStage && steps.some((step) => step.key === statusStage)
        ? statusStage
        : fallbackStage;
    if (!stageKey) return;
    const stageLabel =
      steps.find((step) => step.key === stageKey)?.label ?? stageKey;
    dispatchBubbleUi({
      type: "append_stage",
      entry: { key: stageKey, label: stageLabel },
    });
  }, [isActive, statusStage, stableActiveStep, steps]);

  const statusRailCompleted = !isActive && (hasContent || hasToolActivity);
  const liveStatusLabel = useMemo(() => {
    if (statusRailCompleted) {
      return t("status.header.completed");
    }
    return t(
      streamEnabled ? "status.header.answering" : "status.header.processing",
    );
  }, [statusRailCompleted, streamEnabled, t]);
  const terminalPlaceholder = useMemo(
    () => t("status.placeholder.waiting"),
    [t],
  );
  const shouldShowStatusRail =
    isActive || hasContent || hasToolActivity || Boolean(statusStage);
  const displayedStepIndex = statusRailCompleted
    ? steps.length - 1
    : stableActiveStep;
  const terminalDetail = isActive ? (stableDetail ?? statusDetail) : null;

  if (!shouldShowStatusRail) return null;

  return (
    <motion.div
      key="terminal-stream"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      <TerminalStream
        steps={steps}
        activeIndex={displayedStepIndex}
        label={
          streamEnabled
            ? t("status.flow.stream")
            : t("status.flow.batch")
        }
        statusLabel={liveStatusLabel}
        placeholder={terminalPlaceholder}
        showPlaceholder={!shouldRevealCallChain}
        detail={terminalDetail}
        detailRepeat={Math.max(detailRepeat, repeatCountFromMeta)}
        compact={hasContent || hasToolActivity}
        completed={statusRailCompleted}
      />
    </motion.div>
  );
}
