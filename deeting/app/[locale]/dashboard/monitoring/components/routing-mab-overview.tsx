"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import { Crosshair, CheckCircle, ShieldOff, Layers } from "lucide-react"
import { AdminStatCards, type StatCardData } from "@/components/admin/admin-stat-cards"
import { useRoutingOverview } from "@/lib/swr/use-routing-mab"

export const RoutingMabOverview = memo(function RoutingMabOverview() {
  const t = useTranslations("monitoring.routing.overview")
  const { data, isLoading } = useRoutingOverview()

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[110px] animate-pulse rounded-2xl bg-[var(--card)]/60 border border-white/10"
          />
        ))}
      </div>
    )
  }

  const stats: StatCardData[] = [
    {
      label: t("totalTrials"),
      value: data.totalTrials.toLocaleString(),
      icon: Crosshair,
      color: "primary",
    },
    {
      label: t("successRate"),
      value: `${(data.overallSuccessRate * 100).toFixed(1)}%`,
      icon: CheckCircle,
      color: data.overallSuccessRate >= 0.9 ? "emerald" : data.overallSuccessRate >= 0.7 ? "amber" : "rose",
    },
    {
      label: t("activeArms"),
      value: data.activeArms,
      icon: Layers,
      color: "teal",
      subtitle: `${data.totalArms} ${t("totalArms")}`,
    },
    {
      label: t("cooldownArms"),
      value: data.cooldownArms,
      icon: ShieldOff,
      color: data.cooldownArms > 0 ? "rose" : "default",
    },
  ]

  return <AdminStatCards stats={stats} columns={4} />
})
