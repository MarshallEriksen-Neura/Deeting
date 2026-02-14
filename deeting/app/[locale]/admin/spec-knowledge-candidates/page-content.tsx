"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
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

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale).format(date)
}

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.specKnowledgePage")
  const locale = useLocale()
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
        setFeedback(
          t("feedback.approved", {
            name: row.project_name || row.id,
          })
        )
      } else {
        await rejectAdminSpecKnowledgeCandidate(row.id)
        setFeedback(
          t("feedback.rejected", {
            name: row.project_name || row.id,
          })
        )
      }
      await mutate()
    } catch (decisionError) {
      const message =
        decisionError instanceof Error ? decisionError.message : t("feedback.operationFailed")
      setFeedback(message)
    } finally {
      setActioningId(null)
    }
  }

  const statusLabelMap: Record<string, string> = {
    pending_signal: t("status.pendingSignal"),
    pending_eval: t("status.pendingEval"),
    pending_review: t("status.pendingReview"),
    approved: t("status.approved"),
    rejected: t("status.rejected"),
  }

  const columns: ColumnDef<SpecKnowledgeCandidate>[] = [
    {
      key: "project_name",
      header: t("table.headers.project"),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-sm font-medium text-[var(--foreground)]">
          {row.project_name || row.id}
        </span>
      ),
    },
    {
      key: "status",
      header: t("table.headers.status"),
      render: (row) => (
        <AdminStatusBadge
          text={statusLabelMap[row.status] ?? row.status.replace(/_/g, " ")}
          tone={getStatusTone(row.status)}
        />
      ),
    },
    {
      key: "feedback",
      header: t("table.headers.feedback"),
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
      header: t("table.headers.applyRevert"),
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.usage_stats.apply_count} / {row.usage_stats.revert_count}
        </span>
      ),
    },
    {
      key: "success_rate",
      header: t("table.headers.success"),
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
      header: t("table.headers.sessions"),
      sortable: true,
      render: (row) => row.usage_stats.unique_sessions,
    },
    {
      key: "llm_score",
      header: t("table.headers.llmScore"),
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
      header: t("table.headers.static"),
      render: (row) =>
        row.eval_snapshot.static_pass ? (
          <Check className="size-4 text-emerald-400" />
        ) : (
          <X className="size-4 text-rose-400" />
        ),
    },
    {
      key: "review_status",
      header: t("table.headers.review"),
      render: (row) =>
        row.review_status ? (
          <AdminStatusBadge
            text={statusLabelMap[row.review_status] ?? row.review_status}
            tone={getStatusTone(row.review_status)}
          />
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "created_at",
      header: t("table.headers.created"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {formatDate(row.created_at, locale)}
        </span>
      ),
    },
  ]

  return (
    <AdminPageShell
      title={tAdmin("specKnowledge.title")}
      description={tAdmin("specKnowledge.description")}
      icon={Tags}
    >
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
              { label: t("status.pendingSignal"), value: "pending_signal" },
              { label: t("status.pendingEval"), value: "pending_eval" },
              { label: t("status.pendingReview"), value: "pending_review" },
              { label: t("status.approved"), value: "approved" },
              { label: t("status.rejected"), value: "rejected" },
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
            ? t("empty.loading")
            : error
              ? t("empty.failed")
              : t("empty.noData")
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
