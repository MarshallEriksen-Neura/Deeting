"use client"

import { DollarSign, Activity, Zap, CheckCircle2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { GlassCard } from "@/components/ui/glass-card"
import { cn } from "@/lib/utils"
import { useDashboardStats } from "@/lib/swr/use-dashboard-stats"

/**
 * KPI Metrics Row - The Vitals
 *
 * 4 equal-width cards displaying core metrics:
 * 1. Financial/Quota (Money)
 * 2. Today's Traffic
 * 3. Response Speed (TTFT)
 * 4. System Health
 */
export function KPIMetricsRow() {
  const t = useTranslations("dashboard.kpi")
  const { data: stats, isLoading } = useDashboardStats()

  const kpiCards = [
    {
      id: "financial",
      icon: DollarSign,
      iconBg: "bg-emerald-500/10",
      iconColor: "text-emerald-400",
      label: t("financial.label"),
      value: stats?.financial.monthlySpent
        ? `$${stats.financial.monthlySpent.toFixed(2)}`
        : "$0.00",
      subValue: stats?.financial.quotaUsedPercent
        ? `${stats.financial.quotaUsedPercent}%`
        : "0%",
      subLabel: t("financial.quotaUsed"),
      miniChart: stats?.financial.quotaUsedPercent ? (
        <div className="relative h-12 w-12">
          <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
            {/* Background circle */}
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.1"
            />
            {/* Progress circle */}
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={`${stats.financial.quotaUsedPercent} 100`}
              className="text-emerald-400 transition-all duration-500"
            />
          </svg>
        </div>
      ) : null,
      hoverText: t("financial.hover"),
    },
    {
      id: "traffic",
      icon: Activity,
      iconBg: "bg-[var(--primary)]/10",
      iconColor: "text-[var(--primary)]",
      label: t("traffic.label"),
      value: stats?.traffic.todayRequests
        ? formatNumber(stats.traffic.todayRequests)
        : "0",
      sparkline: stats?.traffic.hourlyTrend || [],
      trend: stats?.traffic.trendPercent,
    },
    {
      id: "speed",
      icon: Zap,
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-400",
      label: t("speed.label"),
      value: stats?.speed.avgTTFT
        ? `${stats.speed.avgTTFT}ms`
        : "0ms",
      trend: stats?.speed.trendPercent,
      trendInverse: true, // Lower is better for TTFT
    },
    {
      id: "health",
      icon: CheckCircle2,
      iconBg: "bg-teal-500/10",
      iconColor: "text-[var(--teal-accent)]",
      label: t("health.label"),
      value: stats?.health.successRate
        ? `${stats.health.successRate.toFixed(1)}%`
        : "0%",
      bgColorClass: getHealthBgColor(stats?.health.successRate || 0),
    },
  ]

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpiCards.map((card, index) => (
        <GlassCard
          key={card.id}
          className={cn(
            "group relative overflow-visible transition-all duration-300",
            "hover:-translate-y-1 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.15)]",
            "animate-glass-card-in",
            `stagger-${index + 1}`,
            card.bgColorClass
          )}
          padding="default"
        >
          <div className="flex items-start justify-between">
            {/* Left: Value & Label */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                {card.label}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-[var(--foreground)] tabular-nums">
                  {isLoading ? (
                    <span className="inline-block h-9 w-24 animate-pulse rounded bg-[var(--foreground)]/10" />
                  ) : (
                    card.value
                  )}
                </span>
                {card.trend !== undefined && (
                  <TrendIndicator
                    value={card.trend}
                    inverse={card.trendInverse}
                  />
                )}
              </div>
              {card.subValue && (
                <span className="text-sm text-[var(--muted)]">
                  {card.subLabel}: <span className="font-semibold">{card.subValue}</span>
                </span>
              )}
              {card.sparkline && card.sparkline.length > 0 && (
                <div className="mt-2">
                  <Sparkline data={card.sparkline} />
                </div>
              )}
            </div>

            {/* Right: Icon or Mini Chart */}
            <div className={cn("flex items-center justify-center", card.iconBg, "rounded-xl p-2.5")}>
              {card.miniChart || <card.icon className={cn("h-5 w-5", card.iconColor)} />}
            </div>
          </div>

          {/* Hover Tooltip */}
          {card.hoverText && (
            <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
              <div className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs text-[var(--background)] shadow-xl whitespace-nowrap">
                {card.hoverText}
                <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[var(--foreground)]" />
              </div>
            </div>
          )}
        </GlassCard>
      ))}
    </div>
  )
}

// Trend Indicator Component
function TrendIndicator({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const isPositive = inverse ? value < 0 : value > 0
  const displayValue = Math.abs(value)

  return (
    <span
      className={cn(
        "flex items-center gap-0.5 text-xs font-semibold",
        isPositive ? "text-emerald-400" : "text-red-400"
      )}
    >
      <svg
        className={cn("h-3 w-3", !isPositive && "rotate-180")}
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M6 2.5v7M6 2.5L3 5.5M6 2.5l3 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {displayValue}%
    </span>
  )
}

// Sparkline Component - Mini line chart
function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100
      const y = 100 - ((value - min) / range) * 100
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg className="h-8 w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-emerald-400"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

// Helper Functions
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`
  }
  return num.toString()
}

function getHealthBgColor(rate: number): string {
  if (rate >= 99) return ""
  if (rate >= 95) return "bg-amber-500/5"
  return "bg-red-500/5"
}
