"use client"

import { useCallback } from "react"
import { toast } from "sonner"

import {
  type ExecutionLifecyclePayload,
  type ExecutionTreeAction,
  type ExecutionTreeChild,
  asRenderBlockList,
  toText,
} from "@/lib/execution-tree/types"
import { rerunPhase } from "@/lib/workflow/commands"
import { useWorkspaceStore } from "@/store/workspace-store"

export function useExecutionActionDispatcher(payload: ExecutionLifecyclePayload) {
  const openWorkspaceView = useWorkspaceStore((state) => state.openView)

  const openWorkflowRun = useCallback(
    (phaseId?: string | null) => {
      const workflowRunId = toText(payload.target?.workflow_run_id)
      if (!workflowRunId) return
      openWorkspaceView({
        id: `workflow-${workflowRunId}`,
        type: "native-canvas",
        title: "Workflow",
        keepAlive: true,
        content: {
          viewType: "workflow",
          runId: workflowRunId,
          phaseId: phaseId ?? undefined,
        },
      })
    },
    [openWorkspaceView, payload.target?.workflow_run_id]
  )

  const openWorkflowContext = useCallback(
    (phaseId: string) => {
      const workflowRunId = toText(payload.target?.workflow_run_id)
      if (!workflowRunId) return
      openWorkspaceView({
        id: `workflow-${workflowRunId}`,
        type: "native-canvas",
        title: "Workflow",
        keepAlive: true,
        content: {
          viewType: "workflow",
          runId: workflowRunId,
          phaseId,
          contextPhaseId: phaseId,
        },
      })
    },
    [openWorkspaceView, payload.target?.workflow_run_id]
  )

  const rerunWorkflowPhase = useCallback(
    async (phaseId: string) => {
      const workflowRunId = toText(payload.target?.workflow_run_id)
      if (!workflowRunId) return
      try {
        await rerunPhase({ run_id: workflowRunId, phase_id: phaseId })
        openWorkflowRun(phaseId)
        toast.success(`Phase ${phaseId} queued for rerun`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [openWorkflowRun, payload.target?.workflow_run_id]
  )

  const openSingleWorkerResult = useCallback(() => {
    const resultBlocks = asRenderBlockList(payload.result_payload?.render_blocks)
    const resultBlock = resultBlocks[0]
    const viewType = toText(resultBlock?.view_type)
    if (!viewType || !resultBlock?.payload) return
    const executionId = toText(payload.execution_id) ?? `execution-${Date.now()}`
    const targetName = toText(payload.target?.name) ?? "Execution Result"
    openWorkspaceView({
      id: `execution-result-${executionId}`,
      type: "native-canvas",
      title: toText(resultBlock?.title) ?? targetName,
      keepAlive: true,
      content: {
        viewType,
        payload: resultBlock.payload,
        title: toText(resultBlock?.title) ?? undefined,
        metadata:
          resultBlock?.metadata && typeof resultBlock.metadata === "object"
            ? resultBlock.metadata
            : undefined,
      },
    })
  }, [openWorkspaceView, payload.execution_id, payload.result_payload, payload.target?.name])

  const dispatchAction = useCallback(
    async (action: ExecutionTreeAction, child?: ExecutionTreeChild) => {
      const kind = toText(action?.kind)
      const phaseId = toText(child?.phase_id)
      switch (kind) {
        case "open":
          openWorkflowRun(phaseId)
          return
        case "view_context":
          if (phaseId) {
            openWorkflowContext(phaseId)
          }
          return
        case "rerun":
          if (phaseId) {
            await rerunWorkflowPhase(phaseId)
          }
          return
        case "view_result":
          openSingleWorkerResult()
          return
        default:
          return
      }
    },
    [openSingleWorkerResult, openWorkflowContext, openWorkflowRun, rerunWorkflowPhase]
  )

  return { dispatchAction }
}
