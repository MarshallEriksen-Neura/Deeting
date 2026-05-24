"use client"

import { AlertTriangle, ListChecks } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { ScrollArea } from "@/ui/shadcn/scroll-area"
import { PlanPhaseCard } from "./plan-phase-card"
import type { PlanPhaseData } from "./plan-phase-card"
import type { CompilerError } from "@/lib/workflow/types"

export type { PlanPhaseData } from "./plan-phase-card"

interface PlanEditorProps {
  goal: string
  phases: PlanPhaseData[]
  compilerErrors: CompilerError[]
}

export function PlanEditor({
  goal,
  phases,
  compilerErrors,
}: PlanEditorProps) {
  const t = useI18n("workflow")

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--ios-shell-bg)]">
      <div className="flex items-center justify-between border-b border-[color:var(--ios-shell-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white/90">
                {t("plan.title")}
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-white/[0.07] dark:text-white/45">
                {phases.length} steps
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Runtime plan observation</p>
          </div>
        </div>
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

          <div className="relative pl-2">
            <div className="absolute bottom-6 left-[18px] top-6 w-px bg-slate-200 dark:bg-white/10" />
            {phases.map((phase, index) => (
              <PlanPhaseCard
                key={phase.phase_id}
                phase={phase}
                index={index}
              />
            ))}
          </div>

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
    </div>
  )
}
