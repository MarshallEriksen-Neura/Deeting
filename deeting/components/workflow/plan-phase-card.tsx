"use client"

import { GitBranch, UserRoundCog } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"
import { Badge } from "@/ui/shadcn/badge"

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
}

export function PlanPhaseCard({
  phase,
  index,
}: PlanPhaseCardProps) {
  const t = useI18n("workflow")
  const title = phase.title.trim() || phase.phase_id
  const goal = phase.goal.trim()
  const workerRef = phase.worker_ref.trim()
  const userNotes = phase.user_notes.trim()

  return (
    <div className="group relative pl-8">
      <div className="absolute left-0 top-5 z-[1] flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 shadow-[0_10px_26px_-22px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-slate-950 dark:text-white/55">
        {index + 1}
      </div>

      <div className="relative mb-3 ml-5 rounded-[20px] border border-slate-200/70 bg-white/58 px-3.5 py-3 shadow-[0_18px_42px_-38px_rgba(15,23,42,0.5)] backdrop-blur-xl transition-colors hover:border-slate-300/80 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/16">
        <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white/88">
              {title}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30">
              {phase.phase_id}
            </div>
          </div>
        </div>

        {goal ? (
          <p className="rounded-[16px] border border-slate-200/70 bg-white/52 px-3 py-2 text-[13px] leading-5 text-slate-500 dark:border-white/8 dark:bg-white/[0.035] dark:text-white/45">
            {goal}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {workerRef ? (
            <Badge
              variant="secondary"
              className="h-6 max-w-full rounded-full bg-slate-100 px-2 text-[10px] font-normal text-slate-500 dark:bg-white/[0.06] dark:text-white/45"
            >
              <UserRoundCog className="mr-1 h-3 w-3 shrink-0" />
              <span className="truncate">{workerRef}</span>
            </Badge>
          ) : null}
          {phase.depends_on.length > 0 ? (
            <div className="flex max-w-full flex-wrap items-center gap-1">
              <span className="text-[11px] text-slate-400 dark:text-white/35">{t("plan.dependsOn")}</span>
              {phase.depends_on.map((dep) => (
                <Badge
                  key={dep}
                  variant="secondary"
                  className="h-5 rounded-full bg-slate-100 px-2 text-[10px] font-normal text-slate-500 dark:bg-white/[0.06] dark:text-white/45"
                >
                  <GitBranch className="mr-1 h-3 w-3" />
                  {dep}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        {userNotes ? (
          <div className="mt-2 rounded-[12px] bg-slate-50/70 px-3 py-2 text-[12px] leading-5 text-slate-500 dark:bg-white/[0.035] dark:text-white/42">
            {userNotes}
          </div>
        ) : null}
      </div>
    </div>
  )
}
