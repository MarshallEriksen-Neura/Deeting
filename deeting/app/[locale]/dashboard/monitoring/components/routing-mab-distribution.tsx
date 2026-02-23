"use client"

import { memo, useMemo } from "react"
import { useTranslations } from "next-intl"
import {
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
} from "@/components/ui/glass-card"
import { useArmPerformance } from "@/lib/swr/use-routing-mab"

const DONUT_COLORS = [
  "var(--primary)",
  "var(--chart-2))",
  "var(--chart-3))",
  "var(--chart-4))",
  "var(--chart-5))",
  "#818cf8",
  "#34d399",
  "#fbbf24",
]

export const RoutingMabDistribution = memo(function RoutingMabDistribution() {
  const t = useTranslations("monitoring.routing.distribution")
  const { data, isLoading } = useArmPerformance()

  const arms = data?.arms ?? []

  const donutData = useMemo(
    () =>
      arms
        .filter((a) => a.totalTrials > 0)
        .map((a) => ({
          name: `${a.provider} / ${a.model}`,
          value: a.selectionRatio,
          trials: a.totalTrials,
        })),
    [arms]
  )

  const scatterData = useMemo(
    () =>
      arms
        .filter((a) => a.totalTrials > 0)
        .map((a) => ({
          name: `${a.provider} / ${a.model}`,
          latency: a.latencyP95Ms ?? a.avgLatencyMs,
          successRate: a.successRate * 100,
          trials: a.totalTrials,
          size: Math.max(40, Math.min(200, a.totalTrials / 10)),
        })),
    [arms]
  )

  if (isLoading) {
    return (
      <div className="h-[320px] animate-pulse rounded-2xl bg-[var(--card)]/60 border border-white/10" />
    )
  }

  if (!arms.length) return null

  return (
    <GlassCard padding="default" hover="none" className="h-full">
      <GlassCardHeader>
        <GlassCardTitle>{t("title")}</GlassCardTitle>
      </GlassCardHeader>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {/* Donut Chart */}
        <div>
          <p className="mb-2 text-xs font-medium text-[var(--muted)]">
            {t("trafficTitle")}
          </p>
          <div className="flex items-center gap-4">
            <ChartContainer
              config={{ traffic: { label: t("trafficTitle") } }}
              className="h-[180px] w-[180px] shrink-0"
            >
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {donutData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                      strokeWidth={0}
                    />
                  ))}
                </Pie>
                <ChartTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="border-border/50 bg-background rounded-lg border px-3 py-2 text-xs shadow-xl">
                        <div className="font-medium">{d.name}</div>
                        <div className="text-muted-foreground">
                          {(d.value * 100).toFixed(1)}% ({d.trials} trials)
                        </div>
                      </div>
                    )
                  }}
                />
              </PieChart>
            </ChartContainer>

            {/* Legend */}
            <div className="flex flex-col gap-1.5 min-w-0 overflow-hidden">
              {donutData.slice(0, 6).map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length],
                    }}
                  />
                  <span className="truncate text-[var(--muted)]">{d.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[var(--foreground)]">
                    {(d.value * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scatter Plot */}
        <div>
          <p className="mb-2 text-xs font-medium text-[var(--muted)]">
            {t("scatterTitle")}
          </p>
          <ChartContainer
            config={{ scatter: { label: t("scatterTitle") } }}
            className="h-[200px] w-full"
          >
            <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                opacity={0.3}
              />
              <XAxis
                type="number"
                dataKey="latency"
                name="Latency"
                tickFormatter={(v: number) => `${Math.round(v)}ms`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="successRate"
                name="Success %"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <ChartTooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div className="border-border/50 bg-background rounded-lg border px-3 py-2 text-xs shadow-xl">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-muted-foreground">
                        Latency: {Math.round(d.latency)}ms
                      </div>
                      <div className="text-muted-foreground">
                        Success: {d.successRate.toFixed(1)}%
                      </div>
                    </div>
                  )
                }}
              />
              <Scatter
                data={scatterData}
                fill="var(--primary)"
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            </ScatterChart>
          </ChartContainer>
          <p className="mt-1 text-[10px] text-[var(--muted)] text-center">
            {t("scatterDesc")}
          </p>
        </div>
      </div>
    </GlassCard>
  )
})
