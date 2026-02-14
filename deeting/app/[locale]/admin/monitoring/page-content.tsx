"use client"

import { useLocale, useTranslations } from "next-intl"
import {
  Eye,
  Activity,
  Zap,
  Timer,
  Shield,
  AlertTriangle,
} from "lucide-react"
import {
  AdminPageShell,
  AdminStatCards,
  AdminStatusBadge,
  getStatusTone,
  Sparkline,
  DonutChart,
  BarChartMini,
  type StatCardData,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import { useDashboardStats } from "@/lib/swr/use-dashboard-stats"
import { useProviderHealth } from "@/lib/swr/use-provider-health"
import { useRecentErrors } from "@/lib/swr/use-recent-errors"
import { useSmartRouterStats } from "@/lib/swr/use-smart-router-stats"
import { useTokenThroughput } from "@/lib/swr/use-token-throughput"

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.monitoringPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const compactNumberFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const percentageFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const formatTime = (value?: string) => {
    if (!value) return "—"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
  }

  const formatTimelineLabel = (value: string) => {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit" }).format(date)
    }
    return value.length > 5 ? value.slice(0, 5) : value
  }

  const { data: dashboardStats } = useDashboardStats()
  const { data: tokenThroughput } = useTokenThroughput("24h")
  const { data: routerStats } = useSmartRouterStats()
  const { data: providerHealth } = useProviderHealth()
  const { data: recentErrors } = useRecentErrors(20)

  const stats: StatCardData[] = [
    {
      label: t("stats.successRate"),
      value: `${percentageFormatter.format(dashboardStats?.health.successRate ?? 0)}%`,
      icon: Activity,
      color: "emerald",
      subtitle: t("stats.last24Hours"),
    },
    {
      label: t("stats.avgTtft"),
      value: t("stats.ms", { value: numberFormatter.format(Math.round(dashboardStats?.speed.avgTTFT ?? 0)) }),
      icon: Timer,
      color: "primary",
      subtitle: t("stats.timeToFirstToken"),
    },
    {
      label: t("stats.todayRequests"),
      value: compactNumberFormatter.format(dashboardStats?.traffic.todayRequests ?? 0),
      icon: Zap,
      color: "teal",
      trend:
        dashboardStats?.traffic.trendPercent != null
          ? {
              value: dashboardStats.traffic.trendPercent,
              isPositive: dashboardStats.traffic.trendPercent >= 0,
            }
          : undefined,
    },
    {
      label: t("stats.cacheHitRate"),
      value: `${percentageFormatter.format(routerStats?.cacheHitRate ?? 0)}%`,
      icon: Shield,
      color: "amber",
      subtitle: t("stats.saved", { value: percentageFormatter.format(routerStats?.costSavings ?? 0) }),
    },
  ]

  const last12h = (tokenThroughput?.timeline ?? []).slice(-12)
  const barData = last12h.map((item) => ({
    label: formatTimelineLabel(item.time),
    value: Math.round(item.inputTokens / 1000),
    color: "var(--primary)",
  }))

  const statusColorMap: Record<string, string> = {
    active: "rgb(52, 211, 153)",
    up: "rgb(52, 211, 153)",
    degraded: "rgb(251, 191, 36)",
    down: "rgb(248, 113, 113)",
  }

  const providerStatusLabelMap: Record<string, string> = {
    active: t("status.active"),
    up: t("status.up"),
    degraded: t("status.degraded"),
    down: t("status.down"),
  }

  return (
    <AdminPageShell
      title={tAdmin("monitoring.title")}
      description={tAdmin("monitoring.description")}
      icon={Eye}
    >
      <AdminStatCards stats={stats} columns={4} />

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard padding="default" hover="none" className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              {t("tokenThroughput.title")}
            </h3>
            <span className="text-xs text-[var(--muted)]">{t("tokenThroughput.unit")}</span>
          </div>
          <BarChartMini data={barData} height={160} />
        </GlassCard>

        <GlassCard padding="default" hover="none">
          <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
            {t("smartRouter.title")}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center gap-2">
              <DonutChart
                value={routerStats?.cacheHitRate ?? 0}
                total={100}
                size={56}
                color="var(--primary)"
                label={`${Math.round(routerStats?.cacheHitRate ?? 0)}%`}
              />
              <span className="text-xs text-[var(--muted)]">{t("smartRouter.cacheHit")}</span>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-lg bg-white/[0.02] p-3">
              <span className="text-xl font-bold text-emerald-400">
                {percentageFormatter.format(routerStats?.costSavings ?? 0)}%
              </span>
              <span className="text-xs text-[var(--muted)]">{t("smartRouter.costSavings")}</span>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-lg bg-white/[0.02] p-3">
              <span className="text-xl font-bold text-amber-400">
                {numberFormatter.format(routerStats?.requestsBlocked ?? 0)}
              </span>
              <span className="text-xs text-[var(--muted)]">{t("smartRouter.blocked")}</span>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-lg bg-white/[0.02] p-3">
              <span className="text-xl font-bold text-teal-400">
                {percentageFormatter.format(routerStats?.avgSpeedup ?? 0)}x
              </span>
              <span className="text-xs text-[var(--muted)]">{t("smartRouter.avgSpeedup")}</span>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard padding="default" hover="none">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {t("providerHealth.title")}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("providerHealth.columns.provider")}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("providerHealth.columns.status")}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("providerHealth.columns.latency")}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("providerHealth.columns.priority")}
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {t("providerHealth.columns.trend")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(providerHealth ?? []).map((provider) => {
                const providerStatus = provider.status ?? "down"
                return (
                  <tr key={provider.id} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: statusColorMap[providerStatus] ?? "#888" }}
                        />
                        <span className="font-medium text-[var(--foreground)]">{provider.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <AdminStatusBadge
                        text={providerStatusLabelMap[providerStatus] ?? providerStatus}
                        tone={getStatusTone(providerStatus)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={provider.latency > 200 ? "text-amber-400" : provider.latency === 0 ? "text-rose-400" : "text-emerald-400"}>
                        {provider.latency > 0 ? t("stats.ms", { value: numberFormatter.format(provider.latency) }) : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--muted)]">{numberFormatter.format(provider.priority)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Sparkline
                        data={provider.sparkline ?? []}
                        color={statusColorMap[providerStatus] ?? "#888"}
                        width={80}
                        height={24}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard padding="default" hover="none">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="size-4 text-rose-400" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {t("recentErrors.title")}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("recentErrors.columns.time")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("recentErrors.columns.status")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("recentErrors.columns.model")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("recentErrors.columns.errorCode")}</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{t("recentErrors.columns.message")}</th>
              </tr>
            </thead>
            <tbody>
              {(recentErrors ?? []).map((errorItem) => (
                <tr key={errorItem.id} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2.5 font-mono text-xs text-[var(--muted)]">{formatTime(errorItem.timestamp)}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-xs font-medium text-rose-400">
                      {errorItem.statusCode}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--foreground)]">{errorItem.model}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-amber-400">{errorItem.errorCode ?? "—"}</td>
                  <td className="max-w-xs truncate px-3 py-2.5 text-xs text-[var(--muted)]">{errorItem.errorMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </AdminPageShell>
  )
}
