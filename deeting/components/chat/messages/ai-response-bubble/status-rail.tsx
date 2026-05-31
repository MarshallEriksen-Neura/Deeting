"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";

import { resolveStatusDetail, resolveWorldModelSummary } from "@/lib/chat/status-detail";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { MathCurveLoader } from "@/components/chat/visuals/math-curve-loader";
import { ArrowRight, Clock3, Globe, Sparkles } from "lucide-react";
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
  initial: { opacity: 0, x: -8, scale: 0.96 },
  enter: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
      opacity: { duration: 0.3 }
    }
  },
  exit: {
    opacity: 0,
    x: -12,
    scale: 0.94,
    transition: { duration: 0.25, ease: [0.4, 0, 1, 1] }
  },
};

const RAIL_VARIANTS: Variants = {
  initial: { opacity: 0, y: 16, scale: 0.96, filter: "blur(8px)" },
  enter: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
      scale: { duration: 0.4 },
      filter: { duration: 0.35 }
    }
  },
  exit: {
    opacity: 0,
    y: -24,
    scale: 0.94,
    filter: "blur(10px)",
    transition: {
      duration: 0.4,
      ease: [0.4, 0, 1, 1]
    }
  },
};

// __CONTINUE_PART2__

const TIMELINE_NODE_VARIANTS: Variants = {
  initial: { scale: 0, opacity: 0 },
  enter: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 25,
      mass: 0.8
    }
  },
  exit: {
    scale: 0,
    opacity: 0,
    transition: { duration: 0.2 }
  },
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

  // __CONTINUE_PART3__

  const isUpstreamRequest = Boolean(statusCode && UPSTREAM_REQUEST_CODES.has(statusCode));
  const isWorldModelEvent = Boolean(wmSummary);
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

  const rawShow = isActive;
  const shouldShow = useMinRailDisplay(rawShow);

  // __CONTINUE_PART4__

  return (
    <AnimatePresence mode="popLayout">
      {shouldShow && (
        <motion.div
          key="status-rail"
          variants={RAIL_VARIANTS}
          initial="initial"
          animate="enter"
          exit="exit"
          className={cn(
            "mb-3 will-change-[transform,opacity,filter]",
            isWorldModelEvent
              ? "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-slate-900/95 via-slate-900/98 to-slate-950/95 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-2xl"
              : "flex flex-col gap-2 px-1 py-3 min-h-[40px]",
          )}
        >
          {/* Subtle gradient overlay for depth */}
          {isWorldModelEvent && (
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.03] via-transparent to-black/[0.08]" />
          )}

          {isWorldModelEvent ? (
            <div className="relative flex flex-col">
              {/* Header section with icon and title */}
              <div className="flex items-start gap-3.5 px-4 py-4">
                {/* Animated icon with glow effect */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center"
                >
                  {/* Glow effect */}
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400/20 to-teal-500/20 blur-md" />
                  {/* Icon container */}
                  <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/20 bg-gradient-to-br from-emerald-400/10 to-teal-500/10 shadow-inner">
                    <Globe className="h-4.5 w-4.5 text-emerald-300" />
                  </div>
                  {/* Pulse ring */}
                  <motion.div
                    className="absolute inset-0 rounded-full border border-emerald-400/30"
                    animate={{
                      scale: [1, 1.3, 1],
                      opacity: [0.5, 0, 0.5],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                </motion.div>

                {/* Title and metadata */}
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className="text-[13.5px] font-semibold leading-tight tracking-tight text-slate-50">
                      {worldModelTitle}
                    </span>
                    {worldModelSubtitle && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span className="text-[11.5px] text-slate-400/90">
                          {worldModelSubtitle}
                        </span>
                      </>
                    )}
                  </div>

                  {worldModelCounts && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[10.5px] font-mono text-slate-300/95 shadow-sm"
                    >
                      <Sparkles className="h-3 w-3 text-slate-400/70" />
                      {worldModelCounts}
                    </motion.div>
                  )}
                </div>
              </div>

              {/* __CONTINUE_PART5__ */}

              {/* Timeline section with details */}
              {(worldModelRows.length > 0 || railState.details.length > 0) && (
                <div className="relative border-t border-white/[0.05] bg-black/10 px-4 py-3.5">
                  {/* Vertical timeline line */}
                  <div className="absolute left-[1.875rem] top-0 bottom-0 w-px bg-gradient-to-b from-slate-700/50 via-slate-600/30 to-transparent" />

                  <div className="flex flex-col gap-2.5">
                    {/* Status details with timeline nodes */}
                    <AnimatePresence mode="popLayout">
                      {railState.details.slice(-3).map((entry, index) => (
                        <motion.div
                          key={entry.id}
                          variants={DETAIL_VARIANTS}
                          initial="initial"
                          animate="enter"
                          exit="exit"
                          className="relative flex items-start gap-3 pl-0.5"
                        >
                          {/* Timeline node */}
                          <motion.div
                            variants={TIMELINE_NODE_VARIANTS}
                            className="relative z-10 mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center"
                          >
                            <div className="h-1.5 w-1.5 rounded-full border border-slate-500/50 bg-slate-600/80 shadow-sm" />
                          </motion.div>

                          {/* Content */}
                          <span className="min-w-0 flex-1 break-words pt-0.5 text-[11.5px] leading-relaxed text-slate-300/90">
                            {entry.text}
                          </span>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {/* World model updates with colored timeline nodes */}
                    <AnimatePresence mode="popLayout">
                      {worldModelRows.map((row) => (
                        <motion.div
                          key={row.key}
                          variants={DETAIL_VARIANTS}
                          initial="initial"
                          animate="enter"
                          exit="exit"
                          className="relative flex items-start gap-3 pl-0.5"
                        >
                          {/* Colored timeline node */}
                          <motion.div
                            variants={TIMELINE_NODE_VARIANTS}
                            className="relative z-10 mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center"
                          >
                            <div
                              className={cn(
                                "h-2 w-2 rounded-full shadow-lg",
                                row.tone === "emerald" && "border border-emerald-400/40 bg-emerald-400/90 shadow-emerald-400/50",
                                row.tone === "sky" && "border border-sky-400/40 bg-sky-400/90 shadow-sky-400/50",
                                row.tone === "amber" && "border border-amber-400/40 bg-amber-400/90 shadow-amber-400/50",
                              )}
                            />
                            {/* Glow effect */}
                            <div
                              className={cn(
                                "absolute inset-0 rounded-full blur-sm",
                                row.tone === "emerald" && "bg-emerald-400/30",
                                row.tone === "sky" && "bg-sky-400/30",
                                row.tone === "amber" && "bg-amber-400/30",
                              )}
                            />
                          </motion.div>

                          {/* Content */}
                          <span className="min-w-0 flex-1 break-words pt-0.5 text-[11.5px] leading-relaxed text-slate-200/95">
                            {row.text}
                          </span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* __CONTINUE_PART6__ */}

              {/* Upstream request loader section */}
              <AnimatePresence>
                {isUpstreamRequest && (
                  <motion.div
                    key="math-loader"
                    variants={DETAIL_VARIANTS}
                    initial="initial"
                    animate="enter"
                    exit="exit"
                    className="flex items-center gap-3 border-t border-white/[0.05] bg-gradient-to-r from-blue-500/[0.03] to-transparent px-4 py-3"
                  >
                    <MathCurveLoader
                      curve="rose3"
                      size={22}
                      particles={18}
                      trail={0.3}
                      loopMs={2400}
                      pulseMs={3200}
                      className="relative z-10"
                    />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400/80" />
                      <span className="truncate text-[11px] font-mono uppercase tracking-[0.08em] text-slate-400/95">
                        {upstreamLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-slate-500/90">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span>{upstreamHint ?? (String(upstreamElapsed) + "s")}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <>
              {/* Simple mode (non-world-model) */}
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

              {wmSummary?.goal && (
                <motion.div
                  variants={DETAIL_VARIANTS}
                  className="text-[11px] font-mono leading-tight text-[#6d5cff]/50 dark:text-[var(--accent)]/50"
                >
                  {wmSummary.goal}
                </motion.div>
              )}

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

              {/* __CONTINUE_PART7__ */}

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
