"use client"

import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/ui/shadcn/button"
import { Progress } from "@/ui/shadcn/progress"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { Badge } from "@/ui/shadcn/badge"
import { TimelinePhase } from "./timeline-phase"
import type { WorkflowRun, WorkflowStepRun } from "@/lib/workflow/types"

interface WorkflowExecutionProps {
  run: WorkflowRun
  steps: WorkflowStepRun[]
  activePhaseId: string | null
  resultFocusPhaseId: string | null
  failureFocusPhaseId: string | null
  expandedPhaseIds: Set<string>
  onToggleExpand: (phaseId: string) => void
  onRerunPhase: (phaseId: string) => void
  onViewContext: (phaseId: string) => void
  onResumeWorkflow?: () => void
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
  resultFocusPhaseId,
  failureFocusPhaseId,
  expandedPhaseIds,
  onToggleExpand,
  onRerunPhase,
  onViewContext,
  onResumeWorkflow,
  onBack,
  onCancel,
}: WorkflowExecutionProps) {
  const t = useI18n("workflow")

  const totalPhases = run.snapshot_json?.phases?.length ?? 0
  const succeededCount = steps.filter((s) => s.status === "succeeded").length
  const progressPercent = totalPhases > 0 ? Math.round((succeededCount / totalPhases) * 100) : 0
  const isRunning = run.status === "running"
  const needsConfirmation = run.status === "awaiting_plan_edit"
  const sortedSteps = [...steps].sort((a, b) => a.phase_index - b.phase_index)
  const focusStep =
    run.status === "failed" || run.status === "cancelled"
      ? sortedSteps.find((step) => step.phase_id === failureFocusPhaseId)
      : sortedSteps.find((step) => step.phase_id === resultFocusPhaseId)
        ?? sortedSteps.find((step) => step.phase_id === activePhaseId)

  const badge = runStatusBadge[run.status] ?? { label: "status.draft", variant: "secondary" as const }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[color:var(--ios-shell-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ios" size="icon-sm" className="size-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">{t("execution.title")}</h2>
            <Badge variant={badge.variant} className="h-5 shrink-0 rounded-[4px] px-1.5 font-mono text-[10px] uppercase tracking-wider">
              {t(badge.label)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {needsConfirmation && onResumeWorkflow ? (
            <Button variant="ios" size="sm" className="text-xs" onClick={onResumeWorkflow}>
              {t("execution.continue")}
            </Button>
          ) : null}
          {isRunning && onCancel && (
            <Button variant="ios" size="sm" className="text-xs" onClick={onCancel}>
              {t("execution.cancel")}
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-2 border-b border-[color:var(--ios-shell-border)] px-5 py-3">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          <span>{t("execution.phaseOf", { current: succeededCount, total: totalPhases })}</span>
          <span>{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-[2px] rounded-none bg-black/5 dark:bg-white/5" />
      </div>

      {focusStep && (
        <WorkflowFocusPanel
          run={run}
          step={focusStep}
          onRerun={focusStep.status === "failed" ? () => onRerunPhase(focusStep.phase_id) : undefined}
          onViewContext={focusStep.status === "succeeded" ? () => onViewContext(focusStep.phase_id) : undefined}
        />
      )}

      {/* Timeline */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-5">
          {steps.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              {t("execution.pending")}
            </div>
          ) : (
            sortedSteps.map((step) => (
                <TimelinePhase
                  key={step.id}
                  step={step}
                  isActive={step.phase_id === activePhaseId}
                  isExpanded={
                    expandedPhaseIds.has(step.phase_id) ||
                    step.phase_id === resultFocusPhaseId ||
                    step.phase_id === failureFocusPhaseId
                  }
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

function WorkflowFocusPanel({
  run,
  step,
  onRerun,
  onViewContext,
}: {
  run: WorkflowRun
  step: WorkflowStepRun
  onRerun?: () => void
  onViewContext?: () => void
}) {
  const t = useI18n("workflow")
  const isFailed = step.status === "failed" || run.status === "failed" || run.status === "cancelled"
  const isCompleted = step.status === "succeeded" && (run.status === "completed" || run.status === "awaiting_plan_edit")
  const Icon = isFailed ? AlertTriangle : isCompleted ? CheckCircle2 : Loader2
  const summary = isFailed
    ? step.error || run.error || step.worker_trace_summary || step.goal
    : step.worker_trace_summary || step.goal

  return (
    <div className="border-b border-[color:var(--ios-shell-border)] px-5 py-4">
      <div className={`rounded-[16px] border px-4 py-3 ${
        isFailed
          ? "border-rose-500/25 bg-rose-500/5"
          : isCompleted
            ? "border-emerald-500/25 bg-emerald-500/5"
            : "border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)]"
      }`}>
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${
            isFailed ? "text-rose-500" : isCompleted ? "text-emerald-500" : "animate-spin text-muted-foreground"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  {isFailed ? t("execution.failed") : isCompleted ? t("execution.completed") : t("execution.running")}
                </div>
                <div className="mt-0.5 truncate text-[13px] font-semibold tracking-tight">
                  {step.title || step.phase_id}
                </div>
              </div>
              <div className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{step.phase_id}</div>
            </div>

            {summary ? (
              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground/80 line-clamp-6">
                {summary}
              </p>
            ) : (
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground/60">{t("result.noResults")}</p>
            )}

            {step.output_artifact_refs.length > 0 && (
              <div className="mt-3 space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {t("result.artifacts")}
                </div>
                {step.output_artifact_refs.map((artifact) => (
                  <div key={artifact} className="truncate font-mono text-[10px] text-muted-foreground/80">
                    {formatArtifactLabel(artifact)}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {onViewContext && (
                <Button variant="ios" size="xs" className="h-7 rounded-[8px] px-2 text-[10px]" onClick={onViewContext}>
                  {t("result.viewFullContext")}
                </Button>
              )}
              {onRerun && (
                <Button variant="ios" size="xs" className="h-7 rounded-[8px] px-2 text-[10px]" onClick={onRerun}>
                  {t("execution.rerunPhase")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatArtifactLabel(ref: string): string {
  return ref.split(/[\\/]/).pop() || "Artifact"
}
