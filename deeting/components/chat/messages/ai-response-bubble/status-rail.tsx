"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";

import { resolveStatusDetail, resolveWorldModelSummary } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import { MathCurveLoader } from "@/components/chat/visuals/math-curve-loader";
import { ArrowRight, Clock3, Globe } from "lucide-react";
import {
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

// Slow-upstream hint thresholds (seconds)
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

// ── Accumulated status detail list ──

type DetailEntry = { id: number; text: string };

type RailState = {
  details: DetailEntry[];
  nextId: number;
};

type RailAction =
  | { type: "reset" }
  | { type: "append"; text: string };

function railReducer(state: RailState, action: RailAction): RailState {
  switch (action.type) {
    case "reset":
      return { details: [], nextId: 0 };
    case "append": {
      const exists = state.details.some((d) => d.text === action.text);
      if (exists) return state;
      return {
        details: [...state.details, { id: state.nextId, text: action.text }],
        nextId: state.nextId + 1,
      };
    }
    default:
      return state;
  }
}

// ── Animation variants ──

const DETAIL_VARIANTS: Variants = {
  initial: { opacity: 0, y: 6 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.3 } },
};

const RAIL_VARIANTS: Variants = {
  initial: { opacity: 0, y: 12, filter: "blur(4px)" },
  enter: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -20, filter: "blur(6px)", transition: { duration: 0.45, ease: [0.4, 0, 1, 1] } },
};

// ── Main component ──

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
  const steps = useMemo(() => buildStatusFlowSteps(t), [t]);
  const timerStep = useStepProgress(isActive && !statusStage, steps.length);
  const activeStep = statusStage ? resolveStageIndex(statusStage, steps) : timerStep;
  const currentStepLabel = steps[activeStep]?.label ?? t("status.header.processing");

  // Accumulate status detail lines
  const [railState, dispatch] = useReducer(railReducer, { details: [], nextId: 0 });
  const lastDetailRef = useRef<string | null>(null);

  const statusDetail = useMemo(
    () => resolveStatusDetail(t, statusCode, statusMeta),
    [t, statusCode, statusMeta],
  );

  const wmSummary = useMemo(
    () => resolveWorldModelSummary(statusCode, statusMeta),
    [statusCode, statusMeta],
  );

  useEffect(() => {
    if (!isActive && !hasContent) {
      lastDetailRef.current = null;
      wmRef.current = null;
      dispatch({ type: "reset" });
    }
  }, [hasContent, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const text = typeof statusDetail === "string" ? statusDetail.trim() : "";
    if (!text) return;
    if (lastDetailRef.current === text) return;
    lastDetailRef.current = text;
    dispatch({ type: "append", text });
  }, [isActive, statusDetail]);

  const isUpstreamRequest = Boolean(statusCode && UPSTREAM_REQUEST_CODES.has(statusCode));
  const isWorldModelEvent = Boolean(statusCode && WORLD_MODEL_EVENT_CODES.has(statusCode));
  const upstreamRound = useUpstreamRoundCounter(statusCode);
  const upstreamElapsed = useElapsedSeconds(isActive && isUpstreamRequest, upstreamRound);
  const upstreamHint = isUpstreamRequest ? resolveSlowUpstreamHint(upstreamElapsed) : null;
  const upstreamLabel = isUpstreamRequest
    ? (statusDetail ?? t("status.detail.upstreamRequestStream"))
    : null;

  const worldModelTitle = statusDetail ?? currentStepLabel;
  const worldModelSubtitle =
    wmSummary?.goal && wmSummary.goal !== worldModelTitle ? wmSummary.goal : null;
  const worldModelCounts =
    wmSummary &&
    (wmSummary.facts > 0 || wmSummary.assumptions > 0 || wmSummary.unknowns > 0)
      ? t("status.detail.worldModelSummaryChip", {
          facts: wmSummary.facts,
          assumptions: wmSummary.assumptions,
          unknowns: wmSummary.unknowns,
        })
      : null;
  const worldModelRows = useMemo(() => {
    if (!wmSummary) return [] as Array<{
      key: string;
      label: string;
      tone: string;
      text: string;
    }>;

    const rows = [
      ...wmSummary.updateFacts.map((text, index) => ({
        key: "fact-" + index,
        label: "+",
        tone: "emerald",
        text,
      })),
      ...wmSummary.updateAssumptions.map((text, index) => ({
        key: "assumption-" + index,
        label: "+",
        tone: "sky",
        text,
      })),
      ...wmSummary.updateUnknowns.map((text, index) => ({
        key: "unknown-" + index,
        label: "+",
        tone: "amber",
        text,
      })),
    ];

    return rows.filter((row) => row.text.trim().length > 0).slice(0, 6);
  }, [wmSummary]);

  // Visibility — keep rail visible while the response is active,
  // regardless of whether content has started arriving.
  // This ensures status updates (world model, tool calls, etc.)
  // remain visible throughout the entire response lifecycle.
  const rawShow = isActive;
  const shouldShow = useMinRailDisplay(rawShow);

  return (
    <AnimatePresence mode="popLayout">
      {shouldShow && (
        <motion.div
          key="status-rail"
          data-wm-tick={wmTick}
          variants={RAIL_VARIANTS}
          initial="initial"
          animate="enter"
          exit="exit"
          className={cn(
            "mb-2 will-change-[transform,opacity,filter]",
            isWorldModelEvent
              ? "overflow-hidden rounded-[22px] border border-white/10 bg-[#111318]/96 text-slate-100 shadow-[0_22px_60px_-30px_rgba(0,0,0,0.85)] backdrop-blur-xl"
              : "flex flex-col gap-1.5 px-1 py-3 min-h-[40px]",
          )}
        >
          {isWorldModelEvent ? (
            <div className="flex flex-col">
              <div className="flex items-start gap-3 px-3.5 py-3.5">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-400/15 bg-emerald-400/10 text-emerald-300">
                  <Globe className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-semibold leading-tight tracking-tight text-slate-50">
                      {worldModelTitle}
                    </span>
                    {worldModelSubtitle && (
                      <span className="text-[11px] text-slate-400">
                        {worldModelSubtitle}
                      </span>
                    )}
                  </div>

                  {worldModelCounts && (
                    <div className="mt-2 inline-flex items-center rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[10.5px] font-mono text-slate-300/90">
                      {worldModelCounts}
                    </div>
                  )}
                </div>
              </div>

              {(worldModelRows.length > 0 || railState.details.length > 0) && (
                <div className="border-t border-white/6 px-3.5 py-3">
                  <div className="flex flex-col gap-1.5">
                    <AnimatePresence mode="popLayout">
                      {railState.details.slice(-3).map((entry, index) => (
                        <motion.div
                          key={entry.id}
                          variants={DETAIL_VARIANTS}
                          initial="initial"
                          animate="enter"
                          exit="exit"
                          className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-300/86"
                        >
                          <span className="mt-[0.24rem] text-[10px] font-semibold text-slate-500">
                            {index === 0 ? "•" : "·"}
                          </span>
                          <span className="min-w-0 flex-1 break-words">{entry.text}</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    <AnimatePresence mode="popLayout">
                      {worldModelRows.map((row) => (
                        <motion.div
                          key={row.key}
                          variants={DETAIL_VARIANTS}
                          initial="initial"
                          animate="enter"
                          exit="exit"
                          className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-200/88"
                        >
                          <span
                            className={cn(
                              "mt-[0.24rem] text-[10px] font-semibold",
                              row.tone === "emerald" && "text-emerald-300/80",
                              row.tone === "sky" && "text-sky-300/80",
                              row.tone === "amber" && "text-amber-300/80",
                            )}
                          >
                            {row.label}
                          </span>
                          <span className="min-w-0 flex-1 break-words">{row.text}</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {isUpstreamRequest && (
                  <motion.div
                    key="math-loader"
                    variants={DETAIL_VARIANTS}
                    initial="initial"
                    animate="enter"
                    exit="exit"
                    className="flex items-center gap-2.5 border-t border-white/6 px-3.5 py-2.5"
                  >
                    <MathCurveLoader
                      curve="rose3"
                      size={20}
                      particles={18}
                      trail={0.3}
                      loopMs={2400}
                      pulseMs={3200}
                      className="relative z-10"
                    />
                    <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-[0.1em] text-slate-400/90">
                      <Clock3 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{upstreamLabel}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[10.5px] font-mono text-slate-500/80">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span>{upstreamHint ?? (String(upstreamElapsed) + "s")}</span>
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <>
              {/* Step label */}
              <motion.div variants={DETAIL_VARIANTS} className="flex items-center gap-2">
                <span
                  className={
                    "text-[11px] font-semibold uppercase tracking-[0.18em] leading-none " +
                    "text-[#111] dark:text-[var(--ink)] animate-pulse"
                  }
                >
                  {currentStepLabel}
                </span>
              </motion.div>

              {/* World model goal */}
              {wmSummary?.goal && (
                <motion.div
                  variants={DETAIL_VARIANTS}
                  className="text-[11px] font-mono leading-tight text-[#6d5cff]/50 dark:text-[var(--accent)]/50"
                >
                  {wmSummary.goal}
                </motion.div>
              )}

              {/* World model summary chip */}
              {wmSummary && (wmSummary.facts > 0 || wmSummary.assumptions > 0 || wmSummary.unknowns > 0) && (
                <motion.div
                  variants={DETAIL_VARIANTS}
                  className="inline-flex self-start items-center gap-1.5 rounded-full border border-[#6d5cff]/10 bg-[#6d5cff]/5 px-2 py-0.5 dark:border-[var(--accent)]/10 dark:bg-[var(--accent)]/8"
                >
                  {wmSummary.facts > 0 && (
                    <span className="text-[10px] font-mono text-[#6d5cff]/50 dark:text-[var(--accent)]/50">
                      {wmSummary.facts} 事实
                    </span>
                  )}
                  {wmSummary.facts > 0 && wmSummary.assumptions > 0 && (
                    <span className="text-[10px] text-[#6d5cff]/20">·</span>
                  )}
                  {wmSummary.assumptions > 0 && (
                    <span className="text-[10px] font-mono text-[#6d5cff]/50 dark:text-[var(--accent)]/50">
                      {wmSummary.assumptions} 假设
                    </span>
                  )}
                  {wmSummary.unknowns > 0 && (
                    <>
                      <span className="text-[10px] text-[#6d5cff]/20">·</span>
                      <span className="text-[10px] font-mono text-[#6d5cff]/50 dark:text-[var(--accent)]/50">
                        {wmSummary.unknowns} 未知
                      </span>
                    </>
                  )}
                </motion.div>
              )}

              {/* World model update content snippets */}
              {wmSummary && wmSummary.updateFacts.length > 0 && (
                <motion.div variants={DETAIL_VARIANTS} className="mt-0.5 flex flex-col gap-0.5">
                  {wmSummary.updateFacts.map((fact, i) => (
                    <span
                      key={"fact-" + i}
                      className="truncate text-[10px] font-mono leading-tight text-[#6d5cff]/40 dark:text-[var(--accent)]/40"
                    >
                      + {fact}
                    </span>
                  ))}
                </motion.div>
              )}

              {/* Status detail lines */}
              <AnimatePresence mode="popLayout">
                {railState.details.map((entry) => (
                  <motion.div
                    key={entry.id}
                    variants={DETAIL_VARIANTS}
                    initial="initial"
                    animate="enter"
                    exit="exit"
                    className="text-[11px] font-mono leading-none text-[#6d5cff]/60 dark:text-[var(--accent)]/60"
                  >
                    {entry.text}
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* MathCurveLoader for upstream requests */}
              <AnimatePresence>
                {isUpstreamRequest && (
                  <motion.div
                    key="math-loader"
                    variants={DETAIL_VARIANTS}
                    initial="initial"
                    animate="enter"
                    exit="exit"
                    className="mt-1 flex items-center gap-2.5"
                  >
                    <MathCurveLoader
                      curve="rose3"
                      size={20}
                      particles={18}
                      trail={0.3}
                      loopMs={2400}
                      pulseMs={3200}
                      className="relative z-10"
                    />
                    <span className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-muted-foreground/50">
                      {upstreamLabel}
                    </span>
                    <span className="text-[10.5px] font-mono text-muted-foreground/30">
                      · {upstreamHint ?? String(upstreamElapsed) + "s"}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Streaming tail (unchanged) ──

export function AIResponseStreamingTail({
  isActive,
  hasContent,
  statusStage,
  statusCode,
  statusMeta,
}: {
  isActive: boolean;
  hasContent: boolean;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
}) {
  const t = useI18n("chat");
  const steps = useMemo(() => buildStatusFlowSteps(t), [t]);
  const timerStep = useStepProgress(isActive && !statusStage, steps.length);
  const activeStep = statusStage
    ? resolveStageIndex(statusStage, steps)
    : timerStep;
  const currentLabel =
    steps[activeStep]?.label ?? t("status.header.processing");
  const upstreamRound = useUpstreamRoundCounter(statusCode);
  const isUpstreamRequest = Boolean(
    statusCode && UPSTREAM_REQUEST_CODES.has(statusCode),
  );
  const elapsedSeconds = useElapsedSeconds(isActive, upstreamRound);
  const upstreamElapsedSeconds = useElapsedSeconds(
    isActive && isUpstreamRequest,
    upstreamRound,
  );
  const statusDetail = useMemo(
    () => resolveStatusDetail(t, statusCode, statusMeta),
    [t, statusCode, statusMeta],
  );
  const upstreamHint = isUpstreamRequest
    ? resolveSlowUpstreamHint(upstreamElapsedSeconds)
    : null;
  const liveDetail = isUpstreamRequest
    ? (
      upstreamHint ??
      (statusDetail
        ? `${statusDetail} · ${upstreamElapsedSeconds}s`
        : `${upstreamElapsedSeconds}s`)
    )
    : null;

  const visible = isActive;
  const isWaitingForFirstContent = visible && !hasContent;

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
          className={
            isWaitingForFirstContent
              ? "mt-1 flex min-w-0 items-center gap-3 rounded-md border border-border/45 bg-background/55 px-3 py-2.5 shadow-sm shadow-black/[0.03] backdrop-blur-sm will-change-[transform,opacity,filter] origin-bottom"
              : "mt-1 flex min-w-0 items-center gap-2 will-change-[transform,opacity,filter] origin-bottom"
          }
        >
          {isWaitingForFirstContent ? (
            <>
              <MathCurveLoader
                curve="rose3"
                size={22}
                particles={18}
                trail={0.28}
                loopMs={2300}
                pulseMs={3200}
                label={currentLabel}
                className="text-primary/75"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-foreground/70">
                  {currentLabel}
                </span>
                <span className="min-w-0 truncate text-[10.5px] font-mono leading-none text-muted-foreground/55">
                  {liveDetail ?? `${elapsedSeconds}s`}
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500/40" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500/70" />
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-[0.1em] text-muted-foreground/55">
                <span className="shrink-0">{currentLabel}</span>
                <span className="min-w-0 truncate text-muted-foreground/35 normal-case tracking-normal">
                  · {liveDetail ?? `${elapsedSeconds}s`}
                </span>
              </span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
