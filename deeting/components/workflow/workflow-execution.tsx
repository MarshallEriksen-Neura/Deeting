"use client"

import { ArrowLeft } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { TimelinePhase } from "./timeline-phase"
import type { WorkflowRun, WorkflowStepRun } from "@/lib/workflow/types"

interface WorkflowExecutionProps {
  run: WorkflowRun
  steps: WorkflowStepRun[]
  activePhaseId: string | null
  expandedPhaseIds: Set<string>
  onToggleExpand: (phaseId: string) => void
  onRerunPhase: (phaseId: string) => void
  onViewContext: (phaseId: string) => void
  onBack: () => void
  onCancel?: () => void
}

const runStatusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  running: { label: "execution.running", variant: "default" },
  completed: { label: "execution.completed", variant: "default" },
  failed: { label: "execution.failed", variant: "destructive" },
  cancelled: { label: "execution.cancelled", variant: "secondary" },
  waiting_approval: { label: "execution.waitingApproval", variant: "outline" },
  awaiting_plan_edit: { label: "execution.awaitingEdit", variant: "outline" },
}

export function WorkflowExecution({
  run,
  steps,
  activePhaseId,
  expandedPhaseIds,
  onToggleExpand,
  onRerunPhase,
  onViewContext,
  onBack,
  onCancel,
}: WorkflowExecutionProps) {
  const t = useI18n("workflow")

  const totalPhases = run.snapshot_json?.phases?.length ?? 0
  const succeededCount = steps.filter((s) => s.status === "succeeded").length
  const progressPercent = totalPhases > 0 ? Math.round((succeededCount / totalPhases) * 100) : 0
  const isRunning = run.status === "running"

  const badge = runStatusBadge[run.status] ?? { label: "status.draft", variant: "secondary" as const }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold">{t("execution.title")}</h2>
          <Badge variant={badge.variant} className="text-xs">
            {t(badge.label)}
          </Badge>
        </div>
        {isRunning && onCancel && (
          <Button variant="secondary" size="sm" className="text-xs" onClick={onCancel}>
            {t("execution.cancel")}
          </Button>
        )}
      </div>

      {/* Progress */}
      <div className="px-4 py-3 space-y-2 border-b border-border/50">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("execution.phaseOf", { current: succeededCount, total: totalPhases })}</span>
          <span>{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-1.5" />
      </div>

      {/* Timeline */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {steps.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              {t("execution.pending")}
            </div>
          ) : (
            steps
              .sort((a, b) => a.phase_index - b.phase_index)
              .map((step) => (
                <TimelinePhase
                  key={step.id}
                  step={step}
                  isActive={step.phase_id === activePhaseId}
                  isExpanded={expandedPhaseIds.has(step.phase_id)}
                  onToggleExpand={() => onToggleExpand(step.phase_id)}
                  onRerun={step.status === "failed" ? () => onRerunPhase(step.phase_id) : undefined}
                  onViewContext={step.status === "succeeded" ? () => onViewContext(step.phase_id) : undefined}
                />
              ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
