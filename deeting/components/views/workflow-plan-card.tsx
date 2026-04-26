"use client"

import { useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  ListChecks,
  Play,
  RefreshCw,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/ui/shadcn/button"
import { cn } from "@/lib/utils"
import { useWorkspaceStore } from "@/store/workspace-store"
import { useWorkflowStore } from "@/store/workflow-store"
import type { NativeViewProps } from "./registry"

interface PlanPhasePreview {
  phase_id: string
  title: string
  goal: string
  worker_ref: string
  depends_on: string[]
}

interface WorkflowPlanPayload {
  run_id: string
  title: string
  goal: string
  phases: PlanPhasePreview[]
}

function toPayload(data: unknown): WorkflowPlanPayload | null {
  if (!data || typeof data !== "object") return null
  return data as WorkflowPlanPayload
}

export default function WorkflowPlanCard({ data }: NativeViewProps) {
  const payload = toPayload(data)
  const openView = useWorkspaceStore((state) => state.openView)
  const [showPhases, setShowPhases] = useState(true)
  const [acting, setActing] = useState(false)

  if (!payload) return null

  const openEditorPanel = () => {
    openView({
      id: `workflow-${payload.run_id}`,
      type: "native-canvas",
      title: "Workflow",
      keepAlive: true,
      content: {
        viewType: "workflow",
        runId: payload.run_id,
      },
    })
  }

  const handleApproveAndStart = async () => {
    setActing(true)
    try {
      // Get the workflow store and trigger compile + start
      const store = useWorkflowStore.getState()
      if (store.editedProposal && store.runId) {
        // The store already has the proposal loaded — trigger compile
        // This delegates to the same flow as PlanEditor's "compile and start"
        const { streamWorkflowCompileAndStart } = await import("@/lib/workflow/commands")
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
      }
    } catch {
      // Fallback: open editor panel for manual start
      openEditorPanel()
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card/80 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ListChecks className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">
              执行计划已就绪
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {payload.phases.length} 个步骤
          </span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {payload.goal}
        </p>
      </div>

      {/* Phase list */}
      <div className="border-t border-border/50">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          onClick={() => setShowPhases(!showPhases)}
        >
          {showPhases ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>执行步骤</span>
        </button>

        <AnimatePresence>
          {showPhases && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-1.5">
                {payload.phases.map((phase, i) => (
                  <div
                    key={phase.phase_id}
                    className="flex items-start gap-2 py-1.5 px-2 rounded-md text-xs bg-muted/20"
                  >
                    <span className="text-muted-foreground/60 tabular-nums shrink-0 pt-0.5">
                      {i + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-foreground/90">
                        {phase.title}
                      </span>
                      {phase.goal && (
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-1">
                          {phase.goal}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Action buttons */}
      <div className="border-t border-border/50 px-4 py-2.5 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs text-muted-foreground"
          onClick={openEditorPanel}
        >
          <Edit3 className="h-3 w-3 mr-1" />
          编辑计划
        </Button>
        <Button
          size="sm"
          className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => void handleApproveAndStart()}
          disabled={acting}
        >
          {acting ? (
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Play className="h-3 w-3 mr-1" />
          )}
          开始执行
        </Button>
      </div>
    </div>
  )
}
