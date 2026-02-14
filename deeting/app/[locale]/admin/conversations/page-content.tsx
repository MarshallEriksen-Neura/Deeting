"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { MessageSquare } from "lucide-react"
import {
  AdminPageShell,
  AdminStatCards,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import {
  fetchAdminConversations,
  type ConversationItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.conversationsPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [channelFilter, setChannelFilter] = useState("")

  const { data, error, isLoading } = useSWR(
    "/api/v1/admin/conversations?limit=100",
    () => fetchAdminConversations({ limit: 100 })
  )

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false
      if (channelFilter && row.channel !== channelFilter) return false
      if (!query) return true
      return [row.title, row.id, row.user_id, row.assistant_id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, statusFilter, channelFilter])

  const total = allRows.length
  const active = allRows.filter((item) => item.status === "active").length
  const closed = allRows.filter((item) => item.status === "closed").length
  const archived = allRows.filter((item) => item.status === "archived").length

  const statusLabelMap: Record<string, string> = {
    active: t("status.active"),
    closed: t("status.closed"),
    archived: t("status.archived"),
  }

  const channelLabelMap: Record<string, string> = {
    internal: t("channel.internal"),
    external: t("channel.external"),
  }

  const stats: StatCardData[] = [
    { label: t("stats.total"), value: numberFormatter.format(total), color: "primary" },
    { label: t("stats.active"), value: numberFormatter.format(active), color: "emerald" },
    { label: t("stats.closed"), value: numberFormatter.format(closed), color: "amber" },
    { label: t("stats.archived"), value: numberFormatter.format(archived), color: "default" },
  ]

  const columns: ColumnDef<ConversationItem>[] = [
    {
      key: "title",
      header: t("table.headers.title"),
      sortable: true,
      render: (row) => (
        <span className="inline-block max-w-[220px] truncate font-medium text-[var(--foreground)]">
          {row.title || row.id}
        </span>
      ),
    },
    {
      key: "user_id",
      header: t("table.headers.user"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "assistant_id",
      header: t("table.headers.assistant"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.assistant_id)}</span>,
    },
    {
      key: "channel",
      header: t("table.headers.channel"),
      render: (row) => (
        <AdminStatusBadge
          text={channelLabelMap[row.channel] ?? row.channel}
          tone={getStatusTone(row.channel)}
          dot={false}
        />
      ),
    },
    {
      key: "status",
      header: t("table.headers.status"),
      render: (row) => (
        <AdminStatusBadge
          text={statusLabelMap[row.status] ?? row.status}
          tone={getStatusTone(row.status)}
        />
      ),
    },
    {
      key: "message_count",
      header: t("table.headers.messages"),
      sortable: true,
      align: "right",
      render: (row) => <span className="font-mono text-xs">{numberFormatter.format(row.message_count)}</span>,
    },
    {
      key: "last_active_at",
      header: t("table.headers.lastActive"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.last_active_at ? dateTimeFormatter.format(new Date(row.last_active_at)) : "—"}
        </span>
      ),
    },
    {
      key: "last_summary_version",
      header: t("table.headers.summary"),
      render: (row) => <span className="text-xs text-[var(--muted)]">v{row.last_summary_version}</span>,
    },
  ]

  return (
    <AdminPageShell title={tAdmin("conversations.title")} description={tAdmin("conversations.description")} icon={MessageSquare}>
      <AdminStatCards stats={stats} columns={4} />
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "channel") setChannelFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "channel",
            label: t("filters.channel"),
            options: [
              { label: t("channel.internal"), value: "internal" },
              { label: t("channel.external"), value: "external" },
            ],
          },
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.active"), value: "active" },
              { label: t("status.closed"), value: "closed" },
              { label: t("status.archived"), value: "archived" },
            ],
          },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
      />
    </AdminPageShell>
  )
}
