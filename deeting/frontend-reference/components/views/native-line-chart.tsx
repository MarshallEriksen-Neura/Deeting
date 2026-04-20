"use client"

import { useMemo, memo } from "react"
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartContainer, ChartTooltipContent } from "@/ui/shadcn/chart"
import type { ChartConfig } from "@/ui/shadcn/chart"
import { useI18n } from "@/hooks/use-i18n"
import type { NativeViewProps } from "./registry"

interface SeriesDef {
  key: string
  label?: string
  color?: string
}

interface ChartPayload {
  series: SeriesDef[]
  data: Record<string, unknown>[]
  xKey?: string
}

const DEFAULT_PALETTE = [
  "#06b6d4",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#f97316",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
]

function isValidPayload(data: unknown): data is ChartPayload {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return Array.isArray(d.series) && Array.isArray(d.data)
}

const NativeLineChart = memo<NativeViewProps>(function NativeLineChart({
  data,
}) {
  const t = useI18n("chat")
  const payload = isValidPayload(data) ? data : null

  const xKey = payload?.xKey || "x"

  const chartConfig = useMemo<ChartConfig>(() => {
    if (!payload) return {}
    return Object.fromEntries(
      payload.series.map((s, i) => [
        s.key,
        {
          label: s.label || s.key,
          color: s.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
        },
      ])
    )
  }, [payload])

  if (!payload) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        {t("views.invalidPayload")}
      </div>
    )
  }

  if (payload.data.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        {t("views.noData")}
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={payload.data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="currentColor"
            className="stroke-[var(--muted)]/10"
          />
          <XAxis
            dataKey={xKey}
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
          />
          <Tooltip
            content={<ChartTooltipContent />}
            cursor={{
              stroke: "currentColor",
              strokeWidth: 1,
              strokeDasharray: "4 4",
            }}
          />
          {payload.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={
                s.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]
              }
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
})

export default NativeLineChart
