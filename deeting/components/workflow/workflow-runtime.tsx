"use client"

import { useCallback, useEffect } from "react"
import { toast } from "sonner"
import { useWorkflowStore, type WorkflowView } from "@/store/workflow-store"
import {
  generateWorkflowProposal,
  updateWorkflowProposal,
  compileWorkflowProposal,
  startWorkflowRun,
  regenerateWorkflowProposal,
  getWorkflowRunStatus,
  approveWorkflow,
  rerunPhase,
} from "@/lib/workflow/commands"
import type { WorkflowProgress } from "@/lib/workflow/types"
import { WorkflowLanding } from "./workflow-landing"
import { PlanEditor } from "./plan-editor"
import type { PlanPhaseData } from "./plan-phase-card"
import { WorkflowExecution } from "./workflow-execution"
import { ApprovalGate } from "./approval-gate"
import { PhaseContextViewer } from "./phase-context-viewer"

interface WorkflowRuntimeProps {
  initialGoal?: string
  initialRunId?: string
  onClose?: () => void
}

export function WorkflowRuntime({ initialGoal, initialRunId, onClose }: WorkflowRuntimeProps) {
  const store = useWorkflowStore()

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

  // --- Tauri event listener for progress updates ---
  useEffect(() => {
    if (!store.isRunning()) return

    let unlisten: (() => void) | null = null

    async function setup() {
      const { listen } = await import("@tauri-apps/api/event")
      unlisten = await listen<WorkflowProgress>("workflow-progress", (event) => {
        store.applyProgress(event.payload)
      })
    }

    setup()
    return () => { unlisten?.() }
  }, [store.run?.status])

  // --- Poll for status while running ---
  useEffect(() => {
    if (!store.runId || !store.isRunning()) return

    const interval = setInterval(async () => {
      try {
        const detail = await getWorkflowRunStatus(store.runId!)
        store.setRunDetail(detail)
      } catch {
        // silent polling failure
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [store.runId, store.run?.status])

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

    try {
      // Save edited proposal
      if (store.proposalDirty) {
        const updated = await updateWorkflowProposal({
          run_id: store.runId,
          proposal_text: store.editedProposal,
        })
        store.setRun(updated)
        store.markProposalClean()
      }

      // Compile
      const result = await compileWorkflowProposal(store.runId)
      if (result.errors.length > 0) {
        store.setCompileErrors(result.errors)
        return
      }

      // Start
      const run = await startWorkflowRun(store.runId)
      store.setRun(run)

      // Load full detail
      const detail = await getWorkflowRunStatus(store.runId)
      store.setRunDetail(detail)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    }
  }, [store.runId, store.editedProposal, store.proposalDirty])

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
    <div className="flex h-full flex-col bg-background/80 backdrop-blur-sm">
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
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <WorkflowExecution
              run={store.run}
              steps={store.steps}
              activePhaseId={store.activePhaseId}
              expandedPhaseIds={store.expandedPhaseIds}
              onToggleExpand={(id) => store.togglePhaseExpanded(id)}
              onRerunPhase={handleRerunPhase}
              onViewContext={(id) => store.openContextViewer(id)}
              onBack={handleBack}
            />
          </div>

          {/* Approval gate overlay */}
          {showApproval && (
            <div className="p-4 border-t border-border/50">
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
        phaseId={store.contextViewerPhaseId ?? ""}
        phaseTitle=""
        contextMd={null}
        contextJson={null}
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
