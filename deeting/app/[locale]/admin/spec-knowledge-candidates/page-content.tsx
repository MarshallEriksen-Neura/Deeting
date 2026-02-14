"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Tags, Check, X } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import {
  approveAdminSpecKnowledgeCandidate,
  fetchAdminSpecKnowledgeCandidates,
  rejectAdminSpecKnowledgeCandidate,
  type SpecKnowledgeCandidate,
} from "@/lib/api/admin-dashboard"

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(["/api/v1/admin/spec-knowledge-candidates", statusFilter], () =>
    fetchAdminSpecKnowledgeCandidates({ status_filter: statusFilter || undefined })
  )

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allRows
    return allRows.filter((row) =>
      [row.project_name, row.id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    )
  }, [allRows, searchQuery])

  const handleDecision = async (
    row: SpecKnowledgeCandidate,
    action: "approve" | "reject"
  ) => {
    if (actioningId) return
    setActioningId(row.id)
    setFeedback(null)
    try {
      if (action === "approve") {
        await approveAdminSpecKnowledgeCandidate(row.id)
        setFeedback(`Approved candidate: ${row.project_name || row.id}`)
      } else {
        await rejectAdminSpecKnowledgeCandidate(row.id)
        setFeedback(`Rejected candidate: ${row.project_name || row.id}`)
      }
      await mutate()
    } catch (decisionError) {
      const message = decisionError instanceof Error ? decisionError.message : "Operation failed"
      setFeedback(message)
    } finally {
      setActioningId(null)
    }
  }

  const columns: ColumnDef<SpecKnowledgeCandidate>[] = [
    {
      key: "project_name",
      header: "Project",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-sm font-medium text-[var(--foreground)]">
          {row.project_name || row.id}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <AdminStatusBadge
          text={row.status.replace(/_/g, " ")}
          tone={getStatusTone(row.status)}
        />
      ),
    },
    {
      key: "feedback",
      header: "+/-",
      render: (row) => (
        <span className="text-xs">
          <span className="text-emerald-400">{row.usage_stats.positive_feedback}</span>
          <span className="text-[var(--muted)]"> / </span>
          <span className="text-rose-400">{row.usage_stats.negative_feedback}</span>
        </span>
      ),
    },
    {
      key: "apply_count",
      header: "Apply/Revert",
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.usage_stats.apply_count} / {row.usage_stats.revert_count}
        </span>
      ),
    },
    {
      key: "success_rate",
      header: "Success",
      sortable: true,
      render: (row) => {
        const rate = Math.round((row.usage_stats.success_rate || 0) * 100)
        return (
          <span
            className={
              rate >= 80
                ? "text-emerald-400"
                : rate >= 50
                  ? "text-amber-400"
                  : "text-rose-400"
            }
          >
            {rate}%
          </span>
        )
      },
    },
    {
      key: "unique_sessions",
      header: "Sessions",
      sortable: true,
      render: (row) => row.usage_stats.unique_sessions,
    },
    {
      key: "llm_score",
      header: "LLM Score",
      sortable: true,
      render: (row) => {
        const score = row.eval_snapshot.llm_score
        if (score == null) return <span className="text-[var(--muted)]">—</span>
        return (
          <span
            className={
              score >= 80
                ? "text-emerald-400"
                : score >= 50
                  ? "text-amber-400"
                  : "text-rose-400"
            }
          >
            {score}
          </span>
        )
      },
    },
    {
      key: "static_pass",
      header: "Static",
      render: (row) =>
        row.eval_snapshot.static_pass ? (
          <Check className="size-4 text-emerald-400" />
        ) : (
          <X className="size-4 text-rose-400" />
        ),
    },
    {
      key: "review_status",
      header: "Review",
      render: (row) =>
        row.review_status ? (
          <AdminStatusBadge text={row.review_status} tone={getStatusTone(row.review_status)} />
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <AdminPageShell
      title="Spec Knowledge Review"
      description="Review and approve knowledge candidates"
      icon={Tags}
    >
      <AdminFilterBar
        searchPlaceholder="Search projects..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Pending Signal", value: "pending_signal" },
              { label: "Pending Eval", value: "pending_eval" },
              { label: "Pending Review", value: "pending_review" },
              { label: "Approved", value: "approved" },
              { label: "Rejected", value: "rejected" },
            ],
          },
        ]}
      />
      {feedback && <p className="text-xs text-[var(--muted)]">{feedback}</p>}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading
            ? "Loading candidates..."
            : error
              ? "Failed to load candidates"
              : "No candidates found"
        }
        rowActions={(row) =>
          row.status === "pending_review" ? (
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
