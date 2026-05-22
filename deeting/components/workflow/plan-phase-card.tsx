"use client"

import { Trash2 } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Input } from "@/ui/shadcn/input"
import { Textarea } from "@/ui/shadcn/textarea"
import { Button } from "@/ui/shadcn/button"
import { Badge } from "@/ui/shadcn/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip"
import { ModelPickerField } from "@/components/models/model-picker-field"
import type { ModelGroup } from "@/lib/api/models"

export interface PlanPhaseData {
  phase_id: string
  title: string
  worker_ref: string
  goal: string
  depends_on: string[]
  user_notes: string
}

interface PlanPhaseCardProps {
  phase: PlanPhaseData
  index: number
  totalPhases: number
  modelGroups: ModelGroup[]
  isLoadingModels?: boolean
  onChange: (updated: PlanPhaseData) => void
  onDelete: () => void
  disabled?: boolean
}

const DIRECT_LLM_PREFIX = "direct_llm:"
const DEFAULT_WORKER_REF = "direct_llm:default"

function workerRefToModelValue(workerRef: string) {
  const trimmed = workerRef.trim()
  if (!trimmed || trimmed === DEFAULT_WORKER_REF) return ""
  if (trimmed.startsWith(DIRECT_LLM_PREFIX)) {
    return trimmed.slice(DIRECT_LLM_PREFIX.length)
  }
  return trimmed
}

function modelValueToWorkerRef(value: string) {
  const trimmed = value.trim()
  return trimmed ? `${DIRECT_LLM_PREFIX}${trimmed}` : DEFAULT_WORKER_REF
}

export function PlanPhaseCard({
  phase,
  index,
  totalPhases,
  modelGroups,
  isLoadingModels = false,
  onChange,
  onDelete,
  disabled,
}: PlanPhaseCardProps) {
  const t = useI18n("workflow")

  function update(partial: Partial<PlanPhaseData>) {
    onChange({ ...phase, ...partial })
  }

  return (
    <div className="group relative pl-8">
      <div className="absolute left-0 top-5 z-[1] flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 shadow-[0_10px_26px_-22px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-slate-950 dark:text-white/55">
        {index + 1}
      </div>

      <div className="relative mb-3 ml-5 rounded-[20px] border border-slate-200/70 bg-white/58 px-3.5 py-3 shadow-[0_18px_42px_-38px_rgba(15,23,42,0.5)] backdrop-blur-xl transition-colors hover:border-slate-300/80 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/16">
        <div className="mb-2 flex items-start justify-between gap-2">
          <Input
            value={phase.title}
            onChange={(event) => update({ title: event.target.value })}
            placeholder={t("plan.phaseTitle")}
            className="h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[15px] font-semibold tracking-tight text-slate-900 shadow-none focus-visible:ring-0 dark:text-white/88"
            disabled={disabled}
          />

          {totalPhases > 1 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 shrink-0 rounded-full text-slate-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:text-white/20 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                  onClick={onDelete}
                  disabled={disabled}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("plan.deletePhase")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        <Textarea
          value={phase.goal}
          onChange={(event) => update({ goal: event.target.value })}
          placeholder={t("plan.phaseGoal")}
          className="min-h-[76px] resize-none rounded-[16px] border-slate-200/70 bg-white/52 px-3 py-2 text-[13px] leading-5 text-slate-500 shadow-none focus:border-slate-300 focus:bg-white/75 focus-visible:ring-0 dark:border-white/8 dark:bg-white/[0.035] dark:text-white/45 dark:focus:bg-white/[0.06]"
          disabled={disabled}
        />

        <div className="mt-3 flex flex-wrap items-end gap-2 text-xs text-muted-foreground">
          <div className="min-w-[220px] flex-1">
            <ModelPickerField
              id={`workflow-phase-${phase.phase_id}-worker-model`}
              label={t("plan.worker")}
              placeholder={t("plan.workerModelPlaceholder")}
              value={workerRefToModelValue(phase.worker_ref)}
              onChange={(value) => update({ worker_ref: modelValueToWorkerRef(value) })}
              disabled={disabled || isLoadingModels}
              isLoading={isLoadingModels}
              loadingText={t("plan.workerModelLoading")}
              searchPlaceholder={t("plan.workerModelSearchPlaceholder")}
              emptyText={t("plan.workerModelEmpty")}
              noResultsText={t("plan.workerModelNoResults")}
              modelGroups={modelGroups}
              resolveValue={(_group, model) => model.provider_model_id ?? model.id}
            />
          </div>
          {phase.depends_on.length > 0 ? (
            <div className="flex max-w-full flex-wrap items-center gap-1 pb-1">
              <span className="text-[11px] text-slate-400 dark:text-white/35">{t("plan.dependsOn")}</span>
              {phase.depends_on.map((dep) => (
                <Badge
                  key={dep}
                  variant="secondary"
                  className="h-5 rounded-full bg-slate-100 px-2 text-[10px] font-normal text-slate-500 dark:bg-white/[0.06] dark:text-white/45"
                >
                  {dep}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
