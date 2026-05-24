"use client"

import { Circle } from "lucide-react"
import { cn } from "@/lib/utils"
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

  if (!payload) return null

  return (
    <div className="rounded-xl border border-border/80 bg-card/80 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          准备开始
        </div>
        <p className="text-sm text-foreground leading-snug line-clamp-2">
          {payload.goal}
        </p>
      </div>

      {/* Vertical timeline */}
      <div className="px-4 pb-3">
        <div className="relative pl-6">
          {/* Spine */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

          {payload.phases.map((phase) => {
            return (
              <div key={phase.phase_id} className="relative pb-3 last:pb-0">
                <div className="absolute -left-6 top-2.5 flex h-3 w-3 items-center justify-center rounded-full border border-border bg-card">
                  <Circle className="h-1.5 w-1.5 fill-muted-foreground text-muted-foreground" />
                </div>

                <div
                  className={cn(
                    "rounded-lg px-2.5 py-1.5",
                    "border border-transparent bg-transparent",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground/90 leading-snug">
                        {phase.title || "未命名步骤"}
                      </div>
                      {phase.goal ? (
                        <div className="text-[11.5px] text-muted-foreground/80 mt-0.5 line-clamp-2 leading-snug">
                          {phase.goal}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t border-border/50 px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          {payload.phases.length} 步
        </span>
      </div>
    </div>
  )
}
