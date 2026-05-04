"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, BookOpenCheck, ChevronDown, CircleDashed } from "lucide-react";

import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import {
  MinimalStatusIndicator,
  useStepProgress,
  resolveStageIndex,
} from "@/components/chat/visuals/status-visuals";
import { cn } from "@/lib/utils";

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

type KnowledgeContextSummary = {
  state: "loading" | "loaded" | "empty" | "fallback" | "error";
  selectedFiles: number;
  excerptCount: number;
  overviewCount: number;
  windowExpandedCount: number;
  evidenceFiles: KnowledgeEvidenceFile[];
  evidenceItems: KnowledgeEvidenceItem[];
};

type KnowledgeEvidenceFile = {
  fileName: string;
  excerptCount: number;
};

type KnowledgeEvidenceItem = {
  key: string;
  fileName: string;
  index: number | null;
  score: number | null;
  matchReasons: string[];
};

function toFiniteCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

function toOptionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveKnowledgeEvidenceFiles(
  evidenceItems: KnowledgeEvidenceItem[],
): KnowledgeEvidenceFile[] {
  const files = new Map<string, KnowledgeEvidenceFile>();

  for (const item of evidenceItems) {
    const current = files.get(item.fileName);
    if (current) {
      current.excerptCount += 1;
    } else {
      files.set(item.fileName, { fileName: item.fileName, excerptCount: 1 });
    }
  }

  return Array.from(files.values());
}

function resolveKnowledgeEvidenceItems(
  statusMeta: Record<string, unknown> | null,
): KnowledgeEvidenceItem[] {
  const explain = Array.isArray(statusMeta?.explain) ? statusMeta.explain : [];
  const items: KnowledgeEvidenceItem[] = [];

  for (let i = 0; i < explain.length; i += 1) {
    const record = asRecord(explain[i]);
    const fileName = String(record?.file_name ?? "").trim();
    if (!fileName) continue;
    const chunkId = String(record?.chunk_id ?? "").trim();
    const index = toOptionalNumber(record?.index);
    items.push({
      key: chunkId || `${fileName}-${index ?? i}`,
      fileName,
      index,
      score: toOptionalNumber(record?.score),
      matchReasons: toStringArray(record?.match_reasons),
    });
  }

  return items;
}

function resolveKnowledgeContextSummary(
  statusCode: string | null,
  statusMeta: Record<string, unknown> | null,
): KnowledgeContextSummary | null {
  if (statusCode !== "knowledge.context.loading" && statusCode !== "knowledge.context.loaded") {
    return null;
  }

  const selectedFiles = toFiniteCount(statusMeta?.selected_files);
  const excerptCount = toFiniteCount(statusMeta?.count);
  const overviewCount = toFiniteCount(statusMeta?.overview_count);
  const windowExpandedCount = toFiniteCount(statusMeta?.window_expanded_count);
  const fallbackUsed = Boolean(statusMeta?.fallback_used);
  const searchError = Boolean(statusMeta?.search_error);
  const evidenceItems = resolveKnowledgeEvidenceItems(statusMeta);
  const evidenceFiles = resolveKnowledgeEvidenceFiles(evidenceItems);

  const summary = { selectedFiles, excerptCount, overviewCount, windowExpandedCount, evidenceFiles, evidenceItems };

  if (statusCode === "knowledge.context.loading") {
    return { ...summary, state: "loading" };
  }
  if (searchError) {
    return { ...summary, state: "error" };
  }
  if (excerptCount > 0 && fallbackUsed) {
    return { ...summary, state: "fallback" };
  }
  if (excerptCount > 0 || overviewCount > 0) {
    return { ...summary, state: "loaded" };
  }
  return { ...summary, state: "empty" };
}

function KnowledgeContextSummaryCard({ summary }: { summary: KnowledgeContextSummary }) {
  const t = useI18n("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const isLoading = summary.state === "loading";
  const isError = summary.state === "error";
  const isEmpty = summary.state === "empty";
  const visibleEvidenceFiles = summary.evidenceFiles.slice(0, 3);
  const hiddenEvidenceFileCount = Math.max(0, summary.evidenceFiles.length - visibleEvidenceFiles.length);
  const Icon = isLoading ? CircleDashed : isError || isEmpty ? AlertCircle : BookOpenCheck;
  const toneClass = isError || isEmpty
    ? "border-amber-200/70 bg-amber-50/80 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200"
    : "border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-200";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -3 }}
      className={`mt-1.5 flex w-fit max-w-full items-center gap-2 rounded-2xl border px-3 py-2 text-xs shadow-[0_12px_28px_-24px_rgba(15,23,42,0.45)] ${toneClass}`}
    >
      <Icon className={isLoading ? "h-4 w-4 shrink-0 animate-spin" : "h-4 w-4 shrink-0"} />
      <div className="min-w-0">
        <div className="truncate font-medium">
          {t(`status.knowledgeSummary.${summary.state}`, { selectedFiles: summary.selectedFiles })}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] opacity-75">
          {summary.selectedFiles > 0 ? (
            <span>{t("status.knowledgeSummary.selected", { count: summary.selectedFiles })}</span>
          ) : null}
          <span>{t("status.knowledgeSummary.excerpts", { count: summary.excerptCount })}</span>
          <span>{t("status.knowledgeSummary.overviews", { count: summary.overviewCount })}</span>
          {summary.windowExpandedCount > 0 ? (
            <span>{t("status.knowledgeSummary.expanded", { count: summary.windowExpandedCount })}</span>
          ) : null}
        </div>
        {visibleEvidenceFiles.length > 0 ? (
          <div className="mt-1 flex max-w-[min(28rem,calc(100vw-6rem))] flex-wrap items-center gap-1 text-[10px]">
            <span className="opacity-70">{t("status.knowledgeSummary.evidenceLabel")}</span>
            {visibleEvidenceFiles.map((file) => (
              <span
                key={file.fileName}
                title={file.fileName}
                className="max-w-40 truncate rounded-full border border-current/15 bg-white/45 px-1.5 py-0.5 dark:bg-white/10"
              >
                {t("status.knowledgeSummary.evidenceFile", {
                  fileName: file.fileName,
                  count: file.excerptCount,
                })}
              </span>
            ))}
            {hiddenEvidenceFileCount > 0 ? (
              <span className="opacity-70">
                {t("status.knowledgeSummary.evidenceMore", { count: hiddenEvidenceFileCount })}
              </span>
            ) : null}
          </div>
        ) : null}
        {summary.evidenceItems.length > 0 ? (
          <div className="mt-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 text-[10px] font-medium opacity-75 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              onClick={() => setIsExpanded((value) => !value)}
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  isExpanded ? "rotate-180" : "",
                )}
              />
              {t(isExpanded ? "status.knowledgeSummary.hideDetails" : "status.knowledgeSummary.showDetails")}
            </button>
            {isExpanded ? (
              <ol className="mt-1.5 max-h-32 space-y-1 overflow-y-auto pr-1 text-[10px]">
                {summary.evidenceItems.slice(0, 8).map((item) => (
                  <li
                    key={item.key}
                    className="rounded-lg border border-current/10 bg-white/40 px-2 py-1 dark:bg-white/10"
                  >
                    <div className="truncate font-medium" title={item.fileName}>
                      {t("status.knowledgeSummary.evidenceDetail", {
                        fileName: item.fileName,
                        index: item.index != null ? item.index + 1 : 0,
                      })}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 opacity-70">
                      {item.score != null ? (
                        <span>{t("status.knowledgeSummary.score", { score: item.score.toFixed(2) })}</span>
                      ) : null}
                      {item.matchReasons.slice(0, 2).map((reason) => (
                        <span key={reason}>{reason}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

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
  const knowledgeSummary = useMemo(
    () => resolveKnowledgeContextSummary(statusCode, statusMeta),
    [statusCode, statusMeta],
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
          <AnimatePresence mode="wait" initial={false}>
            {knowledgeSummary ? (
              <KnowledgeContextSummaryCard
                key={`${knowledgeSummary.state}-${knowledgeSummary.selectedFiles}-${knowledgeSummary.excerptCount}-${knowledgeSummary.overviewCount}`}
                summary={knowledgeSummary}
              />
            ) : null}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
