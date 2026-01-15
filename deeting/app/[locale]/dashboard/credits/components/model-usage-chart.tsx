"use client"

import { useTranslations } from "next-intl"
import { GlassCard } from "@/components/ui/glass-card"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { useCreditsModelUsage } from "@/lib/swr/use-credits-model-usage"

export function ModelUsageChart() {
  const t = useTranslations("credits")
  const { data } = useCreditsModelUsage(30)

  const palette = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#f97316", "#ef4444"]
  const items = data?.models ?? []
  const chartData = items.map((item, index) => ({
    name: item.model,
    value: item.tokens,
    color: palette[index % palette.length],
  }))

  const total = chartData.reduce((sum, item) => sum + item.value, 0)

  return (
    <GlassCard
      blur="lg"
      theme="default"
      hover="lift"
      className="relative"
    >
      <div className="p-6">
        {/* Header */}
        <h3 className="text-sm font-medium text-[var(--muted)] mb-4">
          {t("modelUsage.title")}
        </h3>

        {/* Chart and Legend */}
        <div className="flex items-center gap-6">
          {/* Donut Chart */}
          <div className="flex-shrink-0">
            <ResponsiveContainer width={100} height={100}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={45}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-2">
            {chartData.length === 0 ? (
              <div className="text-xs text-[var(--muted)]">—</div>
            ) : (
              chartData.map((item, index) => (
              <div key={index} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[var(--muted)]">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-[var(--foreground)]">
                    {item.value.toLocaleString()}
                  </span>
                  <span className="text-[var(--muted)] w-10 text-right">
                    {total > 0 ? `${((item.value / total) * 100).toFixed(0)}%` : "0%"}
                  </span>
                </div>
              </div>
            ))
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
