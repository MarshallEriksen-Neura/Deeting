"use client"

import { useTranslations } from "next-intl"
import { Activity, BarChart3 } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"
import { LatencyHeatmap } from "./latency-heatmap"
import { PercentileTrends } from "./percentile-trends"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Performance Diagnostics Section
 *
 * Blueprint Redesign:
 * - Uses GlassCard theme="blueprint" for industrial aesthetic
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
      <GlassCard theme="blueprint" hover="none" padding="none">
        <GlassCardHeader blueprint>
          <div className="flex flex-col gap-0.5">
            <GlassCardTitle blueprint>{t("heatmap.title")}</GlassCardTitle>
            <GlassCardDescription blueprint>{t("heatmap.description")}</GlassCardDescription>
          </div>
          <Activity className="h-4 w-4 text-[var(--primary)]" />
        </GlassCardHeader>
        <GlassCardContent blueprint>
          <LatencyHeatmap filters={filters} />
        </GlassCardContent>
        <div className="h-1 w-full bg-[var(--border)] opacity-30" />
      </GlassCard>

      {/* Sub Chart: P99 vs P50 Trends */}
      <GlassCard theme="blueprint" hover="none" padding="none">
        <GlassCardHeader blueprint>
          <div className="flex flex-col gap-0.5">
            <GlassCardTitle blueprint>{t("percentile.title")}</GlassCardTitle>
            <GlassCardDescription blueprint>{t("percentile.description")}</GlassCardDescription>
          </div>
          <BarChart3 className="h-4 w-4 text-[var(--ink-4)]" />
        </GlassCardHeader>
        <GlassCardContent blueprint>
          <PercentileTrends filters={filters} />
        </GlassCardContent>
        <div className="h-1 w-full bg-[var(--border)] opacity-30" />
      </GlassCard>
    </div>
  )
}
