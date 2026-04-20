"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, Zap } from "lucide-react";
import { StatusPill } from "@/ui/common/status-pill";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  TerminalStream – 毛玻璃终端风格的流式状态展示                        */
/* ------------------------------------------------------------------ */

export type TerminalStreamHistoryItem = {
  key: string;
  label: string;
};

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
  const showInlineChain = !showPlaceholder;
  const headerText = showPlaceholder ? resolvedDetail || label : null;

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusPill
          text={statusLabel || label}
          tone={completed ? "success" : "default"}
          size="sm"
          isLoading={!completed}
          className="w-fit"
        />
        <AnimatePresence mode="wait" initial={false}>
          {showInlineChain ? (
            <motion.div
              key="inline-chain"
              initial={{ opacity: 0, y: 4, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -4, filter: "blur(6px)" }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2"
            >
              {visibleSteps.map((step, index) => {
                const done = completed || index < safeActiveIndex;
                const active = !completed && index === safeActiveIndex;
                const pending = !done && !active;
                const isLast = index === visibleSteps.length - 1;

                return (
                  <motion.div
                    key={step.key}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: pending ? 0.42 : 1, x: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.2 }}
                    className="flex items-center gap-2"
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        done &&
                          "border-emerald-200 bg-emerald-100/90 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
                        active &&
                          "border-blue-200 bg-blue-100/90 text-blue-600 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
                        pending &&
                          "border-slate-200 bg-white/80 text-slate-300 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-600"
                      )}
                    >
                      {done ? (
                        <Check className="h-3 w-3" />
                      ) : active ? (
                        <Zap className="h-3 w-3 animate-pulse" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                    </span>

                    <span
                      className={cn(
                        "text-[14px] font-medium leading-none transition-colors duration-200",
                        done && "text-slate-700 dark:text-zinc-200",
                        active && "text-slate-900 dark:text-white",
                        pending && "text-slate-400 dark:text-zinc-500"
                      )}
                    >
                      {step.label}
                    </span>

                    {!isLast ? (
                      <span className="text-slate-300 dark:text-zinc-600">/</span>
                    ) : null}
                  </motion.div>
                );
              })}

              {detail && !completed ? (
                <motion.div
                  key={`detail-${detail}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1.5"
                >
                  <StatusPill text={detail} tone="subtle" size="xs" isLoading />
                  {detailRepeat > 1 ? (
                    <span className="rounded border border-blue-200/80 bg-blue-50/70 px-1.5 py-0.5 font-mono text-[9px] text-blue-500 dark:border-blue-900/80 dark:bg-blue-950/30 dark:text-blue-300">
                      x{detailRepeat}
                    </span>
                  ) : null}
                </motion.div>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="header-text"
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3, filter: "blur(4px)" }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="min-w-0 flex-1 truncate text-[13px] text-slate-500 dark:text-zinc-400"
            >
              {headerText}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Legacy components – kept for backward compatibility                */
/* ------------------------------------------------------------------ */

/** @deprecated Use TerminalStream instead */
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
      completed={false}
    />
  );
}

/** @deprecated Use TerminalStream instead */
export function HolographicPulse({ label, className }: { label: string, className?: string }) {
  return (
    <div
      className={cn(
        "relative w-full h-28 md:h-32 rounded-xl overflow-hidden bg-gradient-to-r from-transparent via-white/5 to-transparent dark:via-white/5",
        className
      )}
    >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-blue-500/5 animate-[shimmer_3s_infinite] bg-[length:200%_100%]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
             <div className="relative">
                <div className="absolute -inset-2 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
                <Sparkles className="w-6 h-6 text-blue-500/80 animate-bounce [animation-duration:3s]" />
             </div>
             <span className="text-xs font-mono text-slate-500 dark:text-muted-foreground/60 tracking-widest uppercase animate-pulse">
                {label}
             </span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/5 to-transparent h-[20%] w-full animate-[scan_2s_linear_infinite]" />
    </div>
  );
}

export function GhostCursor() {
  return (
    <span className="inline-flex relative items-end top-0.5 align-middle ml-1">
      <span className="block w-2.5 h-5 bg-blue-500/80 dark:bg-blue-400/80 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
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
    // Adjusted timing for a more deliberate "thinking" feel
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
