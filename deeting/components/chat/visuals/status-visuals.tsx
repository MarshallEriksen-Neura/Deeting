"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  TerminalStream – 毛玻璃终端风格的流式状态展示                        */
/* ------------------------------------------------------------------ */

export function TerminalStream({
  steps,
  activeIndex,
  label,
  detail,
}: {
  steps: Array<{ key: string; label: string }>;
  activeIndex: number;
  label: string;
  detail?: string | null;
}) {
  return (
    <div
      className={cn(
        "rounded-lg overflow-hidden",
        "border border-slate-200/60 dark:border-white/[0.08]",
        "bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl",
        "shadow-sm",
      )}
    >
      {/* ── Title bar ── */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5",
          "bg-slate-50/80 dark:bg-zinc-800/80",
          "border-b border-slate-200/50 dark:border-white/[0.06]",
        )}
      >
        <div className="flex gap-1.5">
          <span className="w-[7px] h-[7px] rounded-full bg-[#ff5f57]/70" />
          <span className="w-[7px] h-[7px] rounded-full bg-[#febc2e]/70" />
          <span className="w-[7px] h-[7px] rounded-full bg-[#28c840]/70" />
        </div>
        <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500 tracking-wide select-none">
          {label}
        </span>
      </div>

      {/* ── Terminal body ── */}
      <div className="px-3 py-2.5 font-mono text-[12px] leading-relaxed space-y-0.5">
        {steps.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          const pending = index > activeIndex;

          return (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: pending ? 0.35 : 1, x: 0 }}
              transition={{ delay: index * 0.06, duration: 0.25 }}
              className="flex items-center gap-1.5"
            >
              {/* Prefix symbol */}
              <span
                className={cn(
                  "w-3 text-center shrink-0 select-none",
                  done && "text-emerald-500",
                  active && "text-blue-500",
                  pending && "text-slate-300 dark:text-zinc-600",
                )}
              >
                {done ? "✓" : active ? "›" : "·"}
              </span>

              {/* Step label */}
              <span
                className={cn(
                  "transition-colors duration-200",
                  done && "text-slate-500 dark:text-zinc-400",
                  active && "text-slate-700 dark:text-zinc-200",
                  pending && "text-slate-300 dark:text-zinc-600",
                )}
              >
                {step.label}
              </span>

              {/* Active animated dots */}
              {active && (
                <span className="text-blue-400 dark:text-blue-500 animate-pulse tracking-[0.2em] ml-0.5">
                  ···
                </span>
              )}
            </motion.div>
          );
        })}

        {/* Detail line */}
        {detail && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="pt-1 flex items-center gap-1 text-[10px] text-slate-400 dark:text-zinc-600"
          >
            <span className="select-none">└─</span>
            <StatusPill text={detail} tone="subtle" size="xs" isLoading />
          </motion.div>
        )}

        {/* Blinking block cursor */}
        <div className="pt-0.5 h-4 flex items-center">
          <span className="inline-block w-[6px] h-[14px] bg-blue-500/60 dark:bg-blue-400/60 animate-[terminal-blink_1s_step-end_infinite]" />
        </div>
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
    <TerminalStream steps={steps} activeIndex={activeIndex} label={label} detail={detail} />
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
