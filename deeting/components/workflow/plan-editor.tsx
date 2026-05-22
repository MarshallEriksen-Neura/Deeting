"use client"

import { useState, useCallback } from "react"
import { AlertTriangle, ArrowLeft, ListChecks, Plus, RefreshCw } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/ui/shadcn/button"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { TooltipProvider } from "@/ui/shadcn/tooltip"
import { useChatModels } from "@/hooks/use-chat-models"
import { PlanPhaseCard } from "./plan-phase-card"
import type { PlanPhaseData } from "./plan-phase-card"
import type { CompilerError } from "@/lib/workflow/types"

export type { PlanPhaseData } from "./plan-phase-card"

interface PlanEditorProps {
  goal: string
  phases: PlanPhaseData[]
  compilerErrors: CompilerError[]
  onPhasesChange: (phases: PlanPhaseData[]) => void
  onCompileAndStart: () => Promise<void>
  onRegenerate: () => Promise<void>
  onBack: () => void
  disabled?: boolean
}

export function PlanEditor({
  goal,
  phases,
  compilerErrors,
  onPhasesChange,
  onCompileAndStart,
  onRegenerate,
  onBack,
  disabled,
}: PlanEditorProps) {
  const t = useI18n("workflow")
  const [compiling, setCompiling] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const { modelGroups, isLoadingModels } = useChatModels({ modelCapability: "chat" })

  const handlePhaseChange = useCallback(
    (index: number, updated: PlanPhaseData) => {
      const next = [...phases]
      next[index] = updated
      onPhasesChange(next)
    },
    [phases, onPhasesChange],
  )

  const handlePhaseDelete = useCallback(
    (index: number) => {
      const next = phases.filter((_, i) => i !== index)
      // Re-index phase_ids
      const reindexed = next.map((p, i) => ({ ...p, phase_id: `phase-${i + 1}` }))
      onPhasesChange(reindexed)
    },
    [phases, onPhasesChange],
  )

  const handleAddPhase = useCallback(() => {
    const newId = `phase-${phases.length + 1}`
    const prev = phases.length > 0 ? phases[phases.length - 1].phase_id : undefined
    onPhasesChange([
      ...phases,
      {
        phase_id: newId,
        title: "",
        worker_ref: "direct_llm:default",
        goal: "",
        depends_on: prev ? [prev] : [],
        user_notes: "",
      },
    ])
  }, [phases, onPhasesChange])

  async function handleCompile() {
    setCompiling(true)
    try {
      await onCompileAndStart()
    } finally {
      setCompiling(false)
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      await onRegenerate()
    } finally {
      setRegenerating(false)
    }
  }

  const isDisabled = disabled || compiling || regenerating

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--ios-shell-bg)]">
      <div className="flex items-center justify-between border-b border-[color:var(--ios-shell-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ios" size="icon-sm" className="size-8 rounded-full" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white/90">
                {t("plan.title")}
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-white/[0.07] dark:text-white/45">
                {phases.length} steps
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Review the draft before execution</p>
          </div>
        </div>
        <Button
          variant="ios"
          size="sm"
          onClick={handleRegenerate}
          disabled={isDisabled}
          className="h-8 rounded-full px-3 text-xs"
        >
          <RefreshCw className={`mr-1.5 h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
          {regenerating ? t("plan.regenerating") : t("plan.regenerate")}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 pb-5 pt-4">
          <div className="mb-5 rounded-[22px] border border-slate-200/70 bg-white/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.045]">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-white/35">
              <ListChecks className="h-3.5 w-3.5" />
              {t("plan.goalLabel")}
            </div>
            <p className="text-sm font-medium leading-6 text-slate-800 dark:text-white/80">
              {goal}
            </p>
          </div>

          <TooltipProvider>
            <div className="relative pl-2">
              <div className="absolute bottom-6 left-[18px] top-6 w-px bg-slate-200 dark:bg-white/10" />
              {phases.map((phase, index) => (
                <PlanPhaseCard
                  key={phase.phase_id}
                  phase={phase}
                  index={index}
                  totalPhases={phases.length}
                  modelGroups={modelGroups}
                  isLoadingModels={isLoadingModels}
                  onChange={(updated) => handlePhaseChange(index, updated)}
                  onDelete={() => handlePhaseDelete(index)}
                  disabled={isDisabled}
                />
              ))}
            </div>
          </TooltipProvider>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleAddPhase}
            disabled={isDisabled}
            className="ml-8 mt-2 h-9 rounded-full px-3 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-white/50 dark:hover:bg-white/[0.07] dark:hover:text-white/80"
          >
            <Plus className="mr-1.5 h-3 w-3" />
            {t("plan.addPhase")}
          </Button>

          {compilerErrors.length > 0 && (
            <div className="mt-5 space-y-2 rounded-[20px] border border-destructive/20 bg-destructive/5 p-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {t("plan.compilerErrors")}
              </div>
              {compilerErrors.map((err, i) => (
                <div key={i} className="pl-5 text-xs text-destructive/80">
                  {err.phase_id && <span className="font-mono">{err.phase_id}: </span>}
                  {err.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-bg)]/92 p-4 backdrop-blur-2xl">
        <Button
          className="h-11 w-full rounded-[14px] bg-zinc-900 text-[13px] font-medium text-white shadow-[0_16px_32px_-24px_rgba(15,23,42,0.9)] transition-transform hover:scale-[1.005] hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-white/90"
          size="xl"
          onClick={handleCompile}
          disabled={isDisabled || phases.length === 0}
        >
          {compiling ? t("plan.compiling") : t("plan.compileAndStart")}
        </Button>
      </div>
    </div>
  )
}
