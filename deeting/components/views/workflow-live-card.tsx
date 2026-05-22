"use client"

import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Loader2,
  PanelRightOpen,
  PencilLine,
} from "lucide-react"
import { motion } from "framer-motion"
import { Button } from "@/ui/shadcn/button"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/store/chat-store"
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

function StepDot({ status }: { status: string }) {
  const base = "absolute -left-[20px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border"
  switch (status) {
    case "succeeded":
      return <div className={cn(base, "border-emerald-500 bg-emerald-500")} />
    case "running":
      return (
        <div className="absolute -left-[22px] top-1/2 h-3.5 w-3.5 -translate-y-1/2">
          <div className="absolute inset-0 rounded-full bg-sky-500/20 animate-ping" />
          <div className="absolute inset-1 rounded-full bg-sky-500" />
        </div>
      )
    case "failed":
      return <div className={cn(base, "border-rose-500 bg-rose-500")} />
    default:
      return <div className={cn(base, "border-slate-300 bg-white dark:border-white/20 dark:bg-slate-950")} />
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
        进行中
      </span>
    )
  }
  if (status === "succeeded") {
    return (
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-white/[0.06] dark:text-white/45">
        已完成
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
        失败
      </span>
    )
  }
  return null
}

export default function WorkflowLiveCard({ data }: NativeViewProps) {
  const payload = toPayload(data)
  const setInput = useChatStore((state) => state.setInput)
  const openWorkspaceView = useWorkspaceStore((state) => state.openView)
  if (!payload) return null

  const { steps, status, goal, total_phases } = payload
  const isRunning = status === "running" || status === "waiting_approval"
  const isFailed = status === "failed" || status === "cancelled"
  const completedCount = steps.filter((step) => step.status === "succeeded").length
  const runningStep = steps.find((step) => step.status === "running")
  const currentStep =
    runningStep ??
    steps.find((step) => step.status !== "succeeded") ??
    steps[steps.length - 1]
  const progressPercent = Math.min(
    100,
    total_phases > 0 ? Math.round((completedCount / total_phases) * 100) : 0,
  )

  const handleAdjustPlan = () => {
    setInput("调整当前执行计划：")
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("textarea")?.focus()
    })
  }

  const handleOpenInspector = () => {
    openWorkspaceView({
      id: `workflow-${payload.run_id}`,
      type: "native-canvas",
      title: "Run Inspector",
      keepAlive: true,
      content: {
        viewType: "workflow",
        goal,
        runId: payload.run_id,
      },
    })
  }

  return (
    <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/78 shadow-[0_22px_54px_-42px_rgba(15,23,42,0.45)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.045]">
      <div className="px-5 pb-4 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2 text-[11px] font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-white/10 dark:bg-white/[0.06] dark:text-white/75">
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                ) : isFailed ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                )}
                {isRunning ? "正在执行" : isFailed ? "执行中断" : "已完成"}
              </span>
              <span className="font-mono text-[11px] text-slate-400 dark:text-white/35">
                {completedCount}/{total_phases}
              </span>
            </div>
            <div>
              <h3 className="line-clamp-1 text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white/90">
                {currentStep?.title || payload.title || "执行计划"}
              </h3>
              <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-slate-500 dark:text-white/45">
                {currentStep?.goal || goal}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-2.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-white/50 dark:hover:bg-white/[0.08] dark:hover:text-white/85"
              onClick={handleAdjustPlan}
            >
              <PencilLine className="mr-1.5 h-3.5 w-3.5" />
              调整
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-2.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-white/50 dark:hover:bg-white/[0.08] dark:hover:text-white/85"
              onClick={handleOpenInspector}
            >
              <PanelRightOpen className="mr-1.5 h-3.5 w-3.5" />
              详情
            </Button>
          </div>
        </div>

        <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-slate-800 transition-transform duration-500 dark:bg-white/75"
            style={{ transform: `translateX(-${100 - progressPercent}%)` }}
          />
        </div>
      </div>

      {steps.length > 0 ? (
        <div className="border-t border-slate-200/70 px-5 py-3 dark:border-white/10">
          <div className="relative pl-5">
            <div className="absolute bottom-2 left-[5px] top-2 w-px bg-slate-200 dark:bg-white/10" />
            {steps.map((step, idx) => {
              const isVisible =
                step.status === "running" ||
                step.status === "failed" ||
                idx === Math.max(0, completedCount - 1) ||
                idx === completedCount
              if (!isVisible) return null

              return (
                <motion.div
                  key={step.phase_id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.02 }}
                  className="relative py-1.5"
                >
                  <StepDot status={step.status} />
                  <div
                    className={cn(
                      "flex items-start gap-2 rounded-xl px-3 py-2",
                      step.status === "running" && "bg-slate-100/80 dark:bg-white/[0.06]",
                      step.status === "failed" && "bg-rose-50 dark:bg-rose-500/10",
                    )}
                  >
                    <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-slate-800 dark:text-white/80">
                          {step.title || step.phase_id}
                        </span>
                        <StatusBadge status={step.status} />
                      </div>
                      {step.error ? (
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-rose-600/80 dark:text-rose-300/80">
                          {step.error}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="border-t border-slate-200/70 px-5 py-3 text-xs text-slate-500 dark:border-white/10 dark:text-white/45">
          正在准备执行步骤...
        </div>
      )}
    </div>
  )
}
