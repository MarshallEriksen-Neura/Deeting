"use client"

import { useMemo, useState } from "react"
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

  const stats: StatCardData[] = [
    { label: "Total", value: total, color: "primary" },
    { label: "Active", value: active, color: "emerald" },
    { label: "Closed", value: closed, color: "amber" },
    { label: "Archived", value: archived, color: "default" },
  ]

  const columns: ColumnDef<ConversationItem>[] = [
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (row) => (
        <span className="inline-block max-w-[220px] truncate font-medium text-[var(--foreground)]">
          {row.title || row.id}
        </span>
      ),
    },
    {
      key: "user_id",
      header: "User",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "assistant_id",
      header: "Assistant",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.assistant_id)}</span>,
    },
    {
      key: "channel",
      header: "Channel",
      render: (row) => <AdminStatusBadge text={row.channel} tone={getStatusTone(row.channel)} dot={false} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "message_count",
      header: "Messages",
      sortable: true,
      align: "right",
      render: (row) => <span className="font-mono text-xs">{row.message_count}</span>,
    },
    {
      key: "last_active_at",
      header: "Last Active",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.last_active_at ? new Date(row.last_active_at).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      key: "last_summary_version",
      header: "Summary",
      render: (row) => <span className="text-xs text-[var(--muted)]">v{row.last_summary_version}</span>,
    },
  ]

  return (
    <AdminPageShell title="Conversations" description="Monitor and manage user conversations" icon={MessageSquare}>
      <AdminStatCards stats={stats} columns={4} />
      <AdminFilterBar
        searchPlaceholder="Search conversations..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "channel") setChannelFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          { key: "channel", label: "Channel", options: [{ label: "Internal", value: "internal" }, { label: "External", value: "external" }] },
          { key: "status", label: "Status", options: [{ label: "Active", value: "active" }, { label: "Closed", value: "closed" }, { label: "Archived", value: "archived" }] },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={isLoading ? "Loading conversations..." : error ? "Failed to load conversations" : "No conversations found"}
      />
    </AdminPageShell>
  )
}
