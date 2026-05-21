"use client"

import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"
import { useI18n } from "@/hooks/use-i18n"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { Button } from "@/ui/shadcn/button"
import { Progress } from "@/ui/shadcn/progress"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { Badge } from "@/ui/shadcn/badge"
import { getWorkflowArtifactContent } from "@/lib/workflow/commands"
import { TimelinePhase } from "./timeline-phase"
import type {
  CompiledPhase,
  PlanAuditDecision,
  WorkflowArtifactContent,
  WorkflowEvent,
  WorkflowRun,
  WorkflowStepRun,
} from "@/lib/workflow/types"

interface WorkflowExecutionProps {
  run: WorkflowRun
  steps: WorkflowStepRun[]
  events?: WorkflowEvent[]
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
  awaiting_plan_edit: { label: "execution.needsDecision", variant: "outline" },
}

export function WorkflowExecution({
  run,
  steps,
  events = [],
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

  const snapshotPhases = run.snapshot_json?.phases ?? []
  const sortedSteps = selectVisibleWorkflowSteps(steps, snapshotPhases)
  const totalPhases = snapshotPhases.length || sortedSteps.length
  const succeededCount = sortedSteps.filter((s) => s.status === "succeeded").length
  const progressPercent = totalPhases > 0 ? Math.round((succeededCount / totalPhases) * 100) : 0
  const isRunning = run.status === "running"
  const needsConfirmation = run.status === "awaiting_plan_edit"
  const focusStep =
    run.status === "failed" || run.status === "cancelled"
      ? sortedSteps.find((step) => step.phase_id === failureFocusPhaseId)
      : sortedSteps.find((step) => step.phase_id === resultFocusPhaseId)
        ?? sortedSteps.find((step) => step.phase_id === activePhaseId)
  const failedStep = sortedSteps.find((step) => step.status === "failed")
  const decisionStep = needsConfirmation ? failedStep ?? focusStep : focusStep
  const latestPlanAuditDecision = needsConfirmation ? findLatestPlanAuditDecision(events) : null

  const badge = runStatusBadge[run.status] ?? { label: "status.draft", variant: "secondary" as const }
  const headerTitle = needsConfirmation ? t("execution.needsDecisionTitle") : t("execution.title")

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[color:var(--ios-shell-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ios" size="icon-sm" className="size-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">{headerTitle}</h2>
            <Badge variant={badge.variant} className="h-5 shrink-0 rounded-[4px] px-1.5 font-mono text-[10px] uppercase tracking-wider">
              {t(badge.label)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {needsConfirmation && decisionStep ? (
        <WorkflowDecisionPanel
          run={run}
          step={decisionStep}
          auditDecision={latestPlanAuditDecision}
          onRerun={decisionStep.status === "failed" ? () => onRerunPhase(decisionStep.phase_id) : undefined}
          onResume={onResumeWorkflow}
          onViewContext={decisionStep.status === "succeeded" ? () => onViewContext(decisionStep.phase_id) : undefined}
        />
      ) : focusStep ? (
        <WorkflowFocusPanel
          run={run}
          step={focusStep}
          onRerun={focusStep.status === "failed" ? () => onRerunPhase(focusStep.phase_id) : undefined}
          onViewContext={focusStep.status === "succeeded" ? () => onViewContext(focusStep.phase_id) : undefined}
        />
      ) : null}

      {/* Timeline */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-5">
          {sortedSteps.length === 0 ? (
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

function findLatestPlanAuditDecision(events: WorkflowEvent[]): PlanAuditDecision | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.event_type !== "run.plan_audit.completed" || !event.payload) continue
    const payload = event.payload as Partial<PlanAuditDecision>
    if (
      typeof payload.completed_phase_id === "string" &&
      typeof payload.base_snapshot_version === "number" &&
      typeof payload.reason === "string" &&
      typeof payload.decision === "string" &&
      typeof payload.risk_level === "string"
    ) {
      return {
        run_id: typeof payload.run_id === "string" ? payload.run_id : event.run_id,
        completed_phase_id: payload.completed_phase_id,
        base_snapshot_version: payload.base_snapshot_version,
        decision: payload.decision as PlanAuditDecision["decision"],
        risk_level: payload.risk_level as PlanAuditDecision["risk_level"],
        reason: payload.reason,
        revalidation: (typeof payload.revalidation === "string" ? payload.revalidation : "pause_for_edit") as PlanAuditDecision["revalidation"],
        invalidates_future_phases: Array.isArray(payload.invalidates_future_phases)
          ? payload.invalidates_future_phases.filter((value): value is string => typeof value === "string")
          : [],
        delta: typeof payload.delta === "object" && payload.delta !== null ? payload.delta : null,
      }
    }
  }
  return null
}

function selectVisibleWorkflowSteps(steps: WorkflowStepRun[], phases: CompiledPhase[]): WorkflowStepRun[] {
  const latestByPhase = new Map<string, WorkflowStepRun>()
  const hasSnapshot = phases.length > 0

  for (const step of steps) {
    if (step.status === "obsolete") continue
    if (hasSnapshot && !stepMatchesSnapshotPhase(step, phases)) continue

    const key = `${step.phase_index}:${step.phase_id}`
    const previous = latestByPhase.get(key)
    if (!previous || compareStepRecency(step, previous) > 0) {
      latestByPhase.set(key, step)
    }
  }

  return [...latestByPhase.values()].sort((a, b) => {
    if (a.phase_index !== b.phase_index) return a.phase_index - b.phase_index
    return compareStepRecency(a, b)
  })
}

function stepMatchesSnapshotPhase(step: WorkflowStepRun, phases: CompiledPhase[]): boolean {
  const phase = phases[step.phase_index]
  if (!phase) return false
  return (
    step.phase_id === phase.phase_id &&
    step.title === phase.title &&
    step.worker_ref === phase.worker_ref &&
    step.goal === phase.goal
  )
}

function compareStepRecency(a: WorkflowStepRun, b: WorkflowStepRun): number {
  const aTime = Date.parse(a.updated_at || a.created_at || "")
  const bTime = Date.parse(b.updated_at || b.created_at || "")
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return aTime - bTime
  }
  return a.id.localeCompare(b.id)
}

function WorkflowDecisionPanel({
  step,
  auditDecision,
  onRerun,
  onResume,
  onViewContext,
}: {
  run: WorkflowRun
  step: WorkflowStepRun
  auditDecision?: PlanAuditDecision | null
  onRerun?: () => void
  onResume?: () => void
  onViewContext?: () => void
}) {
  const t = useI18n("workflow")
  const reason = auditDecision?.reason || step.error || step.worker_trace_summary || step.goal

  return (
    <div className="border-b border-[color:var(--ios-shell-border)] px-5 py-4">
      <div className="rounded-[20px] border border-amber-300/45 bg-amber-50/75 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-amber-400/25 dark:bg-amber-500/10">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300/60 bg-white/70 text-amber-700 dark:border-amber-400/30 dark:bg-white/10 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight text-amber-950 dark:text-amber-100">
              {t("execution.decisionPanelTitle")}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-amber-900/75 dark:text-amber-100/70">
              {t("execution.decisionPanelDescription")}
            </p>
            <div className="mt-3 rounded-[14px] border border-amber-200/70 bg-white/70 px-3 py-2 dark:border-amber-400/20 dark:bg-black/10">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-amber-900/55 dark:text-amber-100/50">
                    {auditDecision ? t("execution.auditCheckpoint") : t("execution.blockedPhase")}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] font-semibold text-foreground">
                    {step.title || step.phase_id}
                  </div>
                </div>
                {auditDecision ? (
                  <Badge variant="outline" className="h-5 shrink-0 rounded-[4px] px-1.5 font-mono text-[10px] uppercase tracking-wider">
                    {t(`execution.auditRisk.${auditDecision.risk_level}`)}
                  </Badge>
                ) : null}
              </div>
              {reason ? (
                <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-muted-foreground">
                  {reason}
                </p>
              ) : null}
              {auditDecision?.invalidates_future_phases.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {auditDecision.invalidates_future_phases.map((phaseId) => (
                    <Badge key={phaseId} variant="secondary" className="h-5 rounded-[4px] px-1.5 font-mono text-[10px]">
                      {phaseId}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {auditDecision?.delta?.operations.length ? (
                <div className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  {t("execution.proposedDeltaOperations", { count: auditDecision.delta.operations.length })}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {onRerun ? (
                <Button variant="ios" size="sm" className="h-8 rounded-[10px] px-3 text-xs" onClick={onRerun}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  {t("execution.fixByRerun")}
                </Button>
              ) : null}
              {onResume ? (
                <Button variant="outline" size="sm" className="h-8 rounded-[10px] px-3 text-xs" onClick={onResume}>
                  {t("execution.continueAnyway")}
                </Button>
              ) : null}
              {onViewContext ? (
                <Button variant="ghost" size="sm" className="h-8 rounded-[10px] px-2 text-xs" onClick={onViewContext}>
                  {t("execution.viewContext")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
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
              <WorkflowArtifactInlinePreview
                runId={run.id}
                artifactRefs={step.output_artifact_refs}
              />
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

type ArtifactPreviewState = {
  key: string
  loading: boolean
  contents: WorkflowArtifactContent[]
  error: string | null
}

function WorkflowArtifactInlinePreview({
  runId,
  artifactRefs,
}: {
  runId: string
  artifactRefs: string[]
}) {
  const t = useI18n("workflow")
  const previewKey = `${runId}:${artifactRefs.join("|")}`
  const [state, setState] = useState<ArtifactPreviewState>({
    key: "",
    loading: true,
    contents: [],
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    Promise.all(
      artifactRefs.map((artifactRef) =>
        getWorkflowArtifactContent(runId, artifactRef)
          .then((content) => ({ content, error: null as string | null }))
          .catch((error) => ({
            content: null,
            error: error instanceof Error ? error.message : String(error),
          }))
      )
    ).then((results) => {
      if (cancelled) return
      const contents = results
        .map((result) => result.content)
        .filter((content): content is WorkflowArtifactContent => Boolean(content))
      const error = results.find((result) => result.error)?.error ?? null
      setState({ key: previewKey, loading: false, contents, error })
    })

    return () => {
      cancelled = true
    }
  }, [artifactRefs, previewKey, runId])

  if (state.loading || state.key !== previewKey) {
    return (
      <div className="mt-3 rounded-[14px] border border-emerald-500/15 bg-white/55 px-3 py-2 text-[12px] text-muted-foreground dark:bg-white/[0.04]">
        {t("result.loadingArtifacts")}
      </div>
    )
  }

  const readable = pickReadableArtifact(state.contents)

  return (
    <div className="mt-3 overflow-hidden rounded-[14px] border border-emerald-500/20 bg-white/70 dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-2 border-b border-emerald-500/15 px-3 py-2">
        <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
          {t("result.primaryOutput")}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/65">
          {state.contents.map((content) => content.file_name).join(" · ")}
        </div>
      </div>

      {readable ? (
        <div className="max-h-72 overflow-y-auto px-3 py-2">
          {readable.kind === "markdown" ? (
            <MarkdownViewer
              content={readable.content ?? ""}
              className="chat-markdown chat-markdown-assistant text-[12px] leading-5"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-[11px] leading-5 text-foreground">
              {readable.content}
            </pre>
          )}
        </div>
      ) : (
        <div className="px-3 py-3 text-[12px] leading-5 text-muted-foreground">
          {state.error ? state.error : t("result.emptyArtifacts")}
        </div>
      )}
    </div>
  )
}

function pickReadableArtifact(contents: WorkflowArtifactContent[]) {
  const withText = contents.filter((content) => content.content?.trim())
  return (
    withText.find((content) => content.kind === "markdown") ??
    withText.find((content) => content.kind === "text") ??
    withText.find((content) => content.kind === "json") ??
    null
  )
}
