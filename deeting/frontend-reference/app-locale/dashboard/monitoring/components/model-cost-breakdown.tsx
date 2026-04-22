"use client"

import { useTranslations } from "next-intl"
import { DollarSign } from "lucide-react"
import { BlueprintCard } from "@/ui/common/blueprint-card"
import { useModelCostBreakdown } from "@/lib/swr/use-model-cost-breakdown"
import { cn } from "@/lib/utils"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Model Cost Breakdown - Blueprint Edition
 */
export function ModelCostBreakdown({ filters }: { filters: MonitoringFilters }) {
  const t = useTranslations("monitoring.dimensional.modelCost")
  const { data, isLoading } = useModelCostBreakdown(filters, {
    autoRefresh: filters.autoRefresh,
  })

  const models = data?.models ?? []
  const totalCost = models.reduce((sum, m) => sum + m.cost, 0)

  return (
    <BlueprintCard
      title={t("title")}
      subtitle={t("description")}
      headerAction={<DollarSign className="h-4 w-4 text-amber-500/70" />}
    >
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse bg-[var(--border)]" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Total Cost Section */}
          <div className="border border-amber-500/20 bg-amber-500/5 p-4 flex items-end justify-between">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-amber-600/60">{t("total")}</span>
              <span className="font-mono text-2xl font-bold text-amber-600 tabular-nums">
                ${totalCost.toFixed(2)}
              </span>
            </div>
            <div className="h-2 w-2 bg-amber-500/40 animate-pulse" />
          </div>

          {/* Model Bars */}
          <div className="space-y-5">
            {models.map((model, index) => (
              <div key={model.name} className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--ink-4)]">0{index + 1}</span>
                    <span className="font-bold uppercase tracking-tight text-[var(--foreground)]">{model.name}</span>
                  </div>
                  <span className="font-bold text-[var(--foreground)] tabular-nums">
                    ${model.cost.toFixed(2)}
                  </span>
                </div>
                <div className="relative h-1 bg-[var(--border)]">
                  <div
                    className="h-full bg-amber-500/60 transition-all duration-1000"
                    style={{ width: `${model.percentage}%` }}
                  />
                  {/* Tick marks on the bar */}
                  <div className="absolute inset-0 flex justify-between px-px pointer-events-none">
                     {[...Array(5)].map((_, i) => (
                       <div key={i} className="h-full w-px bg-white/20" />
                     ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </BlueprintCard>
  )
}
