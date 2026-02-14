"use client"

import useSWR from "swr"
import Link from "next/link"
import {
  LayoutDashboard,
  Users,
  Bot,
  Key,
  Activity,
  AlertTriangle,
  DollarSign,
  Zap,
  CheckCircle,
  Clock,
} from "lucide-react"
import {
  AdminPageShell,
  AdminStatCards,
  AdminStatusBadge,
  getStatusTone,
  Sparkline,
  type StatCardData,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import {
  fetchAdminApiKeysTotal,
  fetchAdminAssistantsTotal,
  fetchAdminPendingReviewCounts,
  fetchAdminUsersTotal,
} from "@/lib/api/admin-dashboard"
import { useDashboardStats } from "@/lib/swr/use-dashboard-stats"
import { useProviderHealth } from "@/lib/swr/use-provider-health"
import { useRecentErrors } from "@/lib/swr/use-recent-errors"

function formatTime(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function PageContent() {
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
        ? `${assistantStats.total}+`
        : assistantStats.total

  const stats: StatCardData[] = [
    {
      label: "Total Users",
      value: totalUsers?.toLocaleString() ?? "—",
      icon: Users,
      subtitle: `${activeUsers ?? 0} active accounts`,
      color: "primary",
    },
    {
      label: "Assistants",
      value: totalAssistantsValue,
      icon: Bot,
      subtitle: `${publishedAssistantStats?.total ?? 0} published`,
      color: "teal",
    },
    {
      label: "Active API Keys",
      value: activeApiKeys ?? "—",
      icon: Key,
      subtitle: `${revokedApiKeys ?? 0} revoked`,
      color: "amber",
    },
    {
      label: "Requests Today",
      value: `${((dashboardStats?.traffic.todayRequests ?? 0) / 1000).toFixed(1)}K`,
      icon: Activity,
      subtitle: `${(dashboardStats?.health.successRate ?? 0).toFixed(2)}% success rate`,
      color: "emerald",
    },
  ]

  const statusColorMap: Record<string, string> = {
    active: "rgb(52, 211, 153)",
    up: "rgb(52, 211, 153)",
    degraded: "rgb(251, 191, 36)",
    down: "rgb(248, 113, 113)",
  }

  return (
    <AdminPageShell
      title="Admin Dashboard"
      description="System overview and key metrics"
      icon={LayoutDashboard}
    >
      <AdminStatCards stats={stats} columns={4} />

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard padding="default" hover="none" className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              Provider Health
            </h3>
            <span className="text-xs text-[var(--muted)]">Real-time</span>
          </div>
          <div className="space-y-3">
            {(providerHealth ?? []).map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: statusColorMap[provider.status] ?? "rgb(148, 163, 184)",
                    }}
                  />
                  <span className="text-sm font-medium text-[var(--foreground)]">
                    {provider.name}
                  </span>
                  <AdminStatusBadge
                    text={provider.status}
                    tone={getStatusTone(provider.status)}
                    dot={false}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-[var(--muted)]">
                    {provider.latency > 0 ? `${provider.latency}ms` : "—"}
                  </span>
                  <Sparkline
                    data={provider.sparkline ?? []}
                    color={statusColorMap[provider.status] ?? "rgb(148, 163, 184)"}
                    width={80}
                    height={24}
                  />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard padding="default" hover="none">
          <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
            Pending Actions
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
                    Assistant Reviews
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Awaiting approval
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
                    Knowledge Reviews
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Pending processing
                  </p>
                </div>
              </div>
              <span className="flex size-6 items-center justify-center rounded-full bg-blue-500/10 text-xs font-bold text-blue-400">
                {pendingReviews?.knowledge_reviews ?? 0}
              </span>
            </Link>
          </div>

          <div className="mt-6 border-t border-white/5 pt-4">
            <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Financial Summary
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <DollarSign className="size-3" />
                  Monthly Spend
                </span>
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  ${(dashboardStats?.financial.monthlySpent ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <Zap className="size-3" />
                  Total Balance
                </span>
                <span className="text-sm font-semibold text-emerald-400">
                  ${(dashboardStats?.financial.balance ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <Activity className="size-3" />
                  Quota Usage
                </span>
                <span className="text-sm font-semibold text-teal-400">
                  {(dashboardStats?.financial.quotaUsedPercent ?? 0).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard padding="default" hover="none">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-rose-400" />
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              Recent Errors
            </h3>
          </div>
          <Link
            href="/admin/gateway-logs"
            className="cursor-pointer text-xs text-[var(--primary)] hover:underline"
          >
            View all logs →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Time
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Status
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Model
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Error
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Message
                </th>
              </tr>
            </thead>
            <tbody>
              {(recentErrors ?? []).map((errorItem) => (
                <tr key={errorItem.id} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2.5 font-mono text-xs text-[var(--muted)]">
                    {formatTime(errorItem.timestamp)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-xs font-medium text-rose-400">
                      {errorItem.statusCode}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--foreground)]">
                    {errorItem.model}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs text-amber-400">
                      {errorItem.errorCode ?? "—"}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2.5 text-xs text-[var(--muted)]">
                    {errorItem.errorMessage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </AdminPageShell>
  )
}
