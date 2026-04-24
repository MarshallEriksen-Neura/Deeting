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
import { Sparkles } from "lucide-react"
import { useSkillMab } from "@/lib/swr/use-routing-mab"

export const RoutingMabSkillReport = memo(function RoutingMabSkillReport() {
  const t = useTranslations("monitoring.routing.skills")
  const { data, isLoading } = useSkillMab()

  if (isLoading) {
    return (
      <div className="h-[240px] animate-pulse rounded-2xl bg-[var(--card)]/60 border border-white/10" />
    )
  }

  const skills = data?.skills ?? []
  const hasSkills = skills.length > 0

  return (
    <GlassCard padding="none" hover="none">
      <div className="p-6 pb-0">
        <GlassCardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-400" />
            <GlassCardTitle className="text-base">{t("title")}</GlassCardTitle>
          </div>
          <GlassCardDescription>{t("description")}</GlassCardDescription>
        </GlassCardHeader>
      </div>

      {hasSkills ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.skill")}
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.status")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] min-w-[120px]">
                  {t("columns.successRate")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] min-w-[120px]">
                  {t("columns.selectionRatio")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.latency")}
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("columns.exploring")}
                </th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill, idx) => {
                const successPct = (skill.successRate * 100).toFixed(1)
                const selectionPct = (skill.selectionRatio * 100).toFixed(1)
                const successColor =
                  skill.successRate >= 0.9
                    ? "text-emerald-400"
                    : skill.successRate >= 0.7
                      ? "text-amber-400"
                      : "text-rose-400"
                const barColor =
                  skill.successRate >= 0.9
                    ? "bg-emerald-400/80"
                    : skill.successRate >= 0.7
                      ? "bg-amber-400/80"
                      : "bg-rose-400/80"

                return (
                  <tr
                    key={skill.skillId ?? idx}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-3">
                      <span className="font-medium text-[var(--foreground)]">
                        {skill.skillName ?? skill.skillId ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs text-[var(--muted)]">
                        {skill.status ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              barColor
                            )}
                            style={{ width: `${parseFloat(successPct)}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "text-xs font-mono font-medium w-12 text-right",
                            successColor
                          )}
                        >
                          {successPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--primary)]/70 transition-all duration-500"
                            style={{
                              width: `${Math.min(100, parseFloat(selectionPct))}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono text-[var(--muted)] w-12 text-right">
                          {selectionPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-[var(--foreground)]">
                        {Math.round(skill.avgLatencyMs)}ms
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {skill.isExploring && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                          <Sparkles className="size-3" />
                          {t("exploring")}
                        </span>
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
            {t("noSkills")}
          </div>
        </div>
      )}
    </GlassCard>
  )
})
