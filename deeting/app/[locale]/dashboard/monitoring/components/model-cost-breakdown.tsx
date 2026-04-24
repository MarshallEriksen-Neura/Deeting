"use client"

import { useTranslations } from "next-intl"
import { DollarSign } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"
import { useModelCostBreakdown } from "@/lib/swr/use-model-cost-breakdown"
import { cn } from "@/lib/utils"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Model Cost Breakdown Component
 *
 * Horizontal bar chart showing cost by model
 * Purpose: Identify which models are consuming the most budget
 */
export function ModelCostBreakdown({ filters }: { filters: MonitoringFilters }) {
  const t = useTranslations("monitoring.dimensional.modelCost")
  const { data, isLoading } = useModelCostBreakdown(filters, {
    autoRefresh: filters.autoRefresh,
  })

  const models = data?.models ?? []

  const totalCost = models.reduce((sum, m) => sum + m.cost, 0)

  return (
    <GlassCard className="bg-[var(--card)]">
      <GlassCardHeader>
        <GlassCardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-amber-400" />
          {t("title")}
        </GlassCardTitle>
        <GlassCardDescription className="mt-1">
          {t("description")}
        </GlassCardDescription>
      </GlassCardHeader>
      <GlassCardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded bg-[var(--foreground)]/5"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Total Cost */}
            <div className="rounded-lg bg-amber-500/10 p-3">
              <div className="text-xs text-[var(--muted)]">{t("total")}</div>
              <div className="text-2xl font-bold text-amber-400 tabular-nums">
                ${totalCost.toFixed(2)}
              </div>
            </div>

            {/* Model Bars */}
            <div className="space-y-3">
              {models.map((model, index) => (
                <ModelBar key={model.name} model={model} rank={index + 1} />
              ))}
            </div>
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}

function ModelBar({
  model,
  rank,
}: {
  model: { name: string; cost: number; percentage: number }
  rank: number
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)]/10 text-xs font-semibold text-[var(--primary)]">
            {rank}
          </span>
          <span className="font-medium text-[var(--foreground)]">{model.name}</span>
        </div>
        <span className="font-mono font-semibold text-[var(--foreground)] tabular-nums">
          ${model.cost.toFixed(2)}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-[var(--muted)]/20">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000",
            "bg-gradient-to-r from-amber-400 to-amber-500"
          )}
          style={{ width: `${model.percentage}%` }}
        />
      </div>
    </div>
  )
}
