"use client"

import { useState } from "react"
import { Check, Pencil, Play, RefreshCw, X } from "lucide-react"
import { motion } from "framer-motion"
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

// Replace a phase's goal in the raw markdown proposal text.
// Returns null when the phase block cannot be located.
function rewritePhaseInProposal(
  proposalText: string,
  phaseIndex: number,
  newTitle: string,
  newGoal: string,
): string | null {
  const lines = proposalText.split("\n")
  let headerIdx = -1
  let seen = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Phase\s+\d+/i.test(lines[i])) {
      seen += 1
      if (seen === phaseIndex) {
        headerIdx = i
        break
      }
    }
  }
  if (headerIdx === -1) return null

  // Replace the title on the header line
  const headerMatch = lines[headerIdx].match(/^(##\s+Phase\s+\d+):/i)
  if (headerMatch) {
    lines[headerIdx] = `${headerMatch[1]}: ${newTitle.trim()}`
  }

  // Find and replace the next "Goal:" line in this phase block
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break
    const goalMatch = lines[i].match(/^(\s*-\s*Goal:)/i)
    if (goalMatch) {
      lines[i] = `${goalMatch[1]} ${newGoal.trim()}`
      return lines.join("\n")
    }
  }
  return null
}

export default function WorkflowPlanCard({ data }: NativeViewProps) {
  const payload = toPayload(data)
  const editedProposal = useWorkflowStore((s) => s.editedProposal)
  const setEditedProposal = useWorkflowStore((s) => s.setEditedProposal)
  const closeWorkspaceView = useWorkspaceStore((s) => s.closeView)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftGoal, setDraftGoal] = useState("")
  const [acting, setActing] = useState(false)

  if (!payload) return null

  const startEdit = (idx: number, phase: PlanPhasePreview) => {
    setEditingIdx(idx)
    setDraftTitle(phase.title)
    setDraftGoal(phase.goal)
  }

  const cancelEdit = () => {
    setEditingIdx(null)
    setDraftTitle("")
    setDraftGoal("")
  }

  const saveEdit = (idx: number) => {
    const source = editedProposal ?? ""
    const next = rewritePhaseInProposal(source, idx, draftTitle, draftGoal)
    if (next != null) {
      setEditedProposal(next)
    }
    cancelEdit()
  }

  const handleStart = async () => {
    setActing(true)
    try {
      const store = useWorkflowStore.getState()
      if (store.editedProposal && store.runId) {
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
              if (
                event.type === "workflow.compile_result" &&
                event.compile_result.errors.length === 0
              ) {
                store.markProposalClean()
              }
            },
          },
        )
        closeWorkspaceView(`workflow-${store.runId}`)
      }
    } finally {
      setActing(false)
    }
  }

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

          {payload.phases.map((phase, idx) => {
            const isEditing = editingIdx === idx
            return (
              <div key={phase.phase_id} className="relative pb-3 last:pb-0">
                {/* Dot */}
                <div className="absolute -left-6 top-2.5 h-3 w-3 rounded-full border-2 border-border bg-card" />

                {isEditing ? (
                  <div className="rounded-lg border border-primary/40 bg-background/60 p-2.5 space-y-2">
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder="这一步要做什么（一句话）"
                      className="w-full px-2 py-1 text-[13px] font-medium bg-transparent border-b border-border/60 focus:outline-none focus:border-primary"
                      autoFocus
                    />
                    <textarea
                      value={draftGoal}
                      onChange={(e) => setDraftGoal(e.target.value)}
                      placeholder="具体目标 / 期望结果"
                      rows={2}
                      className="w-full px-2 py-1 text-xs text-muted-foreground bg-transparent border-b border-border/40 focus:outline-none focus:border-primary resize-none"
                    />
                    <div className="flex items-center justify-end gap-1 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={cancelEdit}
                      >
                        <X className="h-3 w-3 mr-1" />
                        取消
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 px-2.5 text-xs"
                        onClick={() => saveEdit(idx)}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        保存
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(idx, phase)}
                    className={cn(
                      "group w-full text-left rounded-lg px-2.5 py-1.5",
                      "hover:bg-muted/40 transition-colors",
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
                      <Pencil className="h-3 w-3 mt-1 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors shrink-0" />
                    </div>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer action */}
      <div className="border-t border-border/50 px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {payload.phases.length} 步 · 点任意一步可微调
        </span>
        <motion.div whileTap={{ scale: 0.97 }}>
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => void handleStart()}
            disabled={acting}
          >
            {acting ? (
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            开始执行
          </Button>
        </motion.div>
      </div>
    </div>
  )
}
