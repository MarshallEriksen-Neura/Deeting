"use client"

import { useTranslations } from "next-intl"
import { useLatencyHeatmap } from "@/lib/swr/use-latency-heatmap"
import { cn } from "@/lib/utils"

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

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-[var(--muted)]">{t("loading")}</div>
      </div>
    )
  }

  // Sample data structure - would be replaced with real API data
  const heatmapData = data?.grid || generateSampleHeatmap()

  return (
    <div className="space-y-4">
      {/* Heatmap Canvas */}
      <div className="relative h-[400px] overflow-x-auto overflow-y-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]">
        <div className="relative h-full min-w-[720px]">
          {/* Y-axis labels (Latency) */}
          <div className="absolute left-0 top-0 bottom-0 flex w-16 flex-col justify-between py-8 pr-2 text-right text-xs text-[var(--muted)]">
            <span>{formatMs(2000)}</span>
            <span>{formatMs(1500)}</span>
            <span>{formatMs(1000)}</span>
            <span>{formatMs(500)}</span>
            <span>{formatMs(0)}</span>
          </div>

          {/* Heatmap Grid */}
          <div className="ml-16 h-full p-4">
            <div className="grid h-full grid-cols-24 gap-1">
              {heatmapData.map((column, colIndex) => (
                <div key={colIndex} className="flex flex-col-reverse gap-1">
                  {column.map((cell, rowIndex) => (
                    <HeatmapCell
                      key={rowIndex}
                      intensity={cell.intensity}
                      count={cell.count}
                      formatRequests={formatRequests}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* X-axis labels (Time) */}
          <div className="absolute bottom-0 left-16 right-0 flex justify-between px-4 pb-2 text-xs text-[var(--muted)]">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
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

function HeatmapCell({
  intensity,
  count,
  formatRequests,
}: {
  intensity: number
  count: number
  formatRequests: (count: number) => string
}) {
  return (
    <div
      className={cn(
        "group relative h-full w-full rounded-sm transition-all hover:ring-2 hover:ring-[var(--primary)]"
      )}
      style={{
        backgroundColor: `hsl(var(--primary) / ${Math.max(0.05, intensity)})`,
      }}
      title={formatRequests(count)}
    >
      {/* Tooltip on hover */}
      <div className="pointer-events-none absolute left-1/2 bottom-full mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--foreground)] px-2 py-1 text-xs text-[var(--background)] group-hover:block">
        {formatRequests(count)}
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
