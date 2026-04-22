"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"
import { BlueprintCard } from "@/ui/common/blueprint-card"
import { Cell, Pie, PieChart } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/ui/shadcn/chart"
import { useErrorDistribution } from "@/lib/swr/use-error-distribution"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Error Distribution - Blueprint Edition
 */
export function ErrorDistribution({
  filters,
}: {
  filters: MonitoringFilters
}) {
  const t = useTranslations("monitoring.dimensional.errorDist")
  const { data, isLoading } = useErrorDistribution(filters, {
    autoRefresh: filters.autoRefresh,
  })

  const errorLabelMap: Record<string, string> = {
    "429": t("labels.rateLimit"),
    "5xx": t("labels.serverError"),
    "4xx": t("labels.clientError"),
  }
  const errorData = (data?.categories ?? []).map((item) => ({
    ...item,
    label: errorLabelMap[item.category] ?? item.label ?? item.category,
    // Clean up color names from potential double parenthesis
    color: item.color.replace(/\)\)/g, ')'),
  }))

  const totalErrors = errorData.reduce((sum, e) => sum + e.count, 0)

  const chartConfig = {
    "429": { label: errorLabelMap["429"], color: "var(--chart-3)" },
    "5xx": { label: errorLabelMap["5xx"], color: "var(--chart-1)" },
    "4xx": { label: errorLabelMap["4xx"], color: "var(--chart-4)" },
  }

  return (
    <BlueprintCard
      title={t("title")}
      subtitle={t("description")}
      headerAction={<AlertTriangle className="h-4 w-4 text-[var(--danger)]/70" />}
    >
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="text-[var(--muted)]">{t("loading")}</div>
        </div>
      ) : (
        <div className="space-y-8 flex flex-col items-center">
          <div className="relative w-full aspect-square max-w-[200px]">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <PieChart>
                <Pie
                  data={errorData}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={65}
                  outerRadius={85}
                  paddingAngle={4}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {errorData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.color} 
                      className="opacity-80 hover:opacity-100 transition-opacity"
                    />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>

            {/* Blueprint Center Value */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="font-mono text-3xl font-bold tracking-tighter tabular-nums text-[var(--foreground)]">
                {totalErrors}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--ink-4)]">
                {t("totalErrors")}
              </span>
            </div>
          </div>

          {/* Blueprint Detail List */}
          <div className="w-full space-y-1">
            {errorData.map((error) => (
              <div key={error.category} className="flex items-center justify-between border-t border-[var(--border)] pt-2 pb-1">
                <div className="flex items-center gap-2">
                  <div className="size-1.5" style={{ backgroundColor: error.color }} />
                  <span className="font-mono text-[10px] uppercase font-bold text-[var(--foreground)]">{error.label}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs font-bold tabular-nums text-[var(--foreground)]">{error.count}</span>
                  <span className="font-mono text-[9px] text-[var(--ink-4)]">({totalErrors > 0 ? ((error.count / totalErrors) * 100).toFixed(1) : "0.0"}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </BlueprintCard>
  )
}
