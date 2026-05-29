"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/hooks/use-i18n";
import { resolveStatusDetail } from "@/lib/chat/status-detail";
import { resolveToolStatusDetail } from "@/lib/chat/tool-ux";

import {
  ISLAND_STATUS_STEPS,
  type IslandStatusStep,
} from "./island-runtime-status";

type IslandStatusTimelineProps = {
  statusLabel: string;
  statusStage: string | null;
  statusCode: string | null;
  statusMeta: Record<string, unknown> | null;
  isBusy: boolean;
};

function toStepLabelKey(step: IslandStatusStep) {
  return `status.flow.${step}` as const;
}

export function IslandStatusTimeline({
  statusLabel,
  statusStage,
  statusCode,
  statusMeta,
  isBusy,
}: IslandStatusTimelineProps) {
  const t = useI18n("chat");

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

