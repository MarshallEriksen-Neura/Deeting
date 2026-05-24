"use client"

import { Check, X, Pause, Clock, Loader2 } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/shadcn/collapsible"
import type { WorkflowStepRun } from "@/lib/workflow/types"

interface TimelinePhaseProps {
  step: WorkflowStepRun
  isActive: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onViewResult?: () => void
}

const statusConfig = {
  pending: { color: "border-muted-foreground/30", bg: "", icon: null, tone: "secondary" as const },
  ready: { color: "border-muted-foreground/40", bg: "", icon: null, tone: "secondary" as const },
  running: { color: "border-emerald-400", bg: "bg-emerald-400/20", icon: Loader2, tone: "default" as const },
  succeeded: { color: "border-emerald-500", bg: "bg-emerald-500/20", icon: Check, tone: "outline" as const },
  failed: { color: "border-rose-500", bg: "bg-rose-500/20", icon: X, tone: "destructive" as const },
  waiting_approval: { color: "border-amber-500", bg: "bg-amber-500/20", icon: Pause, tone: "outline" as const },
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
  onViewResult,
}: TimelinePhaseProps) {
  const t = useI18n("workflow")
  const config = statusConfig[step.status] ?? statusConfig.pending

  const StatusIcon = config.icon
  const isRunning = step.status === "running"
  const isCompleted = step.status === "succeeded"
  const isFailed = step.status === "failed"
  const hasResult = Boolean(step.worker_trace_summary || step.output_artifact_refs.length > 0)

  const duration = computeDuration(step)

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        {/* Status dot */}
        <div className="relative">
          <div
            className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-transparent transition-colors ${config.color} ${config.bg}`}
          >
            {StatusIcon && (
              <StatusIcon
                className={`h-2 w-2 text-foreground/70 ${isRunning ? "animate-spin text-emerald-500" : ""} ${isCompleted ? "text-emerald-500" : ""}`}
              />
            )}
          </div>
          {/* Pulse ring for running */}
          {isRunning && (
            <div className="absolute inset-0 rounded-full border border-emerald-400 animate-ping opacity-60" />
          )}
        </div>
        {/* Vertical line */}
        <div className="mt-1 w-px flex-1 bg-border/50" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-1 pt-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`truncate text-[13px] font-medium tracking-wide ${isActive ? "text-foreground" : "text-muted-foreground/70"}`}>
              {step.title || step.phase_id}
            </span>
            <Badge variant={config.tone} className={`h-5 shrink-0 rounded-[4px] px-1.5 font-mono text-[10px] uppercase tracking-wider ${isCompleted ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : ''}`}>
              {t(`status.${step.status}`)}
            </Badge>
          </div>
          {duration && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground/60 shrink-0">
              <Clock className="h-3 w-3" />
              {duration}
            </span>
          )}
        </div>

        {/* Goal */}
        {step.goal && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground/60">{step.goal}</p>
        )}

        {/* Error display */}
        {isFailed && step.error && (
          <div className="mt-2 border-l-2 border-rose-500/40 bg-rose-500/5 py-2 pl-3 pr-2">
            <p className="font-mono text-[11px] text-rose-600/80 dark:text-rose-400/80">{step.error}</p>
          </div>
        )}

        {/* Expandable results for completed phases */}
        {isCompleted && hasResult && (
          <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="mt-1.5 h-6 px-1 font-mono text-[10px] text-muted-foreground/60 hover:bg-transparent hover:text-foreground">
                {isExpanded ? "[-]" : "[+]"} {isExpanded ? t("execution.hideResults") : t("execution.showResults")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 border-l-2 border-emerald-500/20 bg-emerald-500/5 py-2 pl-3 pr-2">
                {step.worker_trace_summary && (
                  <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/80 whitespace-pre-wrap line-clamp-10">
                    {step.worker_trace_summary}
                  </p>
                )}
                {step.output_artifact_refs.length > 0 && (
                  <div className="mt-2 space-y-1 font-mono text-[10px] text-muted-foreground/70">
                    {step.output_artifact_refs.map((artifact) => (
                      <div key={artifact} className="truncate">{formatArtifactLabel(artifact)}</div>
                    ))}
                  </div>
                )}
                {onViewResult && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="mt-2 h-6 px-0 font-mono text-[10px] text-emerald-600/70 hover:bg-transparent hover:text-emerald-600 dark:text-emerald-400/70 dark:hover:text-emerald-400"
                    onClick={onViewResult}
                  >
                    {'>'} {t("execution.viewResult")}
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

function formatArtifactLabel(ref: string): string {
  return ref.split(/[\\/]/).pop() || "Artifact"
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
