"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
} from "@/ui/common/glass-card"
import { Bot } from "lucide-react"
import { useAssistantMab } from "@/lib/swr/use-routing-mab"

export const RoutingMabAssistantReport = memo(function RoutingMabAssistantReport() {
  const t = useTranslations("monitoring.routing.assistants")
  const { data, isLoading } = useAssistantMab()

  if (isLoading) {
    return (
      <div className="h-[240px] animate-pulse rounded-2xl bg-[var(--card)]/60 border border-white/10" />
    )
  }

  const assistants = data?.assistants ?? []
  const hasAssistants = assistants.length > 0

  return (
    <GlassCard padding="none" hover="none">
      <div className="p-6 pb-0">
        <GlassCardHeader>
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-sky-400" />
            <GlassCardTitle className="text-base">{t("title")}</GlassCardTitle>
          </div>
          <GlassCardDescription>{t("description")}</GlassCardDescription>
        </GlassCardHeader>
      </div>

      {hasAssistants ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.assistant")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] min-w-[120px]">
                  {t("columns.ratingScore")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] min-w-[120px]">
                  {t("columns.selectionRatio")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.feedback")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.trials")}
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.exploring")}
                </th>
              </tr>
            </thead>
            <tbody>
              {assistants.map((assistant) => {
                const ratingPct = (assistant.ratingScore * 100).toFixed(1)
                const selectionPct = (assistant.selectionRatio * 100).toFixed(1)
                const ratingColor =
                  assistant.ratingScore >= 0.85
                    ? "text-emerald-400"
                    : assistant.ratingScore >= 0.65
                      ? "text-amber-400"
                      : "text-rose-400"
                const ratingBarColor =
                  assistant.ratingScore >= 0.85
                    ? "bg-emerald-400/80"
                    : assistant.ratingScore >= 0.65
                      ? "bg-amber-400/80"
                      : "bg-rose-400/80"

                return (
                  <tr
                    key={assistant.assistantId}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-[var(--foreground)]">
                          {assistant.name ?? assistant.assistantId}
                        </span>
                        {assistant.summary ? (
                          <span className="text-xs text-[var(--muted)] line-clamp-1">
                            {assistant.summary}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              ratingBarColor
                            )}
                            style={{ width: `${Math.min(100, parseFloat(ratingPct))}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "text-xs font-mono font-medium w-12 text-right",
                            ratingColor
                          )}
                        >
                          {ratingPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--primary)]/70 transition-all duration-500"
                            style={{ width: `${Math.min(100, parseFloat(selectionPct))}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-[var(--muted)] w-12 text-right">
                          {selectionPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-[var(--foreground)]">
                        {assistant.positiveFeedback}/{assistant.negativeFeedback}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-[var(--foreground)]">
                        {assistant.totalTrials.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {assistant.isExploring ? (
                        <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                          {t("exploring")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 pt-4">
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-[var(--muted)]">
            {t("noAssistants")}
          </div>
        </div>
      )}
    </GlassCard>
  )
})
