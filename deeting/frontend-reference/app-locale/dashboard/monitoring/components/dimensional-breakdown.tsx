"use client"

import { TokenThroughputChart } from "@/frontend-reference/app-locale/dashboard/components/token-throughput-chart"
import { useDashboardOverview } from "@/lib/swr/use-dashboard-overview"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Dimensional Breakdown Section
 *
 * Three-column layout for multi-dimensional analysis:
 * 1. Model Cost - Who's consuming the most budget
 * 2. Error Distribution - Quick fault attribution
 * 3. Key Activity - Top 5 most active API keys
 */
export function DimensionalBreakdown({
  filters,
}: {
  filters: MonitoringFilters
}) {
  const { data: overview, isLoading } = useDashboardOverview({
    source: "auto",
    period: filters.timeRange,
    recentErrorLimit: 10,
  })

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-3">
        <TokenThroughputChart
          data={overview?.tokenThroughput}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
