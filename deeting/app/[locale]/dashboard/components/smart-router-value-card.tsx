"use client"

import { useTranslations } from "next-intl"
import { Shield, DollarSign, Zap } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { cn } from "@/lib/utils"
import { useSmartRouterStats } from "@/lib/swr/use-smart-router-stats"

/**
 * Smart Router Value Card
 *
 * Highlights the value provided by the smart routing system:
 * - Cache hit rate (percentage)
 * - Cost savings (dollar amount)
 * - Background shield/lightning icon for visual impact
 */
export function SmartRouterValueCard() {
  const t = useTranslations("dashboard.smartRouter")
  const { data: stats, isLoading } = useSmartRouterStats()

  const cacheHitRate = stats?.cacheHitRate || 0
  const costSavings = stats?.costSavings || 0

  return (
    <GlassCard className="relative h-full overflow-hidden">
      {/* Background decorative icon */}
      <div className="absolute -right-8 -top-8 opacity-[0.03]">
        <Shield className="h-48 w-48" />
      </div>
      <div className="absolute -bottom-6 -left-6 opacity-[0.03]">
        <Zap className="h-32 w-32" />
      </div>

      <GlassCardHeader>
        <GlassCardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[var(--teal-accent)]" />
          {t("title")}
        </GlassCardTitle>
        <GlassCardDescription className="mt-1">
          {t("description")}
        </GlassCardDescription>
      </GlassCardHeader>

      <GlassCardContent className="space-y-6">
        {/* Cache Hit Rate */}
        <div className="relative">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--muted)]">
              {t("cacheHitRate")}
            </span>
            {isLoading ? (
              <span className="inline-block h-8 w-16 animate-pulse rounded bg-[var(--foreground)]/10" />
            ) : (
              <span className="text-3xl font-bold text-[var(--foreground)] tabular-nums">
                {cacheHitRate}%
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="relative h-3 overflow-hidden rounded-full bg-[var(--muted)]/20">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-1000 ease-out",
                "bg-gradient-to-r from-[var(--teal-accent)] to-cyan-400"
              )}
              style={{ width: isLoading ? "0%" : `${cacheHitRate}%` }}
            />
          </div>

          {/* Benchmark indicator */}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>{t("industry")}: 20-30%</span>
            </div>
            {cacheHitRate > 30 && (
              <span className="ml-auto font-semibold text-emerald-400">
                {t("outperforming")}
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[var(--border)]/50" />

        {/* Cost Savings */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--muted)]">
              {t("costSavings")}
            </span>
            {isLoading ? (
              <span className="inline-block h-8 w-20 animate-pulse rounded bg-[var(--foreground)]/10" />
            ) : (
              <span className="text-3xl font-bold text-amber-400 tabular-nums">
                ${costSavings.toFixed(2)}
              </span>
            )}
          </div>

          <div className="text-xs text-[var(--muted)]">
            {t("thisMonth")}
          </div>
        </div>

        {/* Value Proposition Cards */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <ValueCard
            icon={Shield}
            label={t("protection")}
            value={stats?.requestsBlocked || 0}
            suffix={t("blocked")}
          />
          <ValueCard
            icon={Zap}
            label={t("acceleration")}
            value={stats?.avgSpeedup || 0}
            suffix="ms"
            isSpeedup
          />
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}

// Mini value card component
function ValueCard({
  icon: Icon,
  label,
  value,
  suffix,
  isSpeedup = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  suffix: string
  isSpeedup?: boolean
}) {
  return (
    <div className="rounded-lg bg-[var(--muted)]/10 p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-[var(--muted)]" />
        <span className="text-xs text-[var(--muted)]">{label}</span>
      </div>
      <div className="font-mono text-lg font-bold text-[var(--foreground)] tabular-nums">
        {isSpeedup && value > 0 && "-"}
        {value.toLocaleString()}
        <span className="ml-1 text-xs font-normal text-[var(--muted)]">
          {suffix}
        </span>
      </div>
    </div>
  )
}
