"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useWorkflowStore } from "@/store/workflow-store"
import { useChatStore } from "@/store/chat-store"
import { matchesChatModelSelectionValue } from "@/lib/api/models"
import {
  generateWorkflowProposal,
  getWorkflowRunStatus,
  getWorkflowArtifactContent,
} from "@/lib/workflow/commands"
import { getUserVisibleWorkflowArtifactRefs } from "@/lib/workflow/presentation"
import type { WorkflowArtifactContent, WorkflowStepRun } from "@/lib/workflow/types"
import { WorkflowLanding } from "./workflow-landing"
import { PlanEditor } from "./plan-editor"
import type { PlanPhaseData } from "./plan-phase-card"
import { WorkflowExecution } from "./workflow-execution"
import { RuntimePlanPanel } from "./runtime-plan-panel"
import { PhaseResultViewer } from "./phase-context-viewer"

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
}: WorkflowRuntimeProps) {
  const store = useWorkflowStore()
  const {
    activePhaseId,
    closeContextViewer,
    compileErrors,
    contextViewerPhaseId,
    editedProposal,
    events,
    expandedPhaseIds,
    failureFocusPhaseId,
    openContextViewer,
    resultFocusPhaseId,
    run,
    runId,
    setActivePhaseId,
    setError,
    setLoading,
    setRun,
    setRunDetail,
    steps,
    togglePhaseExpanded,
    view,
  } = store
  const chatModelSelection = useChatStore((state) => state.config.model)
  const chatModels = useChatStore((state) => state.models)
  const [phaseResult, setPhaseResult] = useState<{
    phaseId: string
    phaseTitle: string
    artifact: WorkflowArtifactContent | null
  } | null>(null)
  const selectedChatModel = useMemo(
    () => chatModels.find((model) => matchesChatModelSelectionValue(model, chatModelSelection)),
    [chatModels, chatModelSelection],
  )
  const workflowExecutionModel = useMemo(() => ({
    execution_model_id: selectedChatModel?.id ?? chatModelSelection ?? null,
    execution_provider_model_id: selectedChatModel?.provider_model_id ?? chatModelSelection ?? null,
  }), [chatModelSelection, selectedChatModel])

  useEffect(() => {
    if (!initialRunId) return
    const initialActiveRunId = initialRunId.trim()
    if (!initialActiveRunId || (runId === initialActiveRunId && run)) return

    let cancelled = false

    async function hydrateRun() {
      try {
        const detail = await getWorkflowRunStatus(initialActiveRunId)
        if (!cancelled) {
          setRunDetail(detail)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
        }
      }
    }

    void hydrateRun()

    return () => {
      cancelled = true
    }
  }, [initialRunId, run, runId, setError, setRunDetail])

  useEffect(() => {
    const activeRunId = runId ?? initialRunId
    if (!activeRunId) return
    let cancelled = false
    let unlisten: (() => void) | null = null

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        unlisten = await listen<{ run_id?: string; runId?: string }>(
          "workflow:run-updated",
          async (event) => {
            const updatedRunId = event.payload?.run_id ?? event.payload?.runId
            if (!updatedRunId || updatedRunId !== activeRunId || cancelled) return
            try {
              const detail = await getWorkflowRunStatus(updatedRunId)
              if (!cancelled) setRunDetail(detail)
            } catch (err) {
              if (!cancelled) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }
          },
        )
      } catch {
        // Non-Tauri web previews do not expose the event bridge.
      }
    }

    void subscribe()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [initialRunId, runId, setError, setRunDetail])

  useEffect(() => {
    const phaseId = initialPhaseId?.trim()
    if (!phaseId) return
    setActivePhaseId(phaseId)
  }, [initialPhaseId, setActivePhaseId])

  const handleOpenResultViewer = useCallback(async (phaseId: string) => {
    if (!runId) return
    try {
      let step = findPhaseStep(steps, phaseId)
      if (!step) {
        const detail = await getWorkflowRunStatus(runId)
        setRunDetail(detail)
        step = findPhaseStep(detail.steps, phaseId)
      }
      if (!step) {
        throw new Error(`Phase not found in workflow run: ${phaseId}`)
      }
      const artifactRef = selectPhaseResultArtifactRef(step.output_artifact_refs)
      if (!artifactRef) {
        throw new Error(`No result artifact found for phase: ${phaseId}`)
      }
      const artifact = await getWorkflowArtifactContent(runId, artifactRef)
      setPhaseResult({
        phaseId: step.phase_id,
        phaseTitle: step.title || step.phase_id,
        artifact,
      })
      openContextViewer(phaseId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [openContextViewer, runId, setRunDetail, steps])

  useEffect(() => {
    const phaseId = initialContextPhaseId?.trim()
    if (!phaseId || !runId) return
    void handleOpenResultViewer(phaseId)
  }, [handleOpenResultViewer, initialContextPhaseId, runId])

  // --- Landing: create workflow ---
  const handleCreateWorkflow = useCallback(async (goal: string, hints?: string) => {
    setLoading(true)
    setError(null)
    try {
      const run = await generateWorkflowProposal({ goal, hints, ...workflowExecutionModel })
      setRun(run)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [setError, setLoading, setRun, workflowExecutionModel])

  // --- Parse proposal into phase cards ---
  const phases = editedProposal
    ? proposalMdToPhases(editedProposal)
    : []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-bg)] shadow-[0_28px_68px_-38px_rgba(15,23,42,0.42)] backdrop-blur-2xl">
      {/* Surface 1: Landing */}
      {view === "landing" && (
        <WorkflowLanding
          onCreateWorkflow={handleCreateWorkflow}
          initialGoal={initialGoal}
        />
      )}

      {/* Surface 2: Plan Editor */}
      {view === "editor" && run && (
        <PlanEditor
          goal={run.goal}
          phases={phases}
          compilerErrors={compileErrors}
        />
      )}

      {/* Surface 3: Execution observation */}
      {view === "execution" && run && (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex h-full min-h-0 flex-col overflow-hidden lg:flex-row">
            <div className="h-64 shrink-0 lg:h-full lg:w-[340px] xl:w-[380px]">
              <RuntimePlanPanel
                run={run}
                steps={steps}
                activePhaseId={activePhaseId}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2">
              <WorkflowExecution
                run={run}
                steps={steps}
                events={events}
                activePhaseId={activePhaseId}
                resultFocusPhaseId={resultFocusPhaseId}
                failureFocusPhaseId={failureFocusPhaseId}
                expandedPhaseIds={expandedPhaseIds}
                onToggleExpand={(id) => togglePhaseExpanded(id)}
                onViewResult={handleOpenResultViewer}
              />
            </div>
          </div>
        </div>
      )}

      {/* Surface 6: Phase Result Sheet */}
      <PhaseResultViewer
        open={contextViewerPhaseId !== null}
        onClose={() => closeContextViewer()}
        phaseId={phaseResult?.phaseId ?? contextViewerPhaseId ?? ""}
        phaseTitle={phaseResult?.phaseTitle ?? ""}
        artifact={phaseResult?.artifact ?? null}
      />
    </div>
  )
}

function findPhaseStep(steps: WorkflowStepRun[], phaseId: string): WorkflowStepRun | null {
  return [...steps]
    .reverse()
    .find((step) => step.phase_id === phaseId && step.status !== "obsolete") ?? null
}

function selectPhaseResultArtifactRef(refs: string[]): string | null {
  const visibleRefs = getUserVisibleWorkflowArtifactRefs(refs)
  return (
    visibleRefs.find((ref) => getArtifactFileName(ref).toLowerCase() === "result.md") ??
    visibleRefs.find((ref) => getArtifactFileName(ref).toLowerCase().endsWith(".md")) ??
    visibleRefs.find((ref) => {
      const name = getArtifactFileName(ref).toLowerCase()
      return name.endsWith(".txt") || name.endsWith(".log")
    }) ??
    visibleRefs[0] ??
    null
  )
}

function getArtifactFileName(ref: string): string {
  return ref.split(/[\\/]/).pop() || ref
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

// Re-export PlanPhaseData for external use
export type { PlanPhaseData } from "./plan-phase-card"
