"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { StatusPill } from "@/ui/common/status-pill";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

export type TerminalStreamHistoryItem = {
  key: string;
  label: string;
};

const ORBIT_POINT_POSITIONS = [
  { x: 42, y: 10 },
  { x: 74, y: 42 },
  { x: 42, y: 74 },
  { x: 10, y: 42 },
] as const;

const STAGE_SUBTITLE_BY_KEY: Record<string, string> = {
  listen: "\u6b63\u5728\u8fa8\u8ba4\u95ee\u9898\u7684\u8fb9\u754c",
  remember: "\u6b63\u5728\u56de\u6536\u76f8\u5173\u4e0a\u4e0b\u6587",
  evolve: "\u6b63\u5728\u628a\u7ebf\u7d22\u6298\u6210\u7ed3\u6784",
  render: "\u6b63\u5728\u6253\u78e8\u6700\u540e\u8868\u8fbe",
};

const STAGE_BADGE_BY_KEY: Record<string, string> = {
  listen: "\u611f\u77e5\u4e2d",
  remember: "\u56de\u6536\u4e2d",
  evolve: "\u6210\u5f62\u4e2d",
  render: "\u8f93\u51fa\u4e2d",
};

const STAGE_MOTION_BY_KEY: Record<
  string,
  { orbit: number; pulse: number; tilt: number; glow: number }
> = {
  listen: { orbit: 10, pulse: 2.8, tilt: -6, glow: 0.1 },
  remember: { orbit: 7.4, pulse: 2.2, tilt: 12, glow: 0.14 },
  evolve: { orbit: 5.8, pulse: 1.7, tilt: -14, glow: 0.2 },
  render: { orbit: 4.6, pulse: 1.35, tilt: 4, glow: 0.26 },
};
function buildOrbitState(activeIndex: number, completed: boolean, count: number) {
  return Array.from({ length: count }, (_, index) => {
    if (completed) {
      return { opacity: 1, scale: 1.06, active: true, done: true };
    }

    if (index < activeIndex) {
      return { opacity: 0.78, scale: 0.96, active: false, done: true };
    }

    if (index === activeIndex) {
      return { opacity: 1, scale: 1.18, active: true, done: false };
    }

    return { opacity: 0.28, scale: 0.82, active: false, done: false };
  });
}

function ThinkingConstellation({
  steps,
  activeIndex,
  completed,
}: {
  steps: Array<{ key: string; label: string }>;
  activeIndex: number;
  completed: boolean;
}) {
  const orbitStates = buildOrbitState(activeIndex, completed, Math.min(steps.length, 4));
  const safeStage = completed
    ? steps[steps.length - 1]?.key ?? "render"
    : steps[Math.min(activeIndex, steps.length - 1)]?.key ?? "listen";
  const stageStrength = completed ? 1 : Math.max(0.4, (activeIndex + 1) / Math.max(steps.length, 1));
  const stageMotion = STAGE_MOTION_BY_KEY[safeStage] ?? STAGE_MOTION_BY_KEY.listen;

  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <motion.div
        className="absolute inset-2 rounded-full bg-[radial-gradient(circle,_rgba(61,212,167,0.24),_rgba(61,212,167,0.03)_58%,_transparent_76%)]"
        animate={
          completed
            ? { scale: 1, opacity: 0.6 }
            : { scale: [0.9, 1.05 + stageMotion.glow, 0.95], opacity: [0.34, 0.64 + stageMotion.glow, 0.4] }
        }
        transition={{ duration: stageMotion.pulse, repeat: completed ? 0 : Infinity, ease: "easeInOut" }}
      />

      <motion.svg
        viewBox="0 0 84 84"
        className="relative z-10 h-16 w-16 overflow-visible text-[var(--accent-ink)]"
        aria-hidden="true"
      >
        <motion.circle
          cx="42"
          cy="42"
          r="29"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeOpacity="0.18"
          animate={completed ? { rotate: 0 } : { rotate: 360 }}
          transition={{ duration: stageMotion.orbit, ease: "linear", repeat: completed ? 0 : Infinity }}
          style={{ transformOrigin: "42px 42px" }}
        />

        <motion.path
          d="M42 18 C55 22, 62 29, 66 42 C62 55, 55 62, 42 66 C29 62, 22 55, 18 42 C22 29, 29 22, 42 18Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity="0.26"
          animate={
            completed
              ? { pathLength: 1, opacity: 0.32 }
              : { pathLength: [0.18, 1, 0.38], opacity: [0.18, 0.34 + stageMotion.glow, 0.2] }
          }
          transition={{ duration: Math.max(1.8, stageMotion.pulse + 0.4), repeat: completed ? 0 : Infinity, ease: "easeInOut" }}
        />

        {ORBIT_POINT_POSITIONS.map((point, index) => {
          const state = orbitStates[index] ?? { opacity: 0.3, scale: 0.82, active: false, done: false };
          return (
            <motion.g key={`${point.x}-${point.y}`} style={{ transformOrigin: `${point.x}px ${point.y}px` }}>
              <motion.circle
                cx={point.x}
                cy={point.y}
                r="4.5"
                fill="currentColor"
                animate={
                  state.active && !completed
                    ? {
                        opacity: [0.68, 1, 0.78],
                        scale: [state.scale * 0.94, state.scale, state.scale * 0.96],
                      }
                    : { opacity: state.opacity, scale: state.scale }
                }
                transition={{ duration: 1.25, repeat: state.active && !completed ? Infinity : 0, ease: "easeInOut" }}
              />
              {(state.done || state.active) && index > 0 ? (
                <motion.path
                  d={`M${ORBIT_POINT_POSITIONS[index - 1].x} ${ORBIT_POINT_POSITIONS[index - 1].y} Q42 42 ${point.x} ${point.y}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeOpacity={state.active ? 0.5 : 0.24}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: state.active ? 0.6 : 0.26 }}
                  transition={{ duration: 0.42, ease: "easeOut" }}
                />
              ) : null}
            </motion.g>
          );
        })}

        <motion.g style={{ transformOrigin: "42px 42px" }}>
          <motion.path
            d="M42 24 L46.5 37.5 L60 42 L46.5 46.5 L42 60 L37.5 46.5 L24 42 L37.5 37.5 Z"
            fill="currentColor"
            fillOpacity={completed ? 0.22 : 0.14 + stageStrength * 0.08}
            stroke="currentColor"
            strokeWidth="1.1"
            animate={
              completed
                ? { scale: 1, rotate: 0, opacity: 1 }
                : { scale: [0.94, 1.04 + stageMotion.glow, 0.97], rotate: [0, stageMotion.tilt, stageMotion.tilt * -0.4, 0], opacity: [0.84, 1, 0.9] }
            }
            transition={{ duration: Math.max(1.45, stageMotion.pulse), repeat: completed ? 0 : Infinity, ease: "easeInOut" }}
          />

          <motion.circle
            cx="42"
            cy="42"
            r="5"
            fill="currentColor"
            animate={
              completed
                ? { scale: 1, filter: "blur(0px)" }
                : { scale: [0.88, 1.1 + stageMotion.glow, 0.92], filter: ["blur(0px)", "blur(1.2px)", "blur(0px)"] }
            }
            transition={{ duration: Math.max(1.1, stageMotion.pulse - 0.3), repeat: completed ? 0 : Infinity, ease: "easeInOut" }}
          />
        </motion.g>

        {completed ? (
          <motion.g initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.26, ease: "easeOut" }}>
            <circle cx="66" cy="18" r="8" fill="rgba(61,212,167,0.16)" stroke="currentColor" strokeOpacity="0.36" />
            <path
              d="M62.8 18.2 L65.2 20.6 L69.6 15.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
        ) : null}
      </motion.svg>

      <motion.div
        className="absolute inset-0 rounded-full border border-[var(--accent-ink)]/12"
        animate={completed ? { opacity: 0.18, scale: 1 } : { opacity: [0.1, 0.24 + stageMotion.glow, 0.12], scale: [0.94, 1.02 + stageMotion.glow * 0.6, 0.96] }}
        transition={{ duration: stageMotion.pulse + 0.6, repeat: completed ? 0 : Infinity, ease: "easeInOut" }}
      />

      <span className="sr-only">{safeStage}</span>
    </div>
  );
}

export function TerminalStream({
  steps,
  activeIndex,
  label,
  statusLabel,
  detail,
  detailRepeat = 1,
  compact = false,
  placeholder,
  showPlaceholder = false,
  completed = false,
}: {
  steps: Array<{ key: string; label: string }>;
  activeIndex: number;
  label: string;
  statusLabel?: string;
  detail?: string | null;
  detailRepeat?: number;
  compact?: boolean;
  placeholder?: string | null;
  showPlaceholder?: boolean;
  completed?: boolean;
}) {
  const stepCount = Math.max(steps.length, 1);
  const safeActiveIndex = completed
    ? stepCount - 1
    : Math.min(Math.max(activeIndex, 0), stepCount - 1);
  const visibleSteps = useMemo(() => steps, [steps]);
  const resolvedDetail = showPlaceholder ? placeholder || detail || label : detail;
  const currentStep = visibleSteps[safeActiveIndex] ?? visibleSteps[0];
  const headline = completed
    ? statusLabel || label
    : currentStep?.label || statusLabel || label;
  const subtitle = completed
    ? "\u7b54\u6848\u5df2\u7ecf\u7a33\u5b9a\u6210\u5f62"
    : STAGE_SUBTITLE_BY_KEY[currentStep?.key ?? "listen"] ?? statusLabel ?? label;
  const activityBadge = completed
    ? "\u5df2\u6536\u675f"
    : STAGE_BADGE_BY_KEY[currentStep?.key ?? "listen"] ?? "\u601d\u8003\u4e2d";
  const footerText = resolvedDetail || subtitle;

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <div className="relative overflow-hidden rounded-[24px] border border-[var(--hairline)] bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(240,252,248,0.94))] p-3 shadow-[0_20px_48px_-28px_rgba(16,24,40,0.22)] dark:bg-[linear-gradient(135deg,rgba(22,28,28,0.88),rgba(11,18,18,0.96))]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(61,212,167,0.12),transparent_42%)]" />
        <div className="relative flex min-w-0 items-center gap-3">
          <ThinkingConstellation
            steps={visibleSteps}
            activeIndex={safeActiveIndex}
            completed={completed}
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                text={statusLabel || label}
                tone={completed ? "success" : "default"}
                size="sm"
                isLoading={!completed}
                className="w-fit"
              />
              {!completed ? (
                <div className="flex items-center gap-1 rounded-full border border-[var(--accent-ink)]/12 bg-[var(--accent-ink)]/6 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent-ink)]/80">
                  <Sparkles className="size-3" />
                  {activityBadge}
                </div>
              ) : (
                <div className="flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.24em] text-emerald-600 dark:text-emerald-300">
                  <Check className="size-3" />
                  {activityBadge}
                </div>
              )}
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${currentStep?.key ?? "stage"}-${completed ? "done" : "live"}`}
                initial={{ opacity: 0, y: 5, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4, filter: "blur(6px)" }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="mt-2 min-w-0"
              >
                <div className="truncate text-[15px] font-semibold text-[var(--ink)]">
                  {headline}
                </div>
                <div className="mt-1 truncate text-[12px] text-[var(--ink-3)]">
                  {footerText}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {!showPlaceholder && detail && !completed ? (
            <motion.div
              key={`detail-${detail}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className="hidden shrink-0 items-center gap-1.5 md:flex"
            >
              <StatusPill text={detail} tone="subtle" size="xs" isLoading />
              {detailRepeat > 1 ? (
                <span className="rounded border border-[var(--accent-ink)]/18 bg-[var(--accent-ink)]/8 px-1.5 py-0.5 font-mono text-[9px] text-[var(--accent-ink)]/80">
                  x{detailRepeat}
                </span>
              ) : null}
            </motion.div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function StatusStream({
  steps,
  activeIndex,
  compact,
  label,
  detail,
}: {
  steps: Array<{ key: string; label: string }>;
  activeIndex: number;
  compact?: boolean;
  label: string;
  detail?: string | null;
}) {
  return (
    <TerminalStream
      steps={steps}
      activeIndex={activeIndex}
      label={label}
      detail={detail}
      compact={compact}
      completed={false}
    />
  );
}

export function HolographicPulse({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn(
        "relative h-28 w-full overflow-hidden rounded-xl bg-gradient-to-r from-transparent via-white/5 to-transparent dark:via-white/5 md:h-32",
        className,
      )}
    >
      <div className="absolute inset-0 animate-[shimmer_3s_infinite] bg-[length:200%_100%] bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-blue-500/5" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="relative">
          <div className="absolute -inset-2 rounded-full bg-blue-500/20 blur-xl animate-pulse" />
          <Sparkles className="h-6 w-6 animate-bounce text-blue-500/80 [animation-duration:3s]" />
        </div>
        <span className="animate-pulse text-xs font-mono uppercase tracking-widest text-slate-500 dark:text-muted-foreground/60">
          {label}
        </span>
      </div>
      <div className="absolute inset-0 h-[20%] w-full animate-[scan_2s_linear_infinite] bg-gradient-to-b from-transparent via-blue-500/5 to-transparent" />
    </div>
  );
}

export function GhostCursor() {
  return (
    <span className="relative top-0.5 ml-1 inline-flex items-end align-middle">
      <span className="block h-5 w-2.5 animate-pulse bg-blue-500/80 shadow-[0_0_8px_rgba(59,130,246,0.5)] dark:bg-blue-400/80" />
    </span>
  );
}

export function useStepProgress(isActive: boolean, stepCount: number) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isActive || stepCount <= 1) {
      const t = setTimeout(() => setIndex(0), 0);
      return () => clearTimeout(t);
    }

    const t0 = setTimeout(() => setIndex(0), 0);
    let current = 0;
    const delays = [800, 1500, 2000, 1000];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        current = Math.min(current + 1, stepCount - 1);
        setIndex(current);
        if (current < stepCount - 1) {
          schedule(delays[current] ?? 1200);
        }
      }, delay);
    };

    schedule(delays[0] ?? 900);

    return () => {
      clearTimeout(t0);
      if (timer) clearTimeout(timer);
    };
  }, [isActive, stepCount]);

  return index;
}

export function resolveStageIndex(stage: string, steps: Array<{ key: string }>) {
  const idx = steps.findIndex((step) => step.key === stage);
  return idx >= 0 ? idx : 0;
}