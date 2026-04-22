"use client"

import { useTranslations } from "next-intl"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { BlueprintCard } from "@/ui/common/blueprint-card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/ui/shadcn/chart"
import type { TokenThroughput } from "@/lib/api/dashboard"
import { useDashboardOverview } from "@/lib/swr/use-dashboard-overview"

/**
 * Token Throughput Trend Chart - Blueprint Edition
 */
export function TokenThroughputChart({
  data: providedData,
  isLoading: providedLoading,
}: {
  data?: TokenThroughput
  isLoading?: boolean
}) {
  const t = useTranslations("dashboard.tokenThroughput")
  const { data: overview, isLoading: overviewLoading } = useDashboardOverview({
    source: "auto",
    period: "24h",
    recentErrorLimit: 10,
  })
  const data = providedData ?? overview?.tokenThroughput
  const isLoading = providedLoading ?? overviewLoading

  const chartConfig = {
    inputTokens: {
      label: t("inputTokens"),
      color: "var(--chart-1)",
    },
    outputTokens: {
      label: t("outputTokens"),
      color: "var(--chart-2)",
    },
  }

  const chartData = data?.timeline ?? []

  const totalInput = chartData.reduce((sum, item) => sum + item.inputTokens, 0)
  const totalOutput = chartData.reduce((sum, item) => sum + item.outputTokens, 0)
  const ratio = data?.ratio ?? (totalInput > 0 ? totalOutput / totalInput : 0)

  return (
    <BlueprintCard
      title={t("title")}
      subtitle={t("description")}
      headerAction={
        <div className="flex flex-col items-end font-mono">
          <span className="text-[9px] uppercase text-[var(--ink-4)] tracking-wider">{t("ratio")}</span>
          <span className="text-sm font-bold text-[var(--foreground)]">
            {isLoading ? "---" : `1:${ratio.toFixed(2)}`}
          </span>
        </div>
      }
    >
      {isLoading ? (
        <div className="flex h-[300px] items-center justify-center">
          <div className="text-[var(--muted)]">{t("loading")}</div>
        </div>
      ) : (
        <div className="space-y-6">
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <AreaChart
              data={chartData}
              margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="inputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="var(--border)"
                vertical={true}
              />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tickMargin={12}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={12}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                tickFormatter={(value) => formatTokens(value)}
              />
              <ChartTooltip
                cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
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
                type="stepAfter"
                dataKey="inputTokens"
                stackId="1"
                stroke="var(--chart-1)"
                fill="url(#inputGradient)"
                strokeWidth={1.5}
              />
              <Area
                type="stepAfter"
                dataKey="outputTokens"
                stackId="1"
                stroke="var(--chart-2)"
                fill="url(#outputGradient)"
                strokeWidth={1.5}
              />
              <ChartLegend content={<ChartLegendContent />} className="pt-4 border-t border-[var(--border)]" />
            </AreaChart>
          </ChartContainer>

          <div className="grid grid-cols-2 gap-px bg-[var(--border)]">
            <div className="bg-[var(--card)] p-3 flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink-4)]">{t("totalInput")}</span>
              <span className="font-mono text-lg font-bold tabular-nums text-[var(--foreground)]">{formatTokens(totalInput)}</span>
            </div>
            <div className="bg-[var(--card)] p-3 flex flex-col gap-1 text-right">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink-4)]">{t("totalOutput")}</span>
              <span className="font-mono text-lg font-bold tabular-nums text-[var(--foreground)]">{formatTokens(totalOutput)}</span>
            </div>
          </div>
        </div>
      )}
    </BlueprintCard>
  )
}

function formatTokens(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toString()
}
