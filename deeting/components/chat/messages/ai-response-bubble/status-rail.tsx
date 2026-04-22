"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import {
  MinimalStatusIndicator,
  useStepProgress,
  resolveStageIndex,
} from "@/components/chat/visuals/status-visuals";

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
  const terminalDetail = isActive ? (stableDetail ?? statusDetail) : null;

  // 核心设计：只要 AI 处于激活状态（正在思考或输出），就显示状态指示器
  // 这样用户能持续看到“呼吸”和“加载”的律动
  const shouldShowStatusRail = isActive;

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
