"use client"

import { useTranslations } from "next-intl"
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { usePercentileTrends } from "@/lib/swr/use-percentile-trends"

/**
 * Percentile Trends Component
 *
 * Dual line chart showing:
 * - Dashed line: P50 (median, average experience)
 * - Solid line: P99 (tail latency, worst-case experience)
 *
 * P99 determines user experience floor
 */
export function PercentileTrends({ timeRange = "24h" }: { timeRange?: "24h" | "7d" | "30d" }) {
  const t = useTranslations("monitoring.performance.percentile")
  const { data, isLoading } = usePercentileTrends(timeRange)

  const chartConfig = {
    p50: {
      label: "P50 (Median)",
      color: "hsl(var(--chart-2))",
    },
    p99: {
      label: "P99 (Tail)",
      color: "hsl(var(--chart-1))",
    },
  }

  // Sample data
  const chartData = data?.timeline || [
    { time: "00:00", p50: 180, p99: 450 },
    { time: "02:00", p50: 165, p99: 420 },
    { time: "04:00", p50: 155, p99: 380 },
    { time: "06:00", p50: 170, p99: 410 },
    { time: "08:00", p50: 220, p99: 580 },
    { time: "10:00", p50: 240, p99: 650 },
    { time: "12:00", p50: 260, p99: 720 },
    { time: "14:00", p50: 250, p99: 680 },
    { time: "16:00", p50: 230, p99: 620 },
    { time: "18:00", p50: 210, p99: 550 },
    { time: "20:00", p50: 190, p99: 480 },
    { time: "22:00", p50: 175, p99: 440 },
  ]

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
          stroke="hsl(var(--border))"
          opacity={0.3}
          vertical={false}
        />
        <XAxis
          dataKey="time"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickFormatter={(value) => `${value}ms`}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {/* P50 - Dashed line */}
        <Line
          type="monotone"
          dataKey="p50"
          stroke="hsl(var(--chart-2))"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
        {/* P99 - Solid line */}
        <Line
          type="monotone"
          dataKey="p99"
          stroke="hsl(var(--chart-1))"
          strokeWidth={3}
          dot={false}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  )
}
