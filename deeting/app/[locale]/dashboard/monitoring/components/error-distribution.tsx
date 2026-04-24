"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"
import { Cell, Pie, PieChart } from "recharts"
import { ChartContainer } from "@/ui/shadcn/chart"
import { cn } from "@/lib/utils"
import type { DashboardStats } from "@/lib/api/dashboard"

/**
 * Error Distribution - Blueprint Edition
 */
export function ErrorDistribution({
  stats,
  isLoading = false,
}: {
  stats?: DashboardStats
  isLoading?: boolean
}) {
  const t = useTranslations("monitoring.dimensional.speedSummary")
  const tKpi = useTranslations("dashboard.kpi")

  const avgTTFT = Math.max(0, stats?.speed.avgTTFT ?? 0)
  const trendPercent = stats?.speed.trendPercent
  const normalizedLatency = Math.min(avgTTFT, 2000)
  const dialData = [
    { key: "ttft", value: normalizedLatency, color: "#2DD4BF" },
    { key: "rest", value: Math.max(0, 2000 - normalizedLatency), color: "rgba(148, 163, 184, 0.18)" },
  ]
  const trendTone =
    trendPercent == null || trendPercent === 0 ? "neutral" : trendPercent < 0 ? "better" : "worse"
  const trendLabel =
    trendTone === "better" ? t("faster") : trendTone === "worse" ? t("slower") : t("stable")

  const chartConfig = {
    ttft: { label: t("average"), color: "#2DD4BF" },
    rest: { label: "Scale", color: "rgba(148, 163, 184, 0.18)" },
  }

  return (
    <GlassCard theme="blueprint" hover="none" padding="none">
      <GlassCardHeader blueprint>
        <div className="flex flex-col gap-0.5">
          <GlassCardTitle blueprint>{tKpi("speed.label")}</GlassCardTitle>
          <GlassCardDescription blueprint>{t("description")}</GlassCardDescription>
        </div>
        <AlertTriangle className="h-4 w-4 text-[var(--danger)]/70" />
      </GlassCardHeader>
      <GlassCardContent blueprint>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-[var(--muted)]">{t("average")}</div>
          </div>
        ) : (
          <div className="space-y-8 flex flex-col items-center">
            <div className="relative w-full aspect-square max-w-[200px]">
              <ChartContainer config={chartConfig} className="h-full w-full">
                <PieChart>
                  <Pie
                    data={dialData}
                    dataKey="value"
                    nameKey="key"
                    innerRadius={65}
                    outerRadius={85}
                    paddingAngle={4}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {dialData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        className="opacity-80 hover:opacity-100 transition-opacity"
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>

              {/* Blueprint Center Value */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-mono text-3xl font-bold tracking-tighter tabular-nums text-[var(--foreground)]">
                  {Math.round(avgTTFT)}
                  <span className="ml-1 text-base">ms</span>
                </span>
                <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--ink-4)]">
                  {t("average")}
                </span>
              </div>
            </div>

            {/* Blueprint Detail List */}
            <div className="w-full space-y-1">
              {[
                {
                  key: "average",
                  label: t("average"),
                  value: `${Math.round(avgTTFT)}ms`,
                  muted: false,
                },
                {
                  key: "trend",
                  label: t("trend"),
                  value:
                    trendPercent != null ? `${trendPercent > 0 ? "+" : ""}${trendPercent.toFixed(1)}%` : "--",
                  muted: false,
                  tone: trendTone,
                },
                {
                  key: "status",
                  label: t("lowerBetter"),
                  value: trendLabel,
                  muted: true,
                },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between border-t border-[var(--border)] pt-2 pb-1">
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 bg-[var(--accent)]/70" />
                    <span className="font-mono text-[10px] uppercase font-bold text-[var(--foreground)]">{item.label}</span>
                  </div>
                  <span
                    className={cn(
                      "font-mono text-xs font-bold tabular-nums text-[var(--foreground)]",
                      item.tone === "better" && "text-[var(--ok)]",
                      item.tone === "worse" && "text-[var(--danger)]",
                      item.muted && "text-[var(--ink-4)]"
                    )}
                  >
                    {item.value}
                  </span>
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
