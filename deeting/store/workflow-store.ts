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
import type { WorkflowStreamEvent } from "@/lib/workflow/commands"

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
  resultFocusPhaseId: string | null
  failureFocusPhaseId: string | null
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
  applyStreamEvent: (event: WorkflowStreamEvent) => void
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
  resultFocusPhaseId: null,
  failureFocusPhaseId: null,
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
        const current = get()
        const view = deriveView(detail.run.status)
        const activePhaseId = findActivePhaseId(detail.steps)
        const resultFocusPhaseId = findResultFocusPhaseId(detail.run.status, detail.steps)
        const failureFocusPhaseId = findFailureFocusPhaseId(detail.run.status, detail.steps)
        const focusPhaseId = resultFocusPhaseId ?? failureFocusPhaseId ?? activePhaseId
        const expandedPhaseIds = new Set(current.expandedPhaseIds)
        if (focusPhaseId) expandedPhaseIds.add(focusPhaseId)
        const isSameRun = current.run?.id === detail.run.id
        const proposalVersionChanged =
          current.run?.proposal_version !== detail.run.proposal_version
        const shouldSyncProposal =
          !isSameRun || proposalVersionChanged || !current.proposalDirty
        set({
          runId: detail.run.id,
          run: detail.run,
          steps: detail.steps,
          events: detail.events,
          view,
          activePhaseId,
          resultFocusPhaseId,
          failureFocusPhaseId,
          expandedPhaseIds,
          error: detail.run.error,
          approvalPending: detail.run.status === "waiting_approval",
          ...(shouldSyncProposal
            ? {
                editedProposal: detail.run.proposal_text,
                proposalDirty: false,
              }
            : {}),
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
        const expandedPhaseIds = new Set(get().expandedPhaseIds)
        if (progress.status === "failed" || progress.status === "succeeded") {
          expandedPhaseIds.add(progress.phase_id)
        }
        set({
          steps: updated,
          activePhaseId: progress.status === "started" || progress.status === "running" || progress.status === "failed"
            ? progress.phase_id
            : get().activePhaseId,
          failureFocusPhaseId: progress.status === "failed" ? progress.phase_id : get().failureFocusPhaseId,
          expandedPhaseIds,
        })
      },

      applyStreamEvent: (event) => {
        if ("detail" in event && event.detail) {
          get().setRunDetail(event.detail)
          return
        }
        if (event.type === "workflow.progress") {
          get().applyProgress(event.progress)
          return
        }
        if (event.type === "workflow.compile_result") {
          set({ compileErrors: event.compile_result.errors })
        }
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
  const failed = [...steps].reverse().find((s) => s.status === "failed")
  if (failed) return failed.phase_id
  return null
}

function findResultFocusPhaseId(status: WorkflowRunStatus, steps: WorkflowStepRun[]): string | null {
  if (status !== "completed" && status !== "awaiting_plan_edit") return null
  const succeeded = [...steps].reverse().find((s) => s.status === "succeeded")
  return succeeded?.phase_id ?? null
}

function findFailureFocusPhaseId(status: WorkflowRunStatus, steps: WorkflowStepRun[]): string | null {
  if (status !== "failed" && status !== "cancelled") return null
  const failed = [...steps].reverse().find((s) => s.status === "failed" || s.error)
  return failed?.phase_id ?? null
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
