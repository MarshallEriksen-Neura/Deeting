"use client"

import { Sparkles, Workflow } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
import { useI18n } from "@/hooks/use-i18n"

export function WorkflowSuggestionBar({
  onSwitchToWorkflow,
}: {
  onSwitchToWorkflow: () => void
}) {
  const t = useI18n("chat")

  return (
    <div className="rounded-2xl border border-violet-200/80 bg-white/95 p-3 text-slate-950 shadow-[0_20px_45px_-26px_rgba(109,40,217,0.35)] ring-1 ring-white/70 backdrop-blur-2xl dark:border-violet-400/20 dark:bg-[#151124]/95 dark:text-violet-50 dark:ring-white/5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300">
          <Sparkles className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[13px] font-semibold leading-none">
                {t("controls.workflowSuggestionTitle")}
              </p>
            </div>
            <p className="text-[11px] leading-4 text-slate-700/80 dark:text-violet-100/70">
              {t("controls.workflowSuggestionDescription")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-full border border-violet-300/60 bg-violet-500/8 px-2.5 text-[11px] font-medium text-violet-900 hover:bg-violet-500/14 hover:text-violet-950 dark:border-violet-400/20 dark:bg-violet-400/8 dark:text-violet-100 dark:hover:bg-violet-400/14 dark:hover:text-violet-50"
              onClick={onSwitchToWorkflow}
            >
              <Workflow className="mr-1.5 h-3.5 w-3.5" />
              {t("controls.switchToWorkflow")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
