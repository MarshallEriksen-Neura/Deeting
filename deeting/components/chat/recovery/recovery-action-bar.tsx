"use client"

import { AlertTriangle, Play, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/hooks/use-i18n"
import type { ComposerRecoveryPrompt } from "@/lib/chat/recovery"

function descriptionKeyForStage(stage: string | null) {
  switch (stage) {
    case "tool_running_interrupted":
      return "controls.recovery.description.toolRunningInterrupted"
    case "delegated_workflow_running":
      return "controls.recovery.description.delegatedWorkflowRunning"
    default:
      return "controls.recovery.description.fallback"
  }
}

export function RecoveryActionBar({
  recovery,
  disabled = false,
  onContinue,
  onRetry,
  onAbandon,
}: {
  recovery: ComposerRecoveryPrompt | null
  disabled?: boolean
  onContinue: () => void
  onRetry: () => void
  onAbandon: () => void
}) {
  const t = useI18n("chat")

  if (!recovery) {
    return null
  }

  const canContinue = recovery.availableActions.includes("continue")
  const canRetry = recovery.availableActions.includes("retry")
  const canAbandon = recovery.availableActions.includes("abandon")

  return (
    <div className="pointer-events-auto w-full max-w-[min(30rem,calc(100vw-2.5rem))] rounded-2xl border border-sky-200/80 bg-white/95 p-3 text-slate-950 shadow-[0_20px_45px_-26px_rgba(14,116,144,0.45)] ring-1 ring-white/70 backdrop-blur-2xl dark:border-sky-400/20 dark:bg-[#0c1418]/95 dark:text-sky-50 dark:ring-white/5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300">
          <AlertTriangle className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[13px] font-semibold leading-none">
                {t("controls.recovery.title")}
              </p>
              {recovery.executionId ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-400/12 dark:text-sky-200">
                  {recovery.executionId}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] leading-4 text-slate-700/80 dark:text-sky-100/70">
              {t(descriptionKeyForStage(recovery.stage))}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-full border border-sky-300/60 bg-sky-500/8 px-2.5 text-[11px] font-medium text-sky-900 hover:bg-sky-500/14 hover:text-sky-950 dark:border-sky-400/20 dark:bg-sky-400/8 dark:text-sky-100 dark:hover:bg-sky-400/14 dark:hover:text-sky-50"
              onClick={onContinue}
              disabled={disabled || !canContinue}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {t("controls.recovery.actions.continue")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-full border border-slate-300/60 bg-slate-500/8 px-2.5 text-[11px] font-medium text-slate-900 hover:bg-slate-500/14 hover:text-slate-950 dark:border-white/15 dark:bg-white/8 dark:text-white dark:hover:bg-white/14"
              onClick={onRetry}
              disabled={disabled || !canRetry}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {t("controls.recovery.actions.retry")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-full border border-rose-300/60 bg-rose-500/8 px-2.5 text-[11px] font-medium text-rose-900 hover:bg-rose-500/14 hover:text-rose-950 dark:border-rose-400/20 dark:bg-rose-400/8 dark:text-rose-100 dark:hover:bg-rose-400/14 dark:hover:text-rose-50"
              onClick={onAbandon}
              disabled={disabled || !canAbandon}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              {t("controls.recovery.actions.abandon")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
