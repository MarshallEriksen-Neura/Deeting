"use client"

import { useTranslations } from "next-intl"
import { Key } from "lucide-react"
import { BlueprintCard } from "@/ui/common/blueprint-card"
import { useKeyActivityRanking } from "@/lib/swr/use-key-activity-ranking"
import { cn } from "@/lib/utils"
import type { MonitoringFilters } from "./monitoring-control-bar"

/**
 * Key Activity Ranking - Blueprint Edition
 */
export function KeyActivityRanking({ filters }: { filters: MonitoringFilters }) {
  const t = useTranslations("monitoring.dimensional.keyActivity")
  const { data, isLoading } = useKeyActivityRanking(filters, 5, {
    autoRefresh: filters.autoRefresh,
  })

  const topKeys = data?.keys ?? []

  return (
    <BlueprintCard
      title={t("title")}
      subtitle={t("description")}
      headerAction={<Key className="h-4 w-4 text-[var(--accent-strong)]/70" />}
    >
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse bg-[var(--border)]" />
          ))}
        </div>
      ) : (
        <div className="space-y-px bg-[var(--border)] border border-[var(--border)]">
          {topKeys.map((key, index) => (
            <div 
              key={key.id} 
              className="bg-[var(--card)] p-3 flex items-center justify-between group hover:bg-[var(--primary)]/5 transition-colors"
            >
              <div className="flex items-center gap-4 min-w-0">
                <span className="font-mono text-[10px] text-[var(--ink-4)]">0{index + 1}</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-mono text-[11px] font-bold uppercase truncate text-[var(--foreground)]">
                    {key.name}
                  </span>
                  <span className="font-mono text-[9px] text-[var(--ink-4)]">
                    {key.maskedKey}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-base font-bold tabular-nums text-[var(--foreground)]">
                      {key.rpm}
                    </span>
                    {key.trend !== 0 && (
                      <span className={cn(
                        "font-mono text-[9px] font-bold",
                        key.trend > 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"
                      )}>
                        {key.trend > 0 ? "+" : ""}{key.trend}%
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[8px] uppercase tracking-wider text-[var(--ink-4)]">{t("rpm")}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </BlueprintCard>
  )
}
