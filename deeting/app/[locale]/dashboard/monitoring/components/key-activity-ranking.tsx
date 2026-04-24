"use client"

import { useTranslations } from "next-intl"
import { Key } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"
import { cn } from "@/lib/utils"
import type { DashboardStats } from "@/lib/api/dashboard"

/**
 * Key Activity Ranking - Blueprint Edition
 */
export function KeyActivityRanking({
  stats,
  isLoading = false,
}: {
  stats?: DashboardStats
  isLoading?: boolean
}) {
  const t = useTranslations("monitoring.dimensional.healthSummary")
  const tKpi = useTranslations("dashboard.kpi")

  const successRate = stats?.health.successRate ?? 0
  const successfulRequests = stats?.health.successfulRequests ?? 0
  const totalRequests = stats?.health.totalRequests ?? 0
  const failedRequests = Math.max(0, totalRequests - successfulRequests)
  const summaryRows = [
    { id: "success", label: t("successful"), value: successfulRequests },
    { id: "failed", label: t("failed"), value: failedRequests },
    { id: "total", label: t("total"), value: totalRequests },
  ]

  return (
    <GlassCard theme="blueprint" hover="none" padding="none">
      <GlassCardHeader blueprint>
        <div className="flex flex-col gap-0.5">
          <GlassCardTitle blueprint>{tKpi("health.label")}</GlassCardTitle>
          <GlassCardDescription blueprint>{t("description")}</GlassCardDescription>
        </div>
        <Key className="h-4 w-4 text-[var(--accent-strong)]/70" />
      </GlassCardHeader>
      <GlassCardContent blueprint>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse bg-[var(--border)]" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="border border-[var(--border)] bg-[var(--card)]/60 p-4">
              <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink-4)]">
                    {t("successRate")}
                  </span>
                  <span className="font-mono text-3xl font-bold tabular-nums text-[var(--foreground)]">
                    {successRate.toFixed(1)}%
                  </span>
                </div>
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-widest",
                    successRate >= 99
                      ? "text-[var(--ok)]"
                      : successRate >= 95
                        ? "text-amber-500"
                        : "text-[var(--danger)]"
                  )}
                >
                  {successRate >= 99 ? t("stableState") : successRate >= 95 ? t("watchState") : t("riskState")}
                </span>
              </div>
            </div>

            <div className="space-y-px bg-[var(--border)] border border-[var(--border)]">
              {summaryRows.map((row, index) => (
                <div
                  key={row.id}
                  className="bg-[var(--card)] p-3 flex items-center justify-between group hover:bg-[var(--primary)]/5 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="font-mono text-[10px] text-[var(--ink-4)]">0{index + 1}</span>
                    <div className="flex flex-col min-w-0">
                      <span className="font-mono text-[11px] font-bold uppercase truncate text-[var(--foreground)]">
                        {row.label}
                      </span>
                      <span className="font-mono text-[9px] text-[var(--ink-4)]">{t("requestsLabel")}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-base font-bold tabular-nums text-[var(--foreground)]">
                        {row.value}
                      </span>
                      <span className="font-mono text-[8px] uppercase tracking-wider text-[var(--ink-4)]">
                        {totalRequests > 0 ? `${((row.value / totalRequests) * 100).toFixed(1)}%` : "0.0%"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCardContent>
      <div className="h-1 w-full bg-[var(--border)] opacity-30" />
    </GlassCard>
  )
}
