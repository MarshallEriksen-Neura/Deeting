"use client"

import { useState, useCallback } from "react"
import { ArrowLeft, Plus, RefreshCw, AlertTriangle } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { TooltipProvider } from "@/components/ui/tooltip"
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[color:var(--ios-shell-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ios" size="icon-sm" className="size-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t("plan.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("plan.goalLabel")}</p>
          </div>
        </div>
        <Button
          variant="ios"
          size="sm"
          onClick={handleRegenerate}
          disabled={isDisabled}
          className="text-xs"
        >
          <RefreshCw className={`mr-1.5 h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
          {regenerating ? t("plan.regenerating") : t("plan.regenerate")}
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-5">
          {/* Goal display */}
          <div className="rounded-[24px] border border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] px-4 py-3 text-sm text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <span className="font-medium text-foreground">{t("plan.goalLabel")}:</span>{" "}
            {goal}
          </div>

          <Separator className="opacity-40" />

          {/* Phase list */}
          <TooltipProvider>
            <div className="space-y-3">
              {phases.map((phase, index) => (
                <PlanPhaseCard
                  key={phase.phase_id}
                  phase={phase}
                  index={index}
                  totalPhases={phases.length}
                  onChange={(updated) => handlePhaseChange(index, updated)}
                  onDelete={() => handlePhaseDelete(index)}
                  disabled={isDisabled}
                />
              ))}
            </div>
          </TooltipProvider>

          {/* Add phase */}
          <Button
            variant="ios"
            size="sm"
            onClick={handleAddPhase}
            disabled={isDisabled}
            className="text-xs"
          >
            <Plus className="mr-1.5 h-3 w-3" />
            {t("plan.addPhase")}
          </Button>

          {/* Compiler errors */}
          {compilerErrors.length > 0 && (
            <div className="space-y-2 rounded-[24px] border border-destructive/20 bg-destructive/5 p-4">
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

      {/* Footer */}
      <div className="border-t border-[color:var(--ios-shell-border)] p-5">
        <Button
          className="w-full"
          variant="ios-primary"
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
