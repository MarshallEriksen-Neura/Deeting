"use client"

import { useTranslations } from "next-intl"
import { GlassCard } from "@/components/ui/glass-card"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"

export function ModelUsageChart() {
  const t = useTranslations("credits")

  // Mock data - replace with real API call
  const data = [
    { name: "GPT-4o", value: 9800, color: "#06b6d4" }, // cyan-500
    { name: "Claude 3.5", value: 4567, color: "#8b5cf6" }, // violet-500
    { name: "Gemini Pro", value: 2341, color: "#f59e0b" }, // amber-500
  ]

  const total = data.reduce((sum, item) => sum + item.value, 0)

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
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={45}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-2">
            {data.map((item, index) => (
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
                    {((item.value / total) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
