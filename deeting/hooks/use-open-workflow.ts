"use client"

import { useCallback } from "react"
import { useWorkspaceStore } from "@/store/workspace-store"
import { useWorkflowStore } from "@/store/workflow-store"

/**
 * Hook to open a workflow view in the workspace panel.
 * Can be called from chat, sidebar, or any component.
 */
export function useOpenWorkflow() {
  const openView = useWorkspaceStore((s) => s.openView)
  const resetWorkflow = useWorkflowStore((s) => s.reset)

  const openWorkflow = useCallback(
    (options?: { goal?: string; runId?: string; surface?: "plan" | "inspector" }) => {
      // Reset workflow store for a fresh start
      if (!options?.runId) {
        resetWorkflow()
      }

      openView({
        id: options?.runId ? `workflow-${options.runId}` : `workflow-new-${Date.now()}`,
        type: "native-canvas",
        title: options?.surface === "inspector" ? "Run Inspector" : "Workflow",
        keepAlive: true,
        content: {
          viewType: "workflow",
          goal: options?.goal,
          runId: options?.runId,
        },
      })
    },
    [openView, resetWorkflow],
  )

  return openWorkflow
}
