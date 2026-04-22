"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip } from "@/ui/shadcn/chart"
import { useLatencyHeatmap } from "@/lib/swr/use-latency-heatmap"
import type { MonitoringFilters } from "./monitoring-control-bar"

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
  filters,
}: {
  filters: MonitoringFilters
}) {
  const t = useTranslations("monitoring.performance.heatmap")
  const tUnits = useTranslations("monitoring.units")
  const { data, isLoading } = useLatencyHeatmap(filters, {
    autoRefresh: filters.autoRefresh,
  })
  const formatMs = (value: number) => tUnits("msValue", { value })
  const formatRequests = (count: number) => t("requests", { count })
  const chartConfig = {
    intensity: { label: t("legend.label"), color: "var(--primary)" },
  }

  const heatmapPoints = useMemo(
    () => buildHeatmapPoints(data?.grid ?? [], DEFAULT_CELL_SIZE),
    [data?.grid]
  )

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-[var(--muted)]">{t("loading")}</div>
      </div>
    )
  }

  if (!heatmapPoints.length) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
        <div className="text-sm text-[var(--muted)]">{t("empty")}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="min-w-[720px]">
        <ChartContainer config={chartConfig} className="h-[320px] w-full">
          <ScatterChart margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="2 4"
              stroke="var(--border)"
              vertical={true}
            />
            <XAxis
              type="number"
              dataKey="hour"
              domain={[0, 24]}
              ticks={TIME_TICKS}
              tickFormatter={formatHourLabel}
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              allowDecimals={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            />
            <YAxis
              type="number"
              dataKey="latency"
              domain={[0, LATENCY_MAX_MS]}
              ticks={LATENCY_TICKS}
              tickFormatter={(value) => formatMs(value)}
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              allowDecimals={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            />
            <ChartTooltip
              cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
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

      {/* Legend & Stats */}
      <div className="flex items-end justify-between border-t border-[var(--border)] pt-4">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink-4)]">{t("legend.label")}</span>
          <div className="flex items-center gap-1">
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((intensity) => (
              <div
                key={intensity}
                className="h-2 w-8"
                style={{
                  backgroundColor: "var(--primary)",
                  opacity: intensity,
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-8 font-mono">
          <div className="flex flex-col items-end">
            <span className="text-[9px] uppercase text-[var(--ink-4)]">{t("stats.peak")}</span>
            <span className="text-sm font-bold text-[var(--foreground)]">
              {formatMs(data?.peakLatency ?? 0)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] uppercase text-[var(--ink-4)]">{t("stats.median")}</span>
            <span className="text-sm font-bold text-[var(--foreground)]">
              {formatMs(data?.medianLatency ?? 0)}
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
      fill="var(--primary)"
      fillOpacity={intensity}
      stroke="var(--border)"
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

function buildHeatmapPoints(grid: HeatmapCellData[][], cellSize: number): HeatmapPoint[] {
  if (!grid.length) {
    return []
  }

  const rows = grid[0].length
  const latencyStep = rows > 1 ? LATENCY_MAX_MS / (rows - 1) : LATENCY_MAX_MS

  return grid.flatMap((column, colIndex) =>
    column.flatMap((cell, rowIndex) =>
      cell.count > 0
        ? [
            {
              hour: colIndex,
              latency: Math.round(rowIndex * latencyStep),
              intensity: cell.intensity,
              count: cell.count,
              timeLabel: formatHourLabel(colIndex),
              size: cellSize,
            },
          ]
        : []
    )
  )
}

function formatHourLabel(hour: number) {
  const normalized = Math.min(24, Math.max(0, Math.round(hour)))
  return `${String(normalized).padStart(2, "0")}:00`
}
