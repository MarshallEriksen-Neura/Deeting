"use client"

import { useTranslations } from "next-intl"
import { Activity, BarChart3 } from "lucide-react"
import { BlueprintCard } from "@/ui/common/blueprint-card"
import { LatencyHeatmap } from "./latency-heatmap"
import { PercentileTrends } from "./percentile-trends"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Performance Diagnostics Section
 *
 * Blueprint Redesign:
 * - Uses BlueprintCard for industrial aesthetic
 * - Heatmap as primary focus
 * - Percentile trends as secondary focus
 */
export function PerformanceDiagnostics({
  filters,
}: {
  filters: MonitoringFilters
}) {
  const t = useTranslations("monitoring.performance")

  return (
    <div className="mb-8 space-y-8">
      {/* Main Chart: Latency Heatmap */}
      <BlueprintCard
        title={t("heatmap.title")}
        subtitle={t("heatmap.description")}
        headerAction={<Activity className="h-4 w-4 text-[var(--primary)]" />}
      >
        <LatencyHeatmap filters={filters} />
      </BlueprintCard>

      {/* Sub Chart: P99 vs P50 Trends */}
      <BlueprintCard
        title={t("percentile.title")}
        subtitle={t("percentile.description")}
        headerAction={<BarChart3 className="h-4 w-4 text-[var(--ink-4)]" />}
      >
        <PercentileTrends filters={filters} />
      </BlueprintCard>
    </div>
  )
}
