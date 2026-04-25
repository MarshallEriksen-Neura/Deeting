"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { useWorkflowStore } from "@/store/workflow-store"
import {
  generateWorkflowProposal,
  regenerateWorkflowProposal,
  getWorkflowRunStatus,
  getWorkflowPhaseContext,
  approveWorkflow,
  rerunPhase,
  streamWorkflowCompileAndStart,
} from "@/lib/workflow/commands"
import type { WorkflowPhaseContext } from "@/lib/workflow/types"
import { WorkflowLanding } from "./workflow-landing"
import { PlanEditor } from "./plan-editor"
import type { PlanPhaseData } from "./plan-phase-card"
import { WorkflowExecution } from "./workflow-execution"
import { ApprovalGate } from "./approval-gate"
import { PhaseContextViewer } from "./phase-context-viewer"

interface WorkflowRuntimeProps {
  initialGoal?: string
  initialRunId?: string
  initialPhaseId?: string
  initialContextPhaseId?: string
  onClose?: () => void
}

export function WorkflowRuntime({
  initialGoal,
  initialRunId,
  initialPhaseId,
  initialContextPhaseId,
  onClose,
}: WorkflowRuntimeProps) {
  const store = useWorkflowStore()
  const [phaseContext, setPhaseContext] = useState<WorkflowPhaseContext | null>(null)

  useEffect(() => {
    if (!initialRunId) return
    const runId = initialRunId.trim()
    if (!runId || store.runId === runId) return

    let cancelled = false

    async function hydrateRun() {
      try {
        const detail = await getWorkflowRunStatus(runId)
        if (!cancelled) {
          store.setRunDetail(detail)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          store.setError(msg)
        }
      }
    }

    void hydrateRun()

    return () => {
      cancelled = true
    }
  }, [initialRunId, store.runId, store.setError, store.setRunDetail])

  useEffect(() => {
    const phaseId = initialPhaseId?.trim()
    if (!phaseId) return
    store.setActivePhaseId(phaseId)
  }, [initialPhaseId, store.setActivePhaseId])

  const handleOpenContextViewer = useCallback(async (phaseId: string) => {
    if (!store.runId) return
    try {
      const context = await getWorkflowPhaseContext(store.runId, phaseId)
      setPhaseContext(context)
      store.openContextViewer(phaseId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [store.runId])

  useEffect(() => {
    const phaseId = initialContextPhaseId?.trim()
    if (!phaseId || !store.runId) return
    void handleOpenContextViewer(phaseId)
  }, [handleOpenContextViewer, initialContextPhaseId, store.runId])

  // --- Landing: create workflow ---
  const handleCreateWorkflow = useCallback(async (goal: string, hints?: string) => {
    store.setLoading(true)
    store.setError(null)
    try {
      const run = await generateWorkflowProposal({ goal, hints })
      store.setRun(run)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      store.setError(msg)
      toast.error(msg)
    } finally {
      store.setLoading(false)
    }
  }, [])

  // --- Editor: update phases ---
  const handlePhasesChange = useCallback((phases: PlanPhaseData[]) => {
    const proposalText = phasesToProposalMd(phases, store.run?.goal ?? "")
    store.setEditedProposal(proposalText)
  }, [store.run?.goal])

  // --- Editor: compile and start ---
  const handleCompileAndStart = useCallback(async () => {
    if (!store.runId || !store.editedProposal) return
    store.setCompileErrors([])
    store.setLoading(true)

    try {
      await streamWorkflowCompileAndStart(
        {
          runId: store.runId,
          proposalText: store.editedProposal,
          proposalDirty: store.proposalDirty,
          requestId: `workflow-${Date.now()}`,
        },
        {
          onEvent: (event) => {
            store.applyStreamEvent(event)
            if (event.type === "workflow.compile_result" && event.compile_result.errors.length === 0) {
              store.markProposalClean()
            }
          },
        },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      store.setError(msg)
      toast.error(msg)
    } finally {
      store.setLoading(false)
    }
  }, [store])

  // --- Editor: regenerate ---
  const handleRegenerate = useCallback(async () => {
    if (!store.runId) return
    try {
      const run = await regenerateWorkflowProposal({ run_id: store.runId })
      store.setRun(run)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [store.runId])

  // --- Execution: rerun phase ---
  const handleRerunPhase = useCallback(async (phaseId: string) => {
    if (!store.runId) return
    try {
      const run = await rerunPhase({ run_id: store.runId, phase_id: phaseId })
      store.setRun(run)
      toast.success(`Phase ${phaseId} queued for rerun`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [store.runId])

  // --- Approval ---
  const handleApprove = useCallback(async () => {
    if (!store.runId) return
    const run = await approveWorkflow({ run_id: store.runId, action: "approve" })
    store.setRun(run)
  }, [store.runId])

  const handleReject = useCallback(async () => {
    if (!store.runId) return
    const run = await approveWorkflow({ run_id: store.runId, action: "reject" })
    store.setRun(run)
  }, [store.runId])

  const handleModify = useCallback(() => {
    store.setView("editor")
  }, [])

  // --- Back / reset ---
  const handleBack = useCallback(() => {
    if (store.view === "editor") {
      store.setView("landing")
    } else if (store.view === "execution") {
      store.setView("editor")
    }
  }, [store.view])

  // --- Parse proposal into phase cards ---
  const phases = store.editedProposal
    ? proposalMdToPhases(store.editedProposal)
    : []

  // --- Find active checkpoint for approval gate ---
  const showApproval = store.run?.status === "waiting_approval"

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-bg)] shadow-[0_28px_68px_-38px_rgba(15,23,42,0.42)] backdrop-blur-2xl">
      {/* Surface 1: Landing */}
      {store.view === "landing" && (
        <WorkflowLanding
          onCreateWorkflow={handleCreateWorkflow}
          initialGoal={initialGoal}
        />
      )}

      {/* Surface 2: Plan Editor */}
      {store.view === "editor" && store.run && (
        <PlanEditor
          goal={store.run.goal}
          phases={phases}
          compilerErrors={store.compileErrors}
          onPhasesChange={handlePhasesChange}
          onCompileAndStart={handleCompileAndStart}
          onRegenerate={handleRegenerate}
          onBack={handleBack}
        />
      )}

      {/* Surface 3: Execution + Surface 5: Approval */}
      {store.view === "execution" && store.run && (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden px-3 pb-3 pt-2">
            <WorkflowExecution
              run={store.run}
              steps={store.steps}
              activePhaseId={store.activePhaseId}
              expandedPhaseIds={store.expandedPhaseIds}
              onToggleExpand={(id) => store.togglePhaseExpanded(id)}
              onRerunPhase={handleRerunPhase}
              onViewContext={handleOpenContextViewer}
              onBack={handleBack}
            />
          </div>

          {/* Approval gate overlay */}
          {showApproval && (
            <div className="border-t border-[color:var(--ios-shell-border)] px-4 py-4">
              <ApprovalGate
                checkpoint={{
                  id: "",
                  run_id: store.runId ?? "",
                  blocked_step_id: null,
                  reason: "Phase completed. Review and approve to continue.",
                  approval_payload: null,
                  resume_payload: null,
                  resolved: false,
                  created_at: "",
                  resolved_at: null,
                }}
                onApprove={handleApprove}
                onReject={handleReject}
                onModify={handleModify}
              />
            </div>
          )}
        </div>
      )}

      {/* Surface 6: Context Viewer Sheet */}
      <PhaseContextViewer
        open={store.contextViewerPhaseId !== null}
        onClose={() => store.closeContextViewer()}
        phaseId={phaseContext?.phase_id ?? store.contextViewerPhaseId ?? ""}
        phaseTitle={phaseContext?.phase_title ?? ""}
        contextMd={phaseContext?.context_md ?? null}
        contextJson={phaseContext?.context_json ?? null}
      />
    </div>
  )
}

// --- Proposal MD <-> Phase Data conversion ---

function proposalMdToPhases(md: string): PlanPhaseData[] {
  const phases: PlanPhaseData[] = []
  let current: Partial<PlanPhaseData> | null = null

  for (const line of md.split("\n")) {
    const phaseMatch = line.match(/^## Phase (\d+):\s*(.*)/)
    if (phaseMatch) {
      if (current?.phase_id) phases.push(current as PlanPhaseData)
      current = {
        phase_id: `phase-${phaseMatch[1]}`,
        title: phaseMatch[2].trim(),
        worker_ref: "direct_llm:default",
        goal: "",
        depends_on: [],
        user_notes: "",
      }
      continue
    }
    if (!current) continue

    if (line.startsWith("- Worker:")) {
      current.worker_ref = line.replace("- Worker:", "").trim()
    } else if (line.startsWith("- Goal:")) {
      current.goal = line.replace("- Goal:", "").trim()
    } else if (line.startsWith("- Depends on:")) {
      const raw = line.replace("- Depends on:", "").trim()
      current.depends_on = raw && raw !== "--"
        ? raw.split(",").map((s) => s.trim().replace(/^Phase\s+/i, "phase-"))
        : []
    } else if (line.startsWith("- User Notes:")) {
      current.user_notes = line.replace("- User Notes:", "").trim()
    }
  }
  if (current?.phase_id) phases.push(current as PlanPhaseData)
  return phases
}

function phasesToProposalMd(phases: PlanPhaseData[], goal: string): string {
  const lines: string[] = [
    "# Workflow Proposal",
    "",
    `Goal: ${goal}`,
    "",
  ]

  for (const phase of phases) {
    const idx = phase.phase_id.replace("phase-", "")
    lines.push(`## Phase ${idx}: ${phase.title}`)
    lines.push(`- Worker: ${phase.worker_ref || "direct_llm:default"}`)
    lines.push(`- Goal: ${phase.goal}`)
    const deps = phase.depends_on.length > 0
      ? phase.depends_on.map((d: string) => d.replace("phase-", "Phase ")).join(", ")
      : "--"
    lines.push(`- Depends on: ${deps}`)
    lines.push(`- User Notes: ${phase.user_notes || ""}`)
    lines.push("")
  }

  return lines.join("\n")
}

// Re-export PlanPhaseData for external use
export type { PlanPhaseData } from "./plan-phase-card"
