"use client";

import { useState, useEffect } from "react";
import { CheckCheck, ChevronDown, SquareTerminal } from "lucide-react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";

import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import { useTerminalPanelStore } from "@/store/terminal-panel-store";
import { useWorkflowStore } from "@/store/workflow-store";

import { resolveIslandStatusLabelKey } from "./island-labels";
import { IslandSeedLogo } from "./island-seed-logo";
import { IslandStatusTimeline } from "./island-status-timeline";
import { useIslandContext } from "./island-context";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 text-island-gold">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block w-1 h-1 rounded-full bg-current"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

function useWorkflowProgress() {
  const run = useWorkflowStore((s) => s.run);
  const steps = useWorkflowStore((s) => s.steps);

  if (!run || (run.status !== "running" && run.status !== "waiting_approval")) {
    return null;
  }

  const sorted = [...steps].sort((a, b) => a.phase_index - b.phase_index);
  const completedCount = sorted.filter((s) => s.status === "succeeded").length;
  const totalPhases = run.snapshot_json?.phases?.length ?? sorted.length;
  const runningStep = sorted.find((s) => s.status === "running");

  return {
    runId: run.id,
    completedCount,
    totalPhases,
    currentStepTitle: runningStep?.title ?? null,
  };
}

function scrollToWorkflowLiveCard(runId: string) {
  const messageEl = document.querySelector(`[data-message-id="workflow-receipt-${runId}"]`);
  if (messageEl) {
    messageEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function IslandCollapsedView({
  dragRegion = false,
  compact = false,
  showTerminalToggle = false,
}: {
  dragRegion?: boolean;
  compact?: boolean;
  showTerminalToggle?: boolean;
} = {}) {
  const {
    statusLabel,
    summaryText,
    lastReplyAt,
    isBusy,
    statusStage,
    statusCode,
    statusMeta,
    collapsedHighlight,
    expand,
  } = useIslandContext();
  const t = useI18n("island");
  const workflowProgress = useWorkflowProgress();
  const isTerminalOpen = useTerminalPanelStore((s) => s.isOpen);
  const toggleTerminal = useTerminalPanelStore((s) => s.toggle);

  const isActive =
    statusLabel === "Working..." || statusLabel === "Pending approval";

  const locale = useLocale();
  const dateFnsLocale = locale === "zh-CN" ? zhCN : enUS;
  const relativeTime = lastReplyAt
    ? formatDistanceToNow(lastReplyAt, {
        addSuffix: true,
        locale: dateFnsLocale,
      })
    : null;
  const effectiveStatusLabel = collapsedHighlight?.labelKey
    ? t(collapsedHighlight.labelKey)
    : resolveIslandStatusLabelKey(statusLabel)
      ? t(resolveIslandStatusLabelKey(statusLabel) as string)
      : statusLabel;
  const effectiveSummary = collapsedHighlight?.detailKey
    ? t(collapsedHighlight.detailKey)
    : summaryText;
  const showBusyTrack = isBusy && !collapsedHighlight;

  // Re-render every 30s to keep relative time fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastReplyAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [lastReplyAt]);

  return (
    <motion.div
      data-tauri-drag-region={dragRegion ? "true" : undefined}
      onClick={expand}
      className={cn(
        "flex items-center cursor-pointer select-none rounded-[999px]",
        "border border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(245,239,230,0.62))]",
        "shadow-[0_16px_36px_-26px_rgba(0,0,0,0.34)]",
        "dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(46,38,28,0.96),rgba(23,20,18,0.94))]",
        compact ? "h-full gap-2 px-2.5 py-1.5" : "gap-2.5 px-3 py-2",
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/58 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:bg-white/6">
        <IslandSeedLogo size={18} isActive={isActive} />
      </div>

      <div
        className={cn(
          "flex items-center rounded-full bg-white/46 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] dark:bg-white/6",
          compact ? "gap-1" : "gap-1.5",
        )}
      >
        {collapsedHighlight?.tone === "success" ? (
          <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <div className="relative flex h-2 w-2">
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75",
                isActive ? "animate-ping bg-amber-400" : "bg-emerald-400",
              )}
            />
            <span
              className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                isActive ? "bg-amber-400" : "bg-emerald-400",
              )}
            />
          </div>
        )}
        <span
          className={cn(
            "text-[11px] font-medium",
            collapsedHighlight?.tone === "success"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-foreground/70",
          )}
        >
          {effectiveStatusLabel}
        </span>
      </div>

      {showBusyTrack ? (
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/36 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.52)] dark:bg-white/5 cursor-pointer"
          onClick={(e) => {
            if (workflowProgress) {
              e.stopPropagation();
              scrollToWorkflowLiveCard(workflowProgress.runId);
            }
          }}
        >
          <TypingDots />
          {workflowProgress ? (
            <span className="text-[11px] font-medium text-foreground/60 truncate">
              {workflowProgress.currentStepTitle
                ? `${workflowProgress.completedCount}/${workflowProgress.totalPhases} · ${workflowProgress.currentStepTitle}`
                : `步骤 ${workflowProgress.completedCount}/${workflowProgress.totalPhases}`}
            </span>
          ) : (
            <IslandStatusTimeline
              statusLabel={statusLabel}
              statusStage={statusStage}
              statusCode={statusCode}
              statusMeta={statusMeta}
              isBusy={isBusy}
            />
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/36 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.52)] dark:bg-white/5">
          <span
            className={cn(
              "text-[12px] font-medium text-foreground/60 truncate",
              compact ? "max-w-[112px]" : "max-w-[140px]",
            )}
          >
            {effectiveSummary}
          </span>
          {relativeTime && !collapsedHighlight && (
            <span className="text-[10px] text-foreground/35 shrink-0 tabular-nums">
              {relativeTime}
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {showTerminalToggle ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleTerminal();
            }}
            aria-label={isTerminalOpen ? "Hide terminal" : "Show terminal"}
            title={isTerminalOpen ? "Hide terminal" : "Show terminal"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-colors",
              isTerminalOpen
                ? "bg-island-gold/22 text-island-gold dark:bg-island-gold/26"
                : "bg-white/52 text-foreground/55 hover:bg-island-gold/14 hover:text-island-gold dark:bg-white/6",
            )}
          >
            <SquareTerminal className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/52 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:bg-white/6">
          <ChevronDown className="h-3.5 w-3.5 text-island-gold transition-transform" />
        </div>
      </div>
    </motion.div>
  );
}

