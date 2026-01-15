"use client"

import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { GlassCard } from "@/components/ui/glass-card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { useCreditsConsumption } from "@/lib/swr/use-credits-consumption"

export function ConsumptionTrendChart() {
  const t = useTranslations("credits")
  const { data } = useCreditsConsumption(30)

  const palette = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#f97316", "#ef4444"]
  const models = data?.models ?? []

  const chartData = useMemo(() => {
    const timeline = data?.timeline ?? []
    return timeline.map((point) => {
      const date = new Date(point.date)
      return {
        date: Number.isNaN(date.getTime())
          ? point.date
          : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        ...point.tokensByModel,
      }
    })
  }, [data])

  const chartConfig = useMemo(() => {
    return Object.fromEntries(
      models.map((model, index) => [
        model,
        {
          label: model,
          color: palette[index % palette.length],
        },
      ])
    )
  }, [models])

  return (
    <GlassCard blur="lg" theme="default" hover="none" className="h-full">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {t("consumption.title")}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            {t("consumption.subtitle")}
          </p>
        </div>

        {/* Chart */}
        <ChartContainer config={chartConfig} className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                {models.map((model, index) => (
                  <linearGradient id={`color-${index}`} x1="0" y1="0" x2="0" y2="1" key={model}>
                    <stop offset="5%" stopColor={palette[index % palette.length]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={palette[index % palette.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="currentColor"
                className="stroke-[var(--muted)]/10"
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "currentColor" }}
                className="text-[var(--muted)] text-xs"
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "currentColor" }}
                className="text-[var(--muted)] text-xs"
                tickFormatter={(value) => `${(value / 1000).toFixed(1)}k`}
              />
              <Tooltip
                content={<ChartTooltipContent />}
                cursor={{ stroke: "currentColor", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              {models.map((model, index) => (
                <Area
                  key={model}
                  type="monotone"
                  dataKey={model}
                  stroke={palette[index % palette.length]}
                  strokeWidth={2}
                  fill={`url(#color-${index})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </GlassCard>
  )
}
