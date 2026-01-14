"use client"

import { useTranslations } from "next-intl"
import { ModelCostBreakdown } from "./model-cost-breakdown"
import { ErrorDistribution } from "./error-distribution"
import { KeyActivityRanking } from "./key-activity-ranking"

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
  filters: { timeRange: "24h" | "7d" | "30d"; model?: string; apiKey?: string; errorCode?: string }
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left: Model Cost */}
      <ModelCostBreakdown timeRange={filters.timeRange} />

      {/* Center: Error Distribution */}
      <ErrorDistribution timeRange={filters.timeRange} model={filters.model} />

      {/* Right: Key Activity */}
      <KeyActivityRanking timeRange={filters.timeRange} />
    </div>
  )
}
