"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Cell, Pie, PieChart } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { useErrorDistribution } from "@/lib/swr/use-error-distribution"

/**
 * Error Distribution Component
 *
 * Donut chart categorizing errors:
 * - 429: Rate limiting (money issue)
 * - 5xx: Upstream failures (provider issue)
 * - 4xx: Client errors (code issue)
 *
 * Purpose: Quick fault attribution
 */
export function ErrorDistribution({
  timeRange = "24h",
  model,
}: {
  timeRange?: "24h" | "7d" | "30d"
  model?: string
}) {
  const t = useTranslations("monitoring.dimensional.errorDist")
  const { data, isLoading } = useErrorDistribution(timeRange, model)

  const errorData = data?.categories || [
    { category: "429", label: "Rate Limit", count: 145, color: "hsl(var(--chart-3))" },
    { category: "5xx", label: "Server Error", count: 89, color: "hsl(var(--chart-1))" },
    { category: "4xx", label: "Client Error", count: 56, color: "hsl(var(--chart-4))" },
  ]

  const totalErrors = errorData.reduce((sum, e) => sum + e.count, 0)

  const chartConfig = {
    "429": { label: "Rate Limit", color: "hsl(var(--chart-3))" },
    "5xx": { label: "Server Error", color: "hsl(var(--chart-1))" },
    "4xx": { label: "Client Error", color: "hsl(var(--chart-4))" },
  }

  return (
    <GlassCard className="bg-[var(--card)]">
      <GlassCardHeader>
        <GlassCardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          {t("title")}
        </GlassCardTitle>
        <GlassCardDescription className="mt-1">
          {t("description")}
        </GlassCardDescription>
      </GlassCardHeader>
      <GlassCardContent>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-[var(--muted)]">{t("loading")}</div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Donut Chart */}
            <ChartContainer config={chartConfig} className="mx-auto h-48 w-48">
              <PieChart>
                <Pie
                  data={errorData}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {errorData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>

            {/* Total in center (simulated) */}
            <div className="text-center -mt-32 mb-24">
              <div className="text-3xl font-bold text-[var(--foreground)] tabular-nums">
                {totalErrors}
              </div>
              <div className="text-xs text-[var(--muted)]">{t("totalErrors")}</div>
            </div>

            {/* Legend with details */}
            <div className="space-y-2">
              {errorData.map((error) => (
                <ErrorLegendItem key={error.category} error={error} total={totalErrors} />
              ))}
            </div>
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}

function ErrorLegendItem({
  error,
  total,
}: {
  error: { category: string; label: string; count: number; color: string }
  total: number
}) {
  const percentage = ((error.count / total) * 100).toFixed(1)

  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border)] p-2">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: error.color }} />
        <span className="text-sm font-medium text-[var(--foreground)]">{error.label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--foreground)] tabular-nums">
          {error.count}
        </span>
        <span className="text-xs text-[var(--muted)]">({percentage}%)</span>
      </div>
    </div>
  )
}
