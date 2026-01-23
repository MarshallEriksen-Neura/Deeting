"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

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
  const remembering = steps[activeIndex]?.key === "remember";

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200/70 dark:border-white/10 bg-white/85 dark:bg-white/5",
        "px-3 py-2 backdrop-blur-sm transition-all duration-300",
        compact ? "text-[10px]" : "text-xs",
        remembering && "bg-blue-50/60 dark:bg-blue-500/10 border-blue-200/50 dark:border-blue-500/30"
      )}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-600 dark:text-muted-foreground/80 font-medium">
        <span>{label}</span>
      </div>
      <div className={cn("mt-2 flex flex-col", compact ? "gap-1" : "gap-1.5")}>
        {steps.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={step.key} className="flex items-center gap-2 text-slate-600 dark:text-muted-foreground transition-colors duration-300">
              {done ? (
                <div className="w-3 h-3 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-emerald-500" />
                </div>
              ) : active ? (
                <div className="relative flex h-3 w-3 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500/20 animate-ping"></span>
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                </div>
              ) : (
                <div className="w-3 h-3 flex items-center justify-center">
                     <span className="h-1 w-1 rounded-full bg-slate-400/40 dark:bg-muted-foreground/30" />
                </div>
              )}
              <span className={cn(
                  "transition-colors duration-300",
                  active ? "text-foreground font-medium" : "text-slate-500 dark:text-muted-foreground/70",
                  done && "text-slate-600 dark:text-muted-foreground/80"
              )}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      {detail ? (
        <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2"
        >
          <StatusPill text={detail} tone="subtle" isLoading={activeIndex === 2} />
        </motion.div>
      ) : null}
    </div>
  );
}

export function HolographicPulse({ label, className }: { label: string, className?: string }) {
  return (
    <div className={cn("relative w-full h-24 rounded-xl overflow-hidden bg-gradient-to-r from-transparent via-white/5 to-transparent dark:via-white/5", className)}>
        {/* Animated Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-blue-500/5 animate-[shimmer_3s_infinite] bg-[length:200%_100%]" />
        
        {/* Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
             <div className="relative">
                <div className="absolute -inset-2 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
                <Sparkles className="w-5 h-5 text-blue-500/80 animate-bounce [animation-duration:3s]" />
             </div>
             <span className="text-xs font-mono text-slate-500 dark:text-muted-foreground/60 tracking-widest uppercase animate-pulse">
                {label}
             </span>
        </div>

        {/* Scanline Effect */}
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
