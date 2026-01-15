"use client"

import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { GlassCard } from "@/components/ui/glass-card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"

export function ConsumptionTrendChart() {
  const t = useTranslations("credits")

  // Generate mock data for last 30 days
  const chartData = useMemo(() => {
    const data = []
    const today = new Date()
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      data.push({
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        "GPT-4o": Math.floor(Math.random() * 5000) + 2000,
        "Claude 3.5": Math.floor(Math.random() * 3000) + 1000,
        "Gemini Pro": Math.floor(Math.random() * 2000) + 500,
      })
    }
    return data
  }, [])

  const chartConfig = {
    "GPT-4o": {
      label: "GPT-4o",
      color: "#06b6d4", // cyan-500
    },
    "Claude 3.5": {
      label: "Claude 3.5",
      color: "#8b5cf6", // violet-500
    },
    "Gemini Pro": {
      label: "Gemini Pro",
      color: "#f59e0b", // amber-500
    },
  }

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
                <linearGradient id="colorGPT" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorClaude" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorGemini" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
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
              <Area
                type="monotone"
                dataKey="GPT-4o"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#colorGPT)"
              />
              <Area
                type="monotone"
                dataKey="Claude 3.5"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="url(#colorClaude)"
              />
              <Area
                type="monotone"
                dataKey="Gemini Pro"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#colorGemini)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </GlassCard>
  )
}
