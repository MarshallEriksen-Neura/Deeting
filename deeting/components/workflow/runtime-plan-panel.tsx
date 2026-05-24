"use client"

import { AlertTriangle, CheckCircle2, Circle, GitBranch, Loader2, Pause, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Badge } from "@/ui/shadcn/badge"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import type { CompiledPhase, WorkflowRun, WorkflowStepRun, WorkflowStepStatus } from "@/lib/workflow/types"

interface RuntimePlanPanelProps {
  run: WorkflowRun
  steps: WorkflowStepRun[]
  activePhaseId: string | null
}

type PhaseProjection = {
  phase: CompiledPhase
  index: number
  step: WorkflowStepRun | null
  status: WorkflowStepStatus | "pending"
}

const statusTone: Record<string, { icon: LucideIcon; badge: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  pending: { icon: Circle, badge: "secondary", className: "text-muted-foreground/45" },
  ready: { icon: Circle, badge: "secondary", className: "text-muted-foreground/55" },
  running: { icon: Loader2, badge: "default", className: "text-emerald-500" },
  waiting_approval: { icon: Pause, badge: "outline", className: "text-amber-500" },
  succeeded: { icon: CheckCircle2, badge: "outline", className: "text-emerald-500" },
  failed: { icon: XCircle, badge: "destructive", className: "text-rose-500" },
  skipped: { icon: Circle, badge: "secondary", className: "text-muted-foreground/45" },
  obsolete: { icon: Circle, badge: "secondary", className: "text-muted-foreground/35" },
  invalidated: { icon: AlertTriangle, badge: "outline", className: "text-amber-500" },
  cancelled: { icon: XCircle, badge: "secondary", className: "text-muted-foreground/55" },
}

export function RuntimePlanPanel({ run, steps, activePhaseId }: RuntimePlanPanelProps) {
  const t = useI18n("workflow")
  const phases = run.snapshot_json?.phases ?? []
  const projections = projectPhases(phases, steps)
  const completed = projections.filter((item) => item.status === "succeeded").length

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-b border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)]/55 lg:border-b-0 lg:border-r">
      <div className="border-b border-[color:var(--ios-shell-border)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-tight">{t("runtimePlan.title")}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
              {t("runtimePlan.version", { version: run.snapshot_version })}
            </div>
          </div>
          <Badge variant="secondary" className="h-5 shrink-0 rounded-[4px] px-1.5 font-mono text-[10px] uppercase tracking-wider">
            {completed}/{projections.length}
          </Badge>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {projections.length === 0 ? (
            <div className="rounded-[10px] border border-[color:var(--ios-shell-border)] bg-background/45 px-3 py-3 text-[12px] leading-5 text-muted-foreground">
              {t("runtimePlan.empty")}
            </div>
          ) : (
            projections.map((item) => (
              <RuntimePlanPhase
                key={`${item.index}:${item.phase.phase_id}`}
                projection={item}
                active={item.phase.phase_id === activePhaseId}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function RuntimePlanPhase({ projection, active }: { projection: PhaseProjection; active: boolean }) {
  const t = useI18n("workflow")
  const { phase, index, status, step } = projection
  const tone = statusTone[status] ?? statusTone.pending
  const StatusIcon = tone.icon
  const title = phase.title.trim() || phase.phase_id
  const goal = (step?.goal ?? phase.goal).trim()

  return (
    <section
      className={`rounded-[10px] border px-3 py-2.5 transition-colors ${
        active
          ? "border-emerald-500/35 bg-emerald-500/10"
          : "border-[color:var(--ios-shell-border)] bg-background/40"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/70 font-mono text-[10px] text-muted-foreground">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold leading-5 tracking-tight">{title}</div>
              <div className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground/55">
                {phase.phase_id}
              </div>
            </div>
            <Badge variant={tone.badge} className="h-5 shrink-0 rounded-[4px] px-1.5 font-mono text-[10px] uppercase tracking-wider">
              <StatusIcon className={`mr-1 h-3 w-3 ${tone.className} ${status === "running" ? "animate-spin" : ""}`} />
              {t(`status.${status}`)}
            </Badge>
          </div>

          {goal ? (
            <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-muted-foreground/70">
              {goal}
            </p>
          ) : null}

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="h-5 max-w-full rounded-[4px] px-1.5 font-mono text-[10px] font-normal">
              <span className="truncate">{phase.worker_ref || t("plan.noWorker")}</span>
            </Badge>
            {phase.depends_on.map((dep) => (
              <Badge key={dep} variant="outline" className="h-5 rounded-[4px] px-1.5 font-mono text-[10px] font-normal">
                <GitBranch className="mr-1 h-3 w-3" />
                {dep}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function projectPhases(phases: CompiledPhase[], steps: WorkflowStepRun[]): PhaseProjection[] {
  const latestSteps = new Map<string, WorkflowStepRun>()
  for (const step of steps) {
    if (step.status === "obsolete") continue
    const key = `${step.phase_index}:${step.phase_id}`
    const previous = latestSteps.get(key)
    if (!previous || compareStepRecency(step, previous) > 0) {
      latestSteps.set(key, step)
    }
  }

  return phases.map((phase, index) => {
    const step = latestSteps.get(`${index}:${phase.phase_id}`) ?? null
    return {
      phase,
      index,
      step,
      status: step?.status ?? "pending",
    }
  })
}

function compareStepRecency(a: WorkflowStepRun, b: WorkflowStepRun): number {
  const aTime = Date.parse(a.updated_at || a.created_at || "")
  const bTime = Date.parse(b.updated_at || b.created_at || "")
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return aTime - bTime
  }
  return a.id.localeCompare(b.id)
}
