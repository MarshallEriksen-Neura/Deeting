"use client"

import { useTranslations } from "next-intl"
import { DollarSign } from "lucide-react"
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
 * Model Cost Breakdown - Blueprint Edition
 */
export function ModelCostBreakdown({
  stats,
  isLoading = false,
}: {
  stats?: DashboardStats
  isLoading?: boolean
}) {
  const t = useTranslations("monitoring.dimensional.trafficSummary")
  const tKpi = useTranslations("dashboard.kpi")

  const totalRequests = stats?.traffic.todayRequests ?? 0
  const hourlyTrend = stats?.traffic.hourlyTrend ?? []
  const trendPercent = stats?.traffic.trendPercent
  const groupedTrend = buildTrafficGroups(hourlyTrend)

  return (
    <GlassCard theme="blueprint" hover="none" padding="none">
      <GlassCardHeader blueprint>
        <div className="flex flex-col gap-0.5">
          <GlassCardTitle blueprint>{tKpi("traffic.label")}</GlassCardTitle>
          <GlassCardDescription blueprint>{t("description")}</GlassCardDescription>
        </div>
        <DollarSign className="h-4 w-4 text-amber-500/70" />
      </GlassCardHeader>
      <GlassCardContent blueprint>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 animate-pulse bg-[var(--border)]" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Total Requests Section */}
            <div className="border border-amber-500/20 bg-amber-500/5 p-4 flex items-end justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-amber-600/60">
                      {t("total")}
                    </span>
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-2xl font-bold text-amber-600 tabular-nums">
                        {formatCompactNumber(totalRequests)}
                      </span>
                      {trendPercent != null ? <TrendBadge value={trendPercent} /> : null}
                    </div>
                  </div>
                </div>
                <TrafficSparkline data={hourlyTrend} />
              </div>
              <div className="h-2 w-2 bg-amber-500/40 animate-pulse" />
            </div>

            {/* Hourly Buckets */}
            <div className="space-y-5">
              {groupedTrend.map((group, index) => (
                <div key={group.label} className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--ink-4)]">0{index + 1}</span>
                      <span className="font-bold uppercase tracking-tight text-[var(--foreground)]">
                        {group.label}
                      </span>
                    </div>
                    <span className="font-bold text-[var(--foreground)] tabular-nums">
                      {group.value}
                    </span>
                  </div>
                  <div className="relative h-1 bg-[var(--border)]">
                    <div
                      className="h-full bg-amber-500/60 transition-all duration-1000"
                      style={{ width: `${group.percentage}%` }}
                    />
                    {/* Tick marks on the bar */}
                    <div className="absolute inset-0 flex justify-between px-px pointer-events-none">
                       {[...Array(5)].map((_, i) => (
                         <div key={i} className="h-full w-px bg-white/20" />
                       ))}
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

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toString()
}

function buildTrafficGroups(hourlyTrend: number[]) {
  const groups = [
    { label: "00-05", slice: hourlyTrend.slice(0, 6) },
    { label: "06-11", slice: hourlyTrend.slice(6, 12) },
    { label: "12-17", slice: hourlyTrend.slice(12, 18) },
    { label: "18-23", slice: hourlyTrend.slice(18, 24) },
  ]
  const maxValue = Math.max(
    0,
    ...groups.map((group) => group.slice.reduce((sum, item) => sum + item, 0))
  )

  return groups.map((group) => {
    const value = group.slice.reduce((sum, item) => sum + item, 0)
    return {
      label: group.label,
      value,
      percentage: maxValue > 0 ? (value / maxValue) * 100 : 0,
    }
  })
}

function TrafficSparkline({ data }: { data: number[] }) {
  if (data.length === 0) {
    return <div className="h-16 border border-[var(--border)] bg-[var(--card)]/40" />
  }

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(1, data.length - 1)) * 100
      const y = 100 - ((value - min) / range) * 100
      return `${x},${y}`
    })
    .join(" ")

  return (
    <div className="h-16 border border-[var(--border)] bg-[var(--card)]/40 px-2 py-1.5">
      <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-amber-500/80"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

function TrendBadge({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] font-bold",
        value > 0 ? "text-[var(--ok)]" : value < 0 ? "text-[var(--danger)]" : "text-[var(--ink-4)]"
      )}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  )
}
