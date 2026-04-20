"use client"

import { ModelCostBreakdown } from "./model-cost-breakdown"
import { ErrorDistribution } from "./error-distribution"
import { KeyActivityRanking } from "./key-activity-ranking"
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
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left: Model Cost */}
      <ModelCostBreakdown filters={filters} />

      {/* Center: Error Distribution */}
      <ErrorDistribution filters={filters} />

      {/* Right: Key Activity */}
      <KeyActivityRanking filters={filters} />
    </div>
  )
}
