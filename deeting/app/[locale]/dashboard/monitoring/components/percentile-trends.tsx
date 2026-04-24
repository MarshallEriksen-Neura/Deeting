"use client"

import { useTranslations } from "next-intl"
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/ui/shadcn/chart"
import { usePercentileTrends } from "@/lib/swr/use-percentile-trends"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Percentile Trends Component
 *
 * Dual line chart showing:
 * - Dashed line: P50 (median, average experience)
 * - Solid line: P99 (tail latency, worst-case experience)
 *
 * P99 determines user experience floor
 */
export function PercentileTrends({ filters }: { filters: MonitoringFilters }) {
  const t = useTranslations("monitoring.performance.percentile")
  const tUnits = useTranslations("monitoring.units")
  const { data, isLoading } = usePercentileTrends(filters, {
    autoRefresh: filters.autoRefresh,
  })

  const chartConfig = {
    p50: {
      label: t("legend.p50"),
      color: "var(--chart-2)",
    },
    p99: {
      label: t("legend.p99"),
      color: "var(--chart-1)",
    },
  }

  const chartData = data?.timeline ?? []

  if (isLoading) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <div className="text-[var(--muted)]">{t("loading")}</div>
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          opacity={0.3}
          vertical={false}
        />
        <XAxis
          dataKey="time"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickFormatter={(value) => tUnits("msValue", { value })}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {/* P50 - Dashed line */}
        <Line
          type="monotone"
          dataKey="p50"
          stroke="var(--chart-2)"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
        {/* P99 - Solid line */}
        <Line
          type="monotone"
          dataKey="p99"
          stroke="var(--chart-1)"
          strokeWidth={3}
          dot={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  )
}
