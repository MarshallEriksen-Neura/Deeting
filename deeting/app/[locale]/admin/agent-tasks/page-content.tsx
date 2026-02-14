"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Workflow } from "lucide-react"
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
  fetchAdminSpecPlans,
  type SpecPlanItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const { data, error, isLoading } = useSWR(
    ["/api/v1/admin/spec-plans", statusFilter],
    () =>
      fetchAdminSpecPlans({
        limit: 100,
        status: statusFilter || undefined,
      })
  )

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allRows
    return allRows.filter((row) => {
      return [row.project_name, row.id, row.user_id, row.conversation_session_id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery])

  const total = allRows.length
  const running = allRows.filter((item) => item.status === "RUNNING").length
  const completed = allRows.filter((item) => item.status === "COMPLETED").length
  const failed = allRows.filter((item) => item.status === "FAILED").length

  const stats: StatCardData[] = [
    { label: "Total Tasks", value: total, color: "primary" },
    { label: "Running", value: running, color: "teal" },
    { label: "Completed", value: completed, color: "emerald" },
    { label: "Failed", value: failed, color: "rose" },
  ]

  const columns: ColumnDef<SpecPlanItem>[] = [
    {
      key: "project_name",
      header: "Project",
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.project_name}</span>,
    },
    {
      key: "user_id",
      header: "User",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "version",
      header: "Ver",
      render: (row) => <span className="text-xs text-[var(--muted)]">v{row.version}</span>,
    },
    {
      key: "priority",
      header: "Priority",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.priority}</span>,
    },
    {
      key: "conversation_session_id",
      header: "Session",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.conversation_session_id)}</span>,
    },
    {
      key: "updated_at",
      header: "Updated",
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{new Date(row.updated_at).toLocaleString()}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{new Date(row.created_at).toLocaleDateString()}</span>,
    },
  ]

  return (
    <AdminPageShell title="Agent Tasks" description="Monitor Spec Agent task execution" icon={Workflow}>
      <AdminStatCards stats={stats} columns={4} />
      <AdminFilterBar
        searchPlaceholder="Search tasks..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Draft", value: "DRAFT" },
              { label: "Running", value: "RUNNING" },
              { label: "Paused", value: "PAUSED" },
              { label: "Completed", value: "COMPLETED" },
              { label: "Failed", value: "FAILED" },
            ],
          },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={isLoading ? "Loading agent tasks..." : error ? "Failed to load agent tasks" : "No agent tasks found"}
      />
    </AdminPageShell>
  )
}
