"use client"

import { useMemo, useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  AlertTriangle,
  ExternalLink,
  XCircle,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/ui/shadcn/button"
import { cn } from "@/lib/utils"
import { useWorkspaceStore } from "@/store/workspace-store"
import type { NativeViewProps } from "./registry"

interface WorkflowLiveStep {
  phase_id: string
  title: string
  status: string
  goal?: string | null
  error?: string | null
}

interface WorkflowLivePayload {
  run_id: string
  status: string
  title: string
  goal: string
  current_phase_index: number
  total_phases: number
  steps: WorkflowLiveStep[]
}

function toPayload(data: unknown): WorkflowLivePayload | null {
  if (!data || typeof data !== "object") return null
  return data as WorkflowLivePayload
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
    case "running":
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 shrink-0 animate-spin" />
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
    case "skipped":
    case "cancelled":
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
  }
}

export default function WorkflowLiveCard({ data }: NativeViewProps) {
  const payload = toPayload(data)
  const openView = useWorkspaceStore((state) => state.openView)
  const [showSteps, setShowSteps] = useState(false)

  if (!payload) return null

  const { steps, current_phase_index, total_phases, status } = payload
  const isRunning = status === "running" || status === "waiting_approval"
  const isFailed = status === "failed" || status === "cancelled"
  const runningStep = steps.find((s) => s.status === "running")
  const completedCount = steps.filter((s) => s.status === "succeeded").length
  const progressPercent = total_phases > 0 ? Math.round((completedCount / total_phases) * 100) : 0

  const openWorkflowPanel = () => {
    openView({
      id: `workflow-monitor-${payload.run_id}`,
      type: "native-canvas",
      title: "Workflow Monitor",
      keepAlive: true,
      content: {
        viewType: isRunning ? "workflow.monitor" : "workflow",
        runId: payload.run_id,
      },
    })
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card/80 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {isRunning ? (
              <Loader2 className="h-4 w-4 text-blue-500 shrink-0 animate-spin" />
            ) : isFailed ? (
              <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            )}
            <span className="text-sm font-medium text-foreground truncate">
              {isRunning ? "正在执行任务..." : isFailed ? "任务执行失败" : payload.title}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
            onClick={openWorkflowPanel}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            详情
          </Button>
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {runningStep
                  ? runningStep.title
                  : `步骤 ${current_phase_index + 1}/${total_phases}`}
              </span>
              <span className="tabular-nums">{completedCount}/{total_phases}</span>
            </div>
            <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-blue-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(progressPercent, 4)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Collapsible step list */}
      {steps.length > 0 && (
        <div className="border-t border-border/50">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setShowSteps(!showSteps)}
          >
            {showSteps ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>
              {isRunning
                ? `执行步骤 (${completedCount}/${total_phases})`
                : `查看 ${total_phases} 个执行步骤`}
            </span>
          </button>

          <AnimatePresence>
            {showSteps && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3 space-y-1">
                  {steps.map((step) => (
                    <div
                      key={step.phase_id}
                      className={cn(
                        "flex items-center gap-2 py-1.5 px-2 rounded-md text-xs transition-colors",
                        step.status === "running" && "bg-blue-500/5",
                        step.status === "failed" && "bg-rose-500/5",
                      )}
                    >
                      <StepStatusIcon status={step.status} />
                      <span
                        className={cn(
                          "flex-1 truncate",
                          step.status === "running"
                            ? "text-foreground font-medium"
                            : step.status === "succeeded"
                              ? "text-foreground/80"
                              : step.status === "failed"
                                ? "text-rose-600"
                                : "text-muted-foreground/60",
                        )}
                      >
                        {step.title || step.phase_id}
                      </span>
                      {step.error && (
                        <span className="text-[10px] text-rose-500 truncate max-w-[120px]">
                          {step.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
