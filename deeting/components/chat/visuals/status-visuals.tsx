"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MathCurveLoader } from "@/components/chat/visuals/math-curve-loader";
import { cn } from "@/lib/utils";

function SwissGridLoader({ completed }: { completed: boolean }) {
  return (
    <div className="relative flex h-6 w-6 items-center justify-center shrink-0">
      {!completed ? (
        <MathCurveLoader
          curve="rose3"
          size={20}
          particles={18}
          trail={0.3}
          loopMs={2400}
          pulseMs={3200}
          className="relative z-10"
        />
      ) : (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]"
        />
      )}
      {!completed && (
        <motion.div
          className="absolute inset-0 rounded-full bg-[#6d5cff]/5 dark:bg-[var(--accent)]/8 blur-md"
          animate={{ scale: [0.9, 1.2, 0.9], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

export function MinimalStatusIndicator({
  label,
  status,
  completed = false,
  className,
}: {
  label: string;
  status?: string | null;
  completed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-2.5 min-h-[40px]", className)}>
      <SwissGridLoader completed={completed} />
      <div className="flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <motion.span
            className="text-[12px] font-bold uppercase tracking-[0.2em] text-[#111] dark:text-[var(--ink)] leading-none"
            animate={!completed ? { opacity: [0.7, 1, 0.7] } : { opacity: 1 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            {label || "Thinking"}
          </motion.span>
          {status && !completed && (
            <motion.span
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 0.7, x: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="text-[12px] font-mono text-[#6d5cff] dark:text-[var(--accent)] font-medium leading-none"
            >
              / {status}
            </motion.span>
          )}
        </div>
      </div>
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
