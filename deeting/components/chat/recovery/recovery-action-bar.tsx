"use client"

import { AlertCircle, AlertTriangle, Clock3, Play, RotateCcw, ShieldCheck, X } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
import { useI18n } from "@/hooks/use-i18n"
import type { ComposerRecoveryPrompt } from "@/lib/chat/recovery"
import { cn } from "@/lib/utils"

type RecoveryTone = "active" | "warning" | "danger" | "neutral"

function descriptionKeyForStage(stage: string | null) {
  switch (stage) {
    case "waiting_approval":
      return "controls.recovery.description.waitingApproval"
    case "resuming_after_approval":
      return "controls.recovery.description.resumingAfterApproval"
    case "resume_failed":
      return "controls.recovery.description.resumeFailed"
    case "tool_running_interrupted":
      return "controls.recovery.description.toolRunningInterrupted"
    case "delegated_workflow_running":
      return "controls.recovery.description.delegatedWorkflowRunning"
    default:
      return "controls.recovery.description.fallback"
  }
}

function stageLabelKeyForStage(stage: string | null) {
  switch (stage) {
    case "waiting_approval":
      return "controls.recovery.stage.waitingApproval"
    case "resuming_after_approval":
      return "controls.recovery.stage.resumingAfterApproval"
    case "resume_failed":
      return "controls.recovery.stage.resumeFailed"
    case "tool_running_interrupted":
      return "controls.recovery.stage.toolRunningInterrupted"
    case "delegated_workflow_running":
      return "controls.recovery.stage.delegatedWorkflowRunning"
    default:
      return "controls.recovery.stage.unknown"
  }
}

function nextStepKeyForStage(stage: string | null) {
  switch (stage) {
    case "waiting_approval":
      return "controls.recovery.nextStep.waitingApproval"
    case "resuming_after_approval":
      return "controls.recovery.nextStep.resumingAfterApproval"
    case "resume_failed":
      return "controls.recovery.nextStep.resumeFailed"
    case "tool_running_interrupted":
      return "controls.recovery.nextStep.toolRunningInterrupted"
    case "delegated_workflow_running":
      return "controls.recovery.nextStep.delegatedWorkflowRunning"
    default:
      return "controls.recovery.nextStep.fallback"
  }
}

function toneForStage(stage: string | null): RecoveryTone {
  switch (stage) {
    case "resuming_after_approval":
      return "active"
    case "resume_failed":
      return "danger"
    case "waiting_approval":
    case "tool_running_interrupted":
      return "warning"
    default:
      return "neutral"
  }
}

function renderToneIcon(tone: RecoveryTone) {
  if (tone === "active") return <ShieldCheck className="h-4.5 w-4.5" />
  if (tone === "danger") return <AlertCircle className="h-4.5 w-4.5" />
  if (tone === "warning") return <AlertTriangle className="h-4.5 w-4.5" />
  return <Clock3 className="h-4.5 w-4.5" />
}

const toneClasses: Record<RecoveryTone, {
  shell: string
  icon: string
  pill: string
  next: string
}> = {
  active: {
    shell: "border-emerald-200/80 shadow-[0_20px_45px_-26px_rgba(5,150,105,0.45)] dark:border-emerald-400/20",
    icon: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    pill: "border-emerald-300/50 bg-emerald-500/8 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-400/12 dark:text-emerald-100",
    next: "border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100",
  },
  warning: {
    shell: "border-amber-200/80 shadow-[0_20px_45px_-26px_rgba(180,83,9,0.45)] dark:border-amber-400/20",
    icon: "bg-amber-500/12 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    pill: "border-amber-300/50 bg-amber-500/8 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/12 dark:text-amber-100",
    next: "border-amber-200/70 bg-amber-50/85 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100",
  },
  danger: {
    shell: "border-rose-200/80 shadow-[0_20px_45px_-26px_rgba(190,18,60,0.45)] dark:border-rose-400/20",
    icon: "bg-rose-500/12 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
    pill: "border-rose-300/50 bg-rose-500/8 text-rose-900 dark:border-rose-400/20 dark:bg-rose-400/12 dark:text-rose-100",
    next: "border-rose-200/70 bg-rose-50/85 text-rose-800 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-100",
  },
  neutral: {
    shell: "border-sky-200/80 shadow-[0_20px_45px_-26px_rgba(14,116,144,0.45)] dark:border-sky-400/20",
    icon: "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
    pill: "border-sky-300/50 bg-sky-500/8 text-sky-900 dark:border-sky-400/20 dark:bg-sky-400/12 dark:text-sky-100",
    next: "border-sky-200/70 bg-sky-50/85 text-sky-800 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-100",
  },
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
  const stageLabel = t(stageLabelKeyForStage(recovery.stage))
  const tone = toneForStage(recovery.stage)
  const classes = toneClasses[tone]

  return (
    <div className={cn(
      "pointer-events-auto w-full max-w-[min(32rem,calc(100vw-2.5rem))] rounded-2xl border bg-white/95 p-3 text-slate-950 ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#0c1418]/95 dark:text-sky-50 dark:ring-white/5",
      classes.shell,
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", classes.icon)}>
          {renderToneIcon(tone)}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[13px] font-semibold leading-none">
                {t("controls.recovery.title")}
              </p>
              <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", classes.pill)}>
                {t("controls.recovery.stageLabel")}: {stageLabel}
              </span>
            </div>
            <p className="text-[11px] leading-4 text-slate-700/80 dark:text-sky-100/70">
              {t(descriptionKeyForStage(recovery.stage))}
            </p>
            <div className={cn("rounded-xl border px-2.5 py-2 text-[11px] leading-4", classes.next)}>
              <span className="font-medium">{t("controls.recovery.nextStepLabel")}: </span>
              <span>{t(nextStepKeyForStage(recovery.stage))}</span>
            </div>
            {recovery.executionId ? (
              <p className="font-mono text-[10px] leading-4 text-slate-500 dark:text-sky-100/55">
                {t("controls.recovery.executionLabel")}: <span title={recovery.executionId}>{recovery.executionId}</span>
              </p>
            ) : null}
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
