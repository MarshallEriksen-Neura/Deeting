"use client"

import dynamic from "next/dynamic"
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import {
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
  pauseAdminSpecPlan,
  resumeAdminSpecPlan,
  type SpecPlanItem,
} from "@/lib/api/admin-dashboard"

const SpecPlanDetailDrawer = dynamic(
  () => import("./spec-plan-detail-drawer").then((mod) => ({ default: mod.SpecPlanDetailDrawer })),
  { ssr: false }
)

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const t = useTranslations("admin.agentTasksPage")
  const locale = useLocale()
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  })
  const numberFormatter = new Intl.NumberFormat(locale)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [selectedPlan, setSelectedPlan] = useState<SpecPlanItem | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
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

  const statusLabelMap: Record<string, string> = {
    DRAFT: t("status.draft"),
    RUNNING: t("status.running"),
    PAUSED: t("status.paused"),
    COMPLETED: t("status.completed"),
    FAILED: t("status.failed"),
  }

  const stats: StatCardData[] = [
    { label: t("stats.totalTasks"), value: numberFormatter.format(total), color: "primary" },
    { label: t("stats.running"), value: numberFormatter.format(running), color: "teal" },
    { label: t("stats.completed"), value: numberFormatter.format(completed), color: "emerald" },
    { label: t("stats.failed"), value: numberFormatter.format(failed), color: "rose" },
  ]

  const columns: ColumnDef<SpecPlanItem>[] = [
    {
      key: "project_name",
      header: t("table.headers.project"),
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.project_name}</span>,
    },
    {
      key: "user_id",
      header: t("table.headers.user"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.user_id)}</span>,
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
      key: "version",
      header: t("table.headers.version"),
      render: (row) => <span className="text-xs text-[var(--muted)]">v{row.version}</span>,
    },
    {
      key: "priority",
      header: t("table.headers.priority"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.priority}</span>,
    },
    {
      key: "conversation_session_id",
      header: t("table.headers.session"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.conversation_session_id)}</span>,
    },
    {
      key: "updated_at",
      header: t("table.headers.updated"),
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{dateTimeFormatter.format(new Date(row.updated_at))}</span>,
    },
    {
      key: "created_at",
      header: t("table.headers.created"),
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{dateFormatter.format(new Date(row.created_at))}</span>,
    },
  ]

  const handleToggleStatus = async (row: SpecPlanItem) => {
    if (actioningId) return
    const isPause = row.status === "RUNNING"
    const isResume = row.status === "PAUSED"
    if (!isPause && !isResume) return

    setActioningId(row.id)
    setFeedback(null)
    try {
      if (isPause) {
        await pauseAdminSpecPlan(row.id)
        setFeedback(t("feedback.paused", { project: row.project_name }))
      } else {
        await resumeAdminSpecPlan(row.id)
        setFeedback(t("feedback.resumed", { project: row.project_name }))
      }
      await mutate()
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : t("feedback.operationFailed")
      setFeedback(message)
    } finally {
      setActioningId(null)
    }
  }

  return (
    <>
      <AdminStatCards stats={stats} columns={4} />
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.draft"), value: "DRAFT" },
              { label: t("status.running"), value: "RUNNING" },
              { label: t("status.paused"), value: "PAUSED" },
              { label: t("status.completed"), value: "COMPLETED" },
              { label: t("status.failed"), value: "FAILED" },
            ],
          },
        ]}
      />
      {feedback && <p className="text-xs text-[var(--muted)]">{feedback}</p>}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        onRowClick={(row) => setSelectedPlan(row)}
        emptyMessage={
          isLoading
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
        }
        rowActions={(row) => {
          const canPause = row.status === "RUNNING"
          const canResume = row.status === "PAUSED"
          if (!canPause && !canResume) {
            return <span className="text-xs text-[var(--muted)]">—</span>
          }

          return (
            <button
              onClick={(event) => {
                event.stopPropagation()
                void handleToggleStatus(row)
              }}
              disabled={Boolean(actioningId)}
              className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/10 px-2 text-xs text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {canPause ? t("actions.pause") : t("actions.resume")}
            </button>
          )
        }}
      />
      {selectedPlan && (
        <SpecPlanDetailDrawer
          key={selectedPlan.id}
          plan={selectedPlan}
          locale={locale}
          onClose={() => setSelectedPlan(null)}
        />
      )}
    </>
  )
}
