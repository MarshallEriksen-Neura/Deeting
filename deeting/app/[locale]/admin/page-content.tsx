"use client"

import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { LayoutDashboard, Users, Bot, Key, Activity } from "lucide-react"
import {
  AdminPageShell,
  AdminStatCards,
  type StatCardData,
} from "@/components/admin"
import {
  fetchAdminApiKeysTotal,
  fetchAdminAssistantsTotal,
  fetchAdminPendingReviewCounts,
  fetchAdminUsersTotal,
} from "@/lib/api/admin-dashboard"
import { useDashboardStats } from "@/lib/swr/use-dashboard-stats"
import { useProviderHealth } from "@/lib/swr/use-provider-health"
import { useRecentErrors } from "@/lib/swr/use-recent-errors"

import { ProviderHealthCard } from "./components/provider-health-card"
import { PendingActionsCard } from "./components/pending-actions-card"
import { RecentErrorsCard } from "./components/recent-errors-card"

export function PageContent() {
  const t = useTranslations("admin")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const compactNumberFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const { data: dashboardStats } = useDashboardStats()
  const { data: providerHealth } = useProviderHealth()
  const { data: recentErrors } = useRecentErrors(5)

  const { data: totalUsers } = useSWR(
    "/api/v1/admin/users?limit=1",
    () => fetchAdminUsersTotal()
  )
  const { data: activeUsers } = useSWR(
    "/api/v1/admin/users?limit=1&is_active=true",
    () => fetchAdminUsersTotal({ is_active: true })
  )
  const { data: activeApiKeys } = useSWR(
    "/api/v1/admin/api-keys?limit=1&status=active",
    () => fetchAdminApiKeysTotal({ status: "active" })
  )
  const { data: revokedApiKeys } = useSWR(
    "/api/v1/admin/api-keys?limit=1&status=revoked",
    () => fetchAdminApiKeysTotal({ status: "revoked" })
  )
  const { data: assistantStats } = useSWR(
    "/api/v1/admin/assistants?size=100",
    () => fetchAdminAssistantsTotal()
  )
  const { data: publishedAssistantStats } = useSWR(
    "/api/v1/admin/assistants?size=100&status=published",
    () => fetchAdminAssistantsTotal({ status: "published" })
  )
  const { data: pendingReviews } = useSWR(
    "/api/v1/admin/pending-reviews",
    fetchAdminPendingReviewCounts
  )

  const totalAssistantsValue =
    assistantStats == null
      ? "—"
      : assistantStats.has_more
        ? `${numberFormatter.format(assistantStats.total)}+`
        : numberFormatter.format(assistantStats.total)

  const stats: StatCardData[] = [
    {
      label: t("stats.totalUsers"),
      value: totalUsers == null ? "—" : numberFormatter.format(totalUsers),
      icon: Users,
      subtitle: t("dashboard.stats.activeAccounts", {
        count: numberFormatter.format(activeUsers ?? 0),
      }),
      color: "primary",
    },
    {
      label: t("stats.totalAssistants"),
      value: totalAssistantsValue,
      icon: Bot,
      subtitle: t("dashboard.stats.publishedAssistants", {
        count: numberFormatter.format(publishedAssistantStats?.total ?? 0),
      }),
      color: "teal",
    },
    {
      label: t("stats.activeApiKeys"),
      value: activeApiKeys == null ? "—" : numberFormatter.format(activeApiKeys),
      icon: Key,
      subtitle: t("dashboard.stats.revokedApiKeys", {
        count: numberFormatter.format(revokedApiKeys ?? 0),
      }),
      color: "amber",
    },
    {
      label: t("stats.requestsToday"),
      value: compactNumberFormatter.format(dashboardStats?.traffic.todayRequests ?? 0),
      icon: Activity,
      subtitle: t("dashboard.stats.successRate", {
        rate: (dashboardStats?.health.successRate ?? 0).toFixed(2),
      }),
      color: "emerald",
    },
  ]

  return (
    <AdminPageShell
      title={t("dashboard.title")}
      description={t("dashboard.description")}
      icon={LayoutDashboard}
    >
      <AdminStatCards stats={stats} columns={4} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Provider Health */}
        <ProviderHealthCard providers={providerHealth ?? []} />

        {/* Pending Actions */}
        <PendingActionsCard
          pendingReviews={pendingReviews}
          dashboardStats={dashboardStats}
        />
      </div>

      {/* Recent Errors */}
      <RecentErrorsCard errors={recentErrors ?? []} />
    </AdminPageShell>
  )
}
