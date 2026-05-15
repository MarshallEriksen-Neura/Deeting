"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, LoaderCircle, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/hooks/use-i18n";
import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { resolveToolStatusDetail } from "@/lib/chat/tool-ux";
import { cn } from "@/lib/utils";

import {
  ISLAND_STATUS_STEPS,
  resolveVisibleIslandStatusSteps,
  type IslandStatusStep,
} from "./island-runtime-status";

type IslandStatusTimelineProps = {
  statusLabel: string;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  stageHistory: IslandStatusStep[];
  isBusy: boolean;
  compact?: boolean;
};

function toStepLabelKey(step: IslandStatusStep) {
  return `status.flow.${step}` as const;
}

export function IslandStatusTimeline({
  statusLabel,
  statusStage,
  statusCode,
  statusMeta,
  stageHistory,
  isBusy,
  compact = false,
}: IslandStatusTimelineProps) {
  const t = useI18n("island");

  const steps = useMemo(
    () =>
      ISLAND_STATUS_STEPS.map((step) => ({
        key: step,
        label: t(toStepLabelKey(step)),
      })),
    [t],
  );

  const detail =
    resolveToolStatusDetail(statusCode, statusMeta, t) ??
    resolveStatusDetail(t, statusCode, statusMeta) ??
    statusLabel;
  const activeStage = steps.some((step) => step.key === statusStage)
    ? (statusStage as IslandStatusStep)
    : null;
  const visibleStepKeys = useMemo(
    () => resolveVisibleIslandStatusSteps(stageHistory, activeStage),
    [activeStage, stageHistory],
  );
  const visibleSteps = useMemo(
    () => steps.filter((step) => visibleStepKeys.includes(step.key)),
    [steps, visibleStepKeys],
  );
  const completedSet = new Set(stageHistory);

  if (compact) {
    const compactLabel =
      (activeStage && steps.find((step) => step.key === activeStage)?.label) ??
      statusLabel;

    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isBusy ? (
            <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-island-gold" />
          ) : (
            <Sparkles className="h-3 w-3 shrink-0 text-island-gold/75" />
          )}
          <span className="truncate text-[11px] font-semibold text-foreground/78">
            {compactLabel}
          </span>
        </div>
        <p className="truncate text-[11px] text-foreground/48">{detail}</p>
      </div>
    );
  }

  if (visibleSteps.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[18px] border border-island-shell-border/60 bg-background/45 px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-island-gold/80" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
          {t("liveProgress")}
        </span>
      </div>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {visibleSteps.map((step) => {
            const isCurrent = activeStage === step.key;
            const isCompleted = completedSet.has(step.key) && !isCurrent;

            return (
              <motion.div
                key={step.key}
                layout
                initial={{ opacity: 0, y: 8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex items-start gap-2.5 overflow-hidden"
              >
                <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-island-shell-border/70 bg-background/70">
                  {isCurrent ? (
                    <LoaderCircle className="h-2.5 w-2.5 animate-spin text-island-gold" />
                  ) : isCompleted ? (
                    <CheckCheck className="h-2.5 w-2.5 text-emerald-400" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-[12px] leading-4",
                      isCurrent
                        ? "font-semibold text-foreground"
                        : isCompleted
                          ? "text-foreground/72"
                          : "text-foreground/38",
                    )}
                  >
                    {step.label}
                  </div>
                  {isCurrent ? (
                    <p className="mt-0.5 text-[11px] leading-4 text-foreground/55">
                      {detail}
                    </p>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

