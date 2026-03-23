"use client"

import { GripVertical, Trash2 } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

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
    <Card className="group relative bg-card/40 backdrop-blur-sm border-border/50 p-4 transition-colors hover:border-border/80">
      <div className="flex items-start gap-3">
        {/* Left: Index badge + drag handle */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <Badge variant="outline" className="h-6 w-6 justify-center rounded-full text-xs">
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
            className="h-8 border-transparent bg-transparent px-0 text-sm font-medium focus:border-border focus:bg-background/50"
            disabled={disabled}
          />

          {/* Goal */}
          <Textarea
            value={phase.goal}
            onChange={(e) => update({ goal: e.target.value })}
            placeholder={t("plan.phaseGoal")}
            className="min-h-[44px] resize-none border-transparent bg-transparent px-0 text-sm text-muted-foreground focus:border-border focus:bg-background/50"
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
                className="h-6 w-48 border-transparent bg-transparent px-1 text-xs focus:border-border focus:bg-background/50"
                disabled={disabled}
              />
            </div>
            {phase.depends_on.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground/60">{t("plan.dependsOn")}:</span>
                {phase.depends_on.map((dep) => (
                  <Badge key={dep} variant="secondary" className="text-xs h-5">
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
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
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
