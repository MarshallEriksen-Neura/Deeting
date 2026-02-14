"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { CheckSquare, Check, X } from "lucide-react"
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
  approveAdminAssistantReview,
  fetchAdminAssistantReviews,
  fetchAdminAssistants,
  rejectAdminAssistantReview,
  type AssistantReviewTask,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const {
    data: reviewsData,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/assistant-reviews", () => fetchAdminAssistantReviews())

  const { data: assistantsData } = useSWR("/api/v1/admin/assistants?size=50", () =>
    fetchAdminAssistants({ size: 50 })
  )

  const assistantNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const assistant of assistantsData?.items ?? []) {
      const current =
        assistant.versions.find((version) => version.id === assistant.current_version_id) ??
        assistant.versions[0]
      map.set(assistant.id, current?.name || assistant.summary || assistant.id)
    }
    return map
  }, [assistantsData?.items])

  const allRows = useMemo(() => reviewsData?.items ?? [], [reviewsData?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false
      if (!query) return true
      return [
        assistantNameMap.get(row.entity_id),
        row.entity_id,
        row.submitter_user_id,
        row.reviewer_user_id,
        row.reason,
      ].some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [allRows, searchQuery, statusFilter, assistantNameMap])

  const pending = allRows.filter((row) => row.status === "pending").length
  const approved = allRows.filter((row) => row.status === "approved").length
  const rejected = allRows.filter((row) => row.status === "rejected").length

  const stats: StatCardData[] = [
    { label: "Pending", value: pending, color: "amber" },
    { label: "Approved", value: approved, color: "emerald" },
    { label: "Rejected", value: rejected, color: "rose" },
  ]

  const handleDecision = async (row: AssistantReviewTask, action: "approve" | "reject") => {
    if (actioningId) return
    setActioningId(row.id)
    setActionMessage(null)
    try {
      if (action === "approve") {
        await approveAdminAssistantReview(row.entity_id)
        setActionMessage(`Approved ${assistantNameMap.get(row.entity_id) ?? shortId(row.entity_id)}`)
      } else {
        await rejectAdminAssistantReview(row.entity_id)
        setActionMessage(`Rejected ${assistantNameMap.get(row.entity_id) ?? shortId(row.entity_id)}`)
      }
      await mutate()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Operation failed"
      setActionMessage(message)
    } finally {
      setActioningId(null)
    }
  }

  const columns: ColumnDef<AssistantReviewTask>[] = [
    {
      key: "entity_id",
      header: "Assistant",
      sortable: true,
      render: (row) => (
        <div>
          <span className="font-medium text-[var(--foreground)]">
            {assistantNameMap.get(row.entity_id) ?? shortId(row.entity_id)}
          </span>
          <div className="font-mono text-[10px] text-[var(--muted)]">{row.entity_id}</div>
        </div>
      ),
    },
    {
      key: "submitter_user_id",
      header: "Submitter",
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.submitter_user_id)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "submitted_at",
      header: "Submitted",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "reviewer_user_id",
      header: "Reviewer",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{shortId(row.reviewer_user_id)}</span>,
    },
    {
      key: "reviewed_at",
      header: "Reviewed",
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.reviewed_at ? new Date(row.reviewed_at).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => (
        <span className="inline-block max-w-[220px] truncate text-xs text-[var(--muted)]">
          {row.reason ?? "—"}
        </span>
      ),
    },
  ]

  return (
    <AdminPageShell
      title="Assistant Reviews"
      description="Review and approve assistant submissions"
      icon={CheckSquare}
    >
      <AdminStatCards stats={stats} columns={3} />
      <AdminFilterBar
        searchPlaceholder="Search reviews..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Pending", value: "pending" },
              { label: "Approved", value: "approved" },
              { label: "Rejected", value: "rejected" },
            ],
          },
        ]}
      />
      {actionMessage && (
        <p className="text-xs text-[var(--muted)]" role="status">
          {actionMessage}
        </p>
      )}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading
            ? "Loading reviews..."
            : error
              ? "Failed to load reviews"
              : "No reviews found"
        }
        rowActions={(row) =>
          row.status === "pending" ? (
            <div className="flex items-center gap-1">
              <button
                disabled={actioningId === row.id}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDecision(row, "approve")
                }}
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="size-3.5" />
              </button>
              <button
                disabled={actioningId === row.id}
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDecision(row, "reject")
                }}
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null
        }
      />
    </AdminPageShell>
  )
}
