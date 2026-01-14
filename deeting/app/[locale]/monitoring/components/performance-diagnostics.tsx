"use client"

import { useTranslations } from "next-intl"
import { Activity } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { LatencyHeatmap } from "./latency-heatmap"
import { PercentileTrends } from "./percentile-trends"

/**
 * Performance Diagnostics Section
 *
 * Two-part vertical layout:
 * 1. Latency Heatmap - Shows request distribution over time
 * 2. P99 vs P50 Trends - Tail latency monitoring
 */
export function PerformanceDiagnostics({ filters }: { filters: { timeRange: "24h" | "7d" | "30d"; model?: string } }) {
  const t = useTranslations("monitoring.performance")

  return (
    <div className="mb-6 space-y-6">
      {/* Main Chart: Latency Heatmap */}
      <GlassCard className="bg-[var(--card)]">
        <GlassCardHeader>
          <GlassCardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[var(--primary)]" />
            {t("heatmap.title")}
          </GlassCardTitle>
          <GlassCardDescription className="mt-1">
            {t("heatmap.description")}
          </GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent>
          <LatencyHeatmap timeRange={filters.timeRange} model={filters.model} />
        </GlassCardContent>
      </GlassCard>

      {/* Sub Chart: P99 vs P50 Trends */}
      <GlassCard className="bg-[var(--card)]">
        <GlassCardHeader>
          <GlassCardTitle>{t("percentile.title")}</GlassCardTitle>
          <GlassCardDescription className="mt-1">
            {t("percentile.description")}
          </GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent>
          <PercentileTrends timeRange={filters.timeRange} />
        </GlassCardContent>
      </GlassCard>
    </div>
  )
}
