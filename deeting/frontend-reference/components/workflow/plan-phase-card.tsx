"use client"

import { GripVertical, Trash2 } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Input } from "@/ui/shadcn/input"
import { Textarea } from "@/ui/shadcn/textarea"
import { Button } from "@/ui/shadcn/button"
import { Badge } from "@/ui/shadcn/badge"
import { Card } from "@/ui/shadcn/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip"

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
  onChange: (updated: PlanPhaseData) => void
  onDelete: () => void
  disabled?: boolean
}

export function PlanPhaseCard({
  phase,
  index,
  totalPhases,
  onChange,
  onDelete,
  disabled,
}: PlanPhaseCardProps) {
  const t = useI18n("workflow")

  function update(partial: Partial<PlanPhaseData>) {
    onChange({ ...phase, ...partial })
  }

  return (
    <Card className="group relative overflow-hidden rounded-[24px] border-[color:var(--ios-shell-border)] bg-[color:var(--ios-shell-subtle)] p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.28)] backdrop-blur-xl transition-colors hover:border-white/60 dark:hover:border-white/12">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-10 rounded-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.58),transparent_72%)] opacity-70 dark:opacity-20" />
      <div className="relative flex items-start gap-3">
        {/* Left: Index badge + drag handle */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <Badge variant="outline" className="h-7 w-7 justify-center rounded-full border-white/70 bg-white/75 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:border-white/12 dark:bg-white/10">
            {index + 1}
          </Badge>
          <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Right: Fields */}
        <div className="flex-1 space-y-3 min-w-0">
          {/* Title */}
          <Input
            value={phase.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder={t("plan.phaseTitle")}
            className="h-9 rounded-[18px] border-transparent bg-transparent px-2 text-sm font-semibold focus:border-[color:var(--ios-shell-border)] focus:bg-background/60"
            disabled={disabled}
          />

          {/* Goal */}
          <Textarea
            value={phase.goal}
            onChange={(e) => update({ goal: e.target.value })}
            placeholder={t("plan.phaseGoal")}
            className="min-h-[64px] rounded-[18px] border-transparent bg-transparent px-2 py-2 text-sm text-muted-foreground focus:border-[color:var(--ios-shell-border)] focus:bg-background/60"
            disabled={disabled}
          />

          {/* Worker + Depends */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground/60">{t("plan.worker")}:</span>
              <Input
                value={phase.worker_ref}
                onChange={(e) => update({ worker_ref: e.target.value })}
                placeholder={t("plan.noWorker")}
                className="h-7 w-52 rounded-full border-transparent bg-background/35 px-3 text-xs focus:border-[color:var(--ios-shell-border)] focus:bg-background/60"
                disabled={disabled}
              />
            </div>
            {phase.depends_on.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground/60">{t("plan.dependsOn")}:</span>
                {phase.depends_on.map((dep) => (
                  <Badge key={dep} variant="secondary" className="h-6 rounded-full px-2.5 text-[10px]">
                    {dep}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Delete button */}
        {totalPhases > 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 text-muted-foreground transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={onDelete}
                disabled={disabled}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("plan.deletePhase")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </Card>
  )
}
