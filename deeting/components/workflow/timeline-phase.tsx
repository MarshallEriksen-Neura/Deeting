"use client"

import { Check, X, Pause, Clock, Loader2 } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { WorkflowStepRun } from "@/lib/workflow/types"

interface TimelinePhaseProps {
  step: WorkflowStepRun
  isActive: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onRerun?: () => void
  onViewContext?: () => void
}

const statusConfig = {
  pending: { color: "border-muted-foreground/30", bg: "", icon: null, tone: "secondary" as const },
  ready: { color: "border-muted-foreground/40", bg: "", icon: null, tone: "secondary" as const },
  running: { color: "border-primary", bg: "bg-primary", icon: Loader2, tone: "default" as const },
  succeeded: { color: "border-emerald-500", bg: "bg-emerald-500", icon: Check, tone: "default" as const },
  failed: { color: "border-rose-500", bg: "bg-rose-500", icon: X, tone: "destructive" as const },
  waiting_approval: { color: "border-amber-500", bg: "bg-amber-500", icon: Pause, tone: "default" as const },
  skipped: { color: "border-muted-foreground/20", bg: "bg-muted-foreground/20", icon: null, tone: "secondary" as const },
  cancelled: { color: "border-muted-foreground/30", bg: "bg-muted-foreground/30", icon: X, tone: "secondary" as const },
  obsolete: { color: "border-muted-foreground/15", bg: "bg-muted-foreground/15", icon: null, tone: "secondary" as const },
  invalidated: { color: "border-amber-500/50", bg: "", icon: null, tone: "outline" as const },
} as const

export function TimelinePhase({
  step,
  isActive,
  isExpanded,
  onToggleExpand,
  onRerun,
  onViewContext,
}: TimelinePhaseProps) {
  const t = useI18n("workflow")
  const config = statusConfig[step.status] ?? statusConfig.pending

  const StatusIcon = config.icon
  const isRunning = step.status === "running"
  const isCompleted = step.status === "succeeded"
  const isFailed = step.status === "failed"

  const duration = computeDuration(step)

  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        {/* Status dot */}
        <div className="relative">
          <div
            className={`h-3 w-3 rounded-full border-2 ${config.color} ${config.bg} flex items-center justify-center transition-colors`}
          >
            {StatusIcon && (
              <StatusIcon
                className={`h-2 w-2 text-white ${isRunning ? "animate-spin" : ""}`}
              />
            )}
          </div>
          {/* Pulse ring for running */}
          {isRunning && (
            <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-40" />
          )}
        </div>
        {/* Vertical line */}
        <div className="flex-1 w-px bg-border/50 mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 -mt-0.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-sm font-medium truncate ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
              {step.title || step.phase_id}
            </span>
            <Badge variant={config.tone} className="text-[10px] h-4 px-1.5 shrink-0">
              {t(`status.${step.status}`)}
            </Badge>
          </div>
          {duration && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Clock className="h-3 w-3" />
              {duration}
            </span>
          )}
        </div>

        {/* Goal */}
        {step.goal && (
          <p className="mt-1 text-xs text-muted-foreground/70 line-clamp-2">{step.goal}</p>
        )}

        {/* Error display */}
        {isFailed && step.error && (
          <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2">
            <p className="text-xs text-destructive/80">{step.error}</p>
            {onRerun && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-6 text-xs"
                onClick={onRerun}
              >
                {t("execution.rerunPhase")}
              </Button>
            )}
          </div>
        )}

        {/* Expandable results for completed phases */}
        {isCompleted && step.worker_trace_summary && (
          <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="mt-1 h-6 text-xs text-muted-foreground px-0">
                {isExpanded ? t("execution.hideResults") : t("execution.showResults")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 rounded-lg border border-border/50 bg-card/30 p-3">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-10">
                  {step.worker_trace_summary}
                </p>
                {onViewContext && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-6 text-xs text-muted-foreground px-0"
                    onClick={onViewContext}
                  >
                    {t("execution.viewContext")}
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}

function computeDuration(step: WorkflowStepRun): string | null {
  if (!step.started_at) return null
  const start = new Date(step.started_at).getTime()
  const end = step.completed_at ? new Date(step.completed_at).getTime() : Date.now()
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}
