"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { useLatencyHeatmap } from "@/lib/swr/use-latency-heatmap"

const LATENCY_MAX_MS = 2000
const LATENCY_TICKS = [0, 500, 1000, 1500, 2000]
const TIME_TICKS = [0, 6, 12, 18, 24]
const DEFAULT_CELL_SIZE = 12

type HeatmapCellData = {
  intensity: number
  count: number
}

type HeatmapPoint = {
  hour: number
  latency: number
  intensity: number
  count: number
  timeLabel: string
  size: number
}

/**
 * Latency Heatmap Component
 *
 * Advanced chart showing:
 * - X-axis: Time
 * - Y-axis: Latency (ms)
 * - Color intensity: Request count
 *
 * Reveals patterns like:
 * - Scattered dots at top = some requests extremely slow
 * - Entire block moving up = overall slowdown
 */
export function LatencyHeatmap({
  timeRange = "24h",
  model,
}: {
  timeRange?: "24h" | "7d" | "30d"
  model?: string
}) {
  const t = useTranslations("monitoring.performance.heatmap")
  const tUnits = useTranslations("monitoring.units")
  const { data, isLoading } = useLatencyHeatmap(timeRange, model)
  const formatMs = (value: number) => tUnits("msValue", { value })
  const formatRequests = (count: number) => t("requests", { count })
  const chartConfig = {
    intensity: { label: t("legend.label"), color: "hsl(var(--primary))" },
  }

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-[var(--muted)]">{t("loading")}</div>
      </div>
    )
  }

  // Sample data structure - would be replaced with real API data
  const heatmapData = data?.grid || generateSampleHeatmap()
  const heatmapPoints = useMemo(
    () => buildHeatmapPoints(heatmapData, DEFAULT_CELL_SIZE),
    [heatmapData]
  )

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="min-w-[720px]">
          <ChartContainer config={chartConfig} className="h-[360px] w-full">
            <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                opacity={0.3}
                vertical={false}
              />
              <XAxis
                type="number"
                dataKey="hour"
                domain={[0, 24]}
                ticks={TIME_TICKS}
                tickFormatter={formatHourLabel}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="latency"
                domain={[0, LATENCY_MAX_MS]}
                ticks={LATENCY_TICKS}
                tickFormatter={(value) => formatMs(value)}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <HeatmapTooltip
                    formatMs={formatMs}
                    formatRequests={formatRequests}
                  />
                }
              />
              <Scatter
                data={heatmapPoints}
                shape={<HeatmapCellShape />}
                isAnimationActive={false}
              />
            </ScatterChart>
          </ChartContainer>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <span>{t("legend.label")}:</span>
          <div className="flex items-center gap-1">
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((intensity) => (
              <div
                key={intensity}
                className="h-4 w-8 rounded"
                style={{
                  backgroundColor: `hsl(var(--primary) / ${intensity})`,
                }}
              />
            ))}
          </div>
          <span className="ml-2">{t("legend.more")}</span>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-[var(--muted)]">{t("stats.peak")}: </span>
            <span className="font-semibold text-[var(--foreground)]">
              {formatMs(data?.peakLatency ?? 1842)}
            </span>
          </div>
          <div>
            <span className="text-[var(--muted)]">{t("stats.median")}: </span>
            <span className="font-semibold text-[var(--foreground)]">
              {formatMs(data?.medianLatency ?? 240)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function HeatmapCellShape({
  cx,
  cy,
  payload,
}: {
  cx?: number
  cy?: number
  payload?: HeatmapPoint
}) {
  if (cx === undefined || cy === undefined || !payload) {
    return null
  }

  const size = payload.size || DEFAULT_CELL_SIZE
  const intensity = Math.max(0.05, payload.intensity)

  return (
    <rect
      x={cx - size / 2}
      y={cy - size / 2}
      width={size}
      height={size}
      rx={2}
      ry={2}
      fill={`hsl(var(--primary) / ${intensity})`}
      stroke="hsl(var(--border))"
      strokeOpacity={0.25}
    />
  )
}

function HeatmapTooltip({
  active,
  payload,
  formatMs,
  formatRequests,
}: {
  active?: boolean
  payload?: Array<{ payload?: HeatmapPoint }>
  formatMs: (value: number) => string
  formatRequests: (count: number) => string
}) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0]?.payload
  if (!point) {
    return null
  }

  return (
    <div className="border-border/50 bg-background grid min-w-[8rem] gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{point.timeLabel}</div>
      <div className="text-muted-foreground">{formatMs(point.latency)}</div>
      <div className="text-foreground font-mono font-medium tabular-nums">
        {formatRequests(point.count)}
      </div>
    </div>
  )
}

// Helper function to generate sample data
function generateSampleHeatmap() {
  const grid = []
  for (let col = 0; col < 24; col++) {
    const column = []
    for (let row = 0; row < 20; row++) {
      // Simulate different patterns
      const baseIntensity = Math.random() * 0.3
      const peakHour = col >= 8 && col <= 18 ? 0.4 : 0
      const highLatency = row > 15 ? Math.random() * 0.2 : 0

      column.push({
        intensity: Math.min(1, baseIntensity + peakHour + highLatency),
        count: Math.floor(Math.random() * 500),
      })
    }
    grid.push(column)
  }
  return grid
}

function buildHeatmapPoints(grid: HeatmapCellData[][], cellSize: number): HeatmapPoint[] {
  if (!grid.length) {
    return []
  }

  const rows = grid[0].length
  const latencyStep = rows > 1 ? LATENCY_MAX_MS / (rows - 1) : LATENCY_MAX_MS

  return grid.flatMap((column, colIndex) =>
    column.map((cell, rowIndex) => ({
      hour: colIndex,
      latency: Math.round(rowIndex * latencyStep),
      intensity: cell.intensity,
      count: cell.count,
      timeLabel: formatHourLabel(colIndex),
      size: cellSize,
    }))
  )
}

function formatHourLabel(hour: number) {
  const normalized = Math.min(24, Math.max(0, Math.round(hour)))
  return `${String(normalized).padStart(2, "0")}:00`
}
