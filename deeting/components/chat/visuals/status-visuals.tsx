"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

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
  activity,
  history = [],
  compact = false,
  placeholder,
  showPlaceholder = false,
}: {
  steps: Array<{ key: string; label: string }>;
  activeIndex: number;
  label: string;
  statusLabel?: string;
  detail?: string | null;
  detailRepeat?: number;
  activity?: string | null;
  history?: TerminalStreamHistoryItem[];
  compact?: boolean;
  placeholder?: string | null;
  showPlaceholder?: boolean;
}) {
  const stepCount = Math.max(steps.length, 1);
  const safeActiveIndex = Math.min(Math.max(activeIndex, 0), stepCount - 1);
  const visibleStepUpperBound = Math.min(safeActiveIndex + 1, stepCount - 1);
  const visibleSteps = useMemo(
    () => steps.filter((_, index) => index <= visibleStepUpperBound),
    [steps, visibleStepUpperBound]
  );
  const tailHistory = useMemo(() => history.slice(-3), [history]);

  return (
    <div className="space-y-3">
      <StatusPill
        text={statusLabel || label}
        tone="default"
        size="sm"
        isLoading
        className="w-fit"
      />

      <div
        className={cn(
          "rounded-2xl border px-4 py-3 shadow-sm transition-all",
          "border-slate-200/80 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/55",
          compact ? "space-y-2.5" : "space-y-3"
        )}
      >
        {showPlaceholder ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-zinc-500" />
              </div>
              <div className="min-w-0 text-sm text-slate-600 dark:text-zinc-300">
                {placeholder || label}
              </div>
            </div>
            <div className="flex items-center gap-2 pl-7">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-2.5 w-2.5 rounded-full bg-blue-400/70 animate-pulse"
                  style={{ animationDelay: `${dot * 160}ms` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className={cn("space-y-2 font-mono", compact && "text-[11px]")}>
              {visibleSteps.map((step, index) => {
                const done = index < safeActiveIndex;
                const active = index === safeActiveIndex;
                const pending = index > safeActiveIndex;

                return (
                  <motion.div
                    key={step.key}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: pending ? 0.45 : 1, x: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.2 }}
                    className="flex items-start gap-3"
                  >
                    <div className="flex w-4 shrink-0 justify-center pt-0.5">
                      <span
                        className={cn(
                          "w-3 text-center select-none text-sm leading-none",
                          done && "text-emerald-500",
                          active && "text-blue-500",
                          pending && "text-slate-300 dark:text-zinc-600",
                        )}
                      >
                        {done ? "v" : active ? ">" : "."}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-sm leading-6 transition-colors duration-200",
                          done && "text-slate-500 dark:text-zinc-400",
                          active && "text-slate-800 dark:text-zinc-100",
                          pending && "text-slate-300 dark:text-zinc-600",
                        )}
                      >
                        {step.label}
                        {active ? (
                          <span className="ml-1.5 text-blue-400 dark:text-blue-500 animate-pulse tracking-[0.2em]">
                            ...
                          </span>
                        ) : null}
                      </div>

                      {active && detail ? (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="mt-1 flex flex-wrap items-center gap-1.5"
                        >
                          <StatusPill text={detail} tone="subtle" size="xs" isLoading />
                          {detailRepeat > 1 ? (
                            <span className="rounded border border-blue-200/80 bg-blue-50/70 px-1.5 py-0.5 font-mono text-[9px] text-blue-500 dark:border-blue-900/80 dark:bg-blue-950/30 dark:text-blue-300">
                              x{detailRepeat}
                            </span>
                          ) : null}
                        </motion.div>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {activity ? (
              <div className="pl-7 text-xs text-slate-500 dark:text-zinc-400">
                {activity}
              </div>
            ) : null}

            {tailHistory.length > 1 ? (
              <div className="flex flex-wrap gap-1 pl-7">
                {tailHistory.map((item, idx) => (
                  <span
                    key={`${item.key}-${idx}`}
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 text-[9px] font-mono",
                      idx === tailHistory.length - 1
                        ? "border-blue-200/80 bg-blue-50/80 text-blue-500 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                        : "border-slate-200/80 bg-white/70 text-slate-400 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500",
                    )}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )}
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
