"use client"

import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { CheckCircle, Clock, DollarSign, Zap, Activity, Shield } from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"

interface PendingActionsCardProps {
  /**
   * 待审核数量
   */
  pendingReviews?: Record<string, number>
  /**
   * 仪表盘统计数据
   */
  dashboardStats?: Record<string, unknown> | null
}

export function PendingActionsCard({
  pendingReviews,
  dashboardStats,
}: PendingActionsCardProps) {
  const t = useTranslations("admin.dashboard")
  const locale = useLocale()
  const currencyFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

  return (
    <GlassCard padding="default" hover="none">
      <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
        {t("pendingActions.title")}
      </h3>
      <div className="space-y-3">
        <Link
          href="/admin/assistant-reviews"
          className="flex cursor-pointer items-center justify-between rounded-lg bg-white/[0.02] px-3 py-3 transition-colors hover:bg-white/[0.05]"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10">
              <CheckCircle className="size-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">
                {t("pendingActions.assistantReviewsTitle")}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {t("pendingActions.assistantReviewsSubtitle")}
              </p>
            </div>
          </div>
          <span className="flex size-6 items-center justify-center rounded-full bg-amber-500/10 text-xs font-bold text-amber-400">
            {pendingReviews?.assistant_reviews ?? 0}
          </span>
        </Link>

        <Link
          href="/admin/knowledge/reviews"
          className="flex cursor-pointer items-center justify-between rounded-lg bg-white/[0.02] px-3 py-3 transition-colors hover:bg-white/[0.05]"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10">
              <Clock className="size-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">
                {t("pendingActions.knowledgeReviewsTitle")}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {t("pendingActions.knowledgeReviewsSubtitle")}
              </p>
            </div>
          </div>
          <span className="flex size-6 items-center justify-center rounded-full bg-blue-500/10 text-xs font-bold text-blue-400">
            {pendingReviews?.knowledge_reviews ?? 0}
          </span>
        </Link>

        <Link
          href="/admin/plugin-reviews"
          className="flex cursor-pointer items-center justify-between rounded-lg bg-white/[0.02] px-3 py-3 transition-colors hover:bg-white/[0.05]"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-500/10">
              <Shield className="size-4 text-rose-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">
                {t("pendingActions.pluginReviewsTitle")}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {t("pendingActions.pluginReviewsSubtitle")}
              </p>
            </div>
          </div>
          <span className="flex size-6 items-center justify-center rounded-full bg-rose-500/10 text-xs font-bold text-rose-400">
            {pendingReviews?.plugin_reviews ?? 0}
          </span>
        </Link>
      </div>

      <div className="mt-6 border-t border-white/5 pt-4">
        <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          {t("pendingActions.financialSummary")}
        </h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <DollarSign className="size-3" />
              {t("pendingActions.monthlySpend")}
            </span>
            <span className="text-sm font-semibold text-[var(--foreground)]">
              $
              {currencyFormatter.format(
                (dashboardStats?.financial as Record<string, number>)?.monthlySpent ?? 0
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Zap className="size-3" />
              {t("pendingActions.totalBalance")}
            </span>
            <span className="text-sm font-semibold text-emerald-400">
              $
              {currencyFormatter.format(
                (dashboardStats?.financial as Record<string, number>)?.balance ?? 0
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Activity className="size-3" />
              {t("pendingActions.quotaUsage")}
            </span>
            <span className="text-sm font-semibold text-teal-400">
              {((dashboardStats?.financial as Record<string, number>)?.quotaUsedPercent ?? 0).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

export default PendingActionsCard
