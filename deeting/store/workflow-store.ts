"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type {
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowEvent,
  CompileResult,
  WorkflowProgress,
} from "@/lib/workflow/types"

// --- UI State Types ---

export type WorkflowView = "landing" | "editor" | "execution"

export interface WorkflowState {
  // Current run
  runId: string | null
  run: WorkflowRun | null
  steps: WorkflowStepRun[]
  events: WorkflowEvent[]

  // UI state
  view: WorkflowView
  loading: boolean
  error: string | null
  compileErrors: CompileResult["errors"]

  // Editor state
  editedProposal: string | null
  proposalDirty: boolean

  // Execution state
  activePhaseId: string | null
  expandedPhaseIds: Set<string>

  // Approval state
  approvalPending: boolean

  // Context viewer
  contextViewerPhaseId: string | null

  // Actions
  reset: () => void
  setRun: (run: WorkflowRun) => void
  setRunDetail: (detail: WorkflowRunDetail) => void
  setView: (view: WorkflowView) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setCompileErrors: (errors: CompileResult["errors"]) => void

  // Editor actions
  setEditedProposal: (text: string) => void
  markProposalClean: () => void

  // Execution actions
  applyProgress: (progress: WorkflowProgress) => void
  setActivePhaseId: (phaseId: string | null) => void
  togglePhaseExpanded: (phaseId: string) => void

  // Approval actions
  setApprovalPending: (pending: boolean) => void

  // Context viewer actions
  openContextViewer: (phaseId: string) => void
  closeContextViewer: () => void

  // Derived state helpers
  currentPhaseIndex: () => number
  totalPhases: () => number
  progressPercent: () => number
  isRunning: () => boolean
  isPaused: () => boolean
}

const emptyState = {
  runId: null,
  run: null,
  steps: [],
  events: [],
  view: "landing" as WorkflowView,
  loading: false,
  error: null,
  compileErrors: [],
  editedProposal: null,
  proposalDirty: false,
  activePhaseId: null,
  expandedPhaseIds: new Set<string>(),
  approvalPending: false,
  contextViewerPhaseId: null,
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      ...emptyState,

      reset: () => set({ ...emptyState, expandedPhaseIds: new Set() }),

      setRun: (run) => {
        const view = deriveView(run.status)
        set({
          runId: run.id,
          run,
          view,
          error: run.error,
          editedProposal: run.proposal_text,
          proposalDirty: false,
          approvalPending: run.status === "waiting_approval",
        })
      },

      setRunDetail: (detail) => {
        const view = deriveView(detail.run.status)
        const activePhaseId = findActivePhaseId(detail.steps)
        set({
          runId: detail.run.id,
          run: detail.run,
          steps: detail.steps,
          events: detail.events,
          view,
          activePhaseId,
          error: detail.run.error,
          approvalPending: detail.run.status === "waiting_approval",
        })
      },

      setView: (view) => set({ view }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setCompileErrors: (errors) => set({ compileErrors: errors }),

      // Editor
      setEditedProposal: (text) => set({ editedProposal: text, proposalDirty: true }),
      markProposalClean: () => set({ proposalDirty: false }),

      // Execution
      applyProgress: (progress) => {
        const { steps } = get()
        const updated = steps.map((s) =>
          s.phase_id === progress.phase_id
            ? { ...s, status: mapProgressStatus(progress.status) }
            : s,
        )
        set({
          steps: updated,
          activePhaseId: progress.status === "started" || progress.status === "running"
            ? progress.phase_id
            : get().activePhaseId,
        })
      },

      setActivePhaseId: (phaseId) => set({ activePhaseId: phaseId }),

      togglePhaseExpanded: (phaseId) => {
        const expanded = new Set(get().expandedPhaseIds)
        if (expanded.has(phaseId)) {
          expanded.delete(phaseId)
        } else {
          expanded.add(phaseId)
        }
        set({ expandedPhaseIds: expanded })
      },

      // Approval
      setApprovalPending: (pending) => set({ approvalPending: pending }),

      // Context viewer
      openContextViewer: (phaseId) => set({ contextViewerPhaseId: phaseId }),
      closeContextViewer: () => set({ contextViewerPhaseId: null }),

      // Derived
      currentPhaseIndex: () => {
        const { steps } = get()
        const running = steps.find((s) => s.status === "running")
        return running ? running.phase_index : -1
      },

      totalPhases: () => {
        const { run } = get()
        if (!run?.snapshot_json) return 0
        return run.snapshot_json.phases?.length ?? 0
      },

      progressPercent: () => {
        const { steps } = get()
        const total = get().totalPhases()
        if (total === 0) return 0
        const succeeded = steps.filter((s) => s.status === "succeeded").length
        return Math.round((succeeded / total) * 100)
      },

      isRunning: () => get().run?.status === "running",
      isPaused: () => {
        const status = get().run?.status
        return status === "waiting_approval" || status === "awaiting_plan_edit"
      },
    }),
    {
      name: "deeting-workflow",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        runId: state.runId,
        view: state.view,
      }),
    },
  ),
)

// --- Helpers ---

function deriveView(status: WorkflowRunStatus): WorkflowView {
  switch (status) {
    case "draft":
      return "editor"
    case "ready":
      return "editor"
    case "running":
    case "completed":
    case "failed":
    case "cancelled":
    case "waiting_approval":
    case "awaiting_plan_edit":
      return "execution"
    default:
      return "landing"
  }
}

function findActivePhaseId(steps: WorkflowStepRun[]): string | null {
  const running = steps.find((s) => s.status === "running")
  if (running) return running.phase_id
  const waiting = steps.find((s) => s.status === "waiting_approval")
  if (waiting) return waiting.phase_id
  return null
}

function mapProgressStatus(status: string): WorkflowStepRun["status"] {
  switch (status) {
    case "started":
      return "running"
    case "succeeded":
      return "succeeded"
    case "failed":
      return "failed"
    case "waiting_approval":
      return "waiting_approval"
    default:
      return "running"
  }
}
