"use client"

import { useTranslations } from "next-intl"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { TrendingUp } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { useTokenThroughput } from "@/lib/swr/use-token-throughput"

/**
 * Token Throughput Trend Chart
 *
 * Stacked area chart showing input/output token consumption over time
 * - Bottom layer: Input Tokens (deep purple)
 * - Top layer: Output Tokens (bright cyan)
 */
export function TokenThroughputChart() {
  const t = useTranslations("dashboard.tokenThroughput")
  const { data, isLoading } = useTokenThroughput()

  const chartConfig = {
    inputTokens: {
      label: t("inputTokens"),
      color: "hsl(var(--chart-1))",
    },
    outputTokens: {
      label: t("outputTokens"),
      color: "hsl(var(--chart-2))",
    },
  }

  // Sample data structure - will be replaced with real API data
  const chartData = data?.timeline || [
    { time: "00:00", inputTokens: 1200000, outputTokens: 450000 },
    { time: "04:00", inputTokens: 890000, outputTokens: 320000 },
    { time: "08:00", inputTokens: 2100000, outputTokens: 780000 },
    { time: "12:00", inputTokens: 3500000, outputTokens: 1200000 },
    { time: "16:00", inputTokens: 2800000, outputTokens: 950000 },
    { time: "20:00", inputTokens: 1950000, outputTokens: 680000 },
    { time: "24:00", inputTokens: 1100000, outputTokens: 420000 },
  ]

  const totalInput = chartData.reduce((sum, item) => sum + item.inputTokens, 0)
  const totalOutput = chartData.reduce((sum, item) => sum + item.outputTokens, 0)
  const ratio = totalOutput / totalInput

  return (
    <GlassCard className="h-full">
      <GlassCardHeader>
        <div className="flex items-start justify-between">
          <div>
            <GlassCardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[var(--primary)]" />
              {t("title")}
            </GlassCardTitle>
            <GlassCardDescription className="mt-1">
              {t("description")}
            </GlassCardDescription>
          </div>
          <div className="text-right">
            <div className="text-sm text-[var(--muted)]">{t("ratio")}</div>
            <div className="text-xl font-bold text-[var(--foreground)] tabular-nums">
              {isLoading ? (
                <span className="inline-block h-6 w-16 animate-pulse rounded bg-[var(--foreground)]/10" />
              ) : (
                `1:${ratio.toFixed(2)}`
              )}
            </div>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent>
        {isLoading ? (
          <div className="flex h-[300px] items-center justify-center">
            <div className="text-[var(--muted)]">{t("loading")}</div>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="inputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--chart-1))"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--chart-1))"
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id="outputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--chart-2))"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--chart-2))"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
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
                tickFormatter={(value) => formatTokens(value)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => (
                      <div className="flex items-center justify-between gap-4">
                        <span>{name}</span>
                        <span className="font-mono font-semibold">
                          {formatTokens(value as number)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="inputTokens"
                stackId="1"
                stroke="hsl(var(--chart-1))"
                fill="url(#inputGradient)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="outputTokens"
                stackId="1"
                stroke="hsl(var(--chart-2))"
                fill="url(#outputGradient)"
                strokeWidth={2}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}

        {/* Summary Statistics */}
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--border)]/50 pt-4">
          <div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide">
              {t("totalInput")}
            </div>
            <div className="mt-1 text-lg font-bold text-[var(--foreground)] tabular-nums">
              {formatTokens(totalInput)}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide">
              {t("totalOutput")}
            </div>
            <div className="mt-1 text-lg font-bold text-[var(--foreground)] tabular-nums">
              {formatTokens(totalOutput)}
            </div>
          </div>
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}

// Helper function to format large numbers
function formatTokens(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`
  }
  return value.toString()
}
