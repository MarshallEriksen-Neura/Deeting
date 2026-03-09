"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Check, Eye, X } from "lucide-react"
import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatCards,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
  type StatCardData,
} from "@/components/admin"
import { Button } from "@/components/ui/button"
import {
  approveAdminPluginReview,
  fetchAdminPluginMarketReviews,
  rejectAdminPluginReview,
  type PluginMarketReviewItem,
} from "@/lib/api/admin-dashboard"
import { RejectReviewDialog } from "./reject-review-dialog"
import { ReviewDetailDrawer } from "./review-detail-drawer"

function shortId(value?: string | null) {
  return value ? `${value.slice(0, 8)}...` : "—"
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale).format(date)
}

export function PageContent() {
  const t = useTranslations("admin.pluginReviewsPage")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [detailReview, setDetailReview] = useState<PluginMarketReviewItem | null>(null)
  const [rejectReview, setRejectReview] = useState<PluginMarketReviewItem | null>(null)
  const { data, error, isLoading, mutate } = useSWR(["/api/v1/admin/plugin-reviews", statusFilter], () =>
    fetchAdminPluginMarketReviews({ limit: 100, status_filter: statusFilter || undefined })
  )

  const allRows = useMemo(() => data?.items ?? [], [data?.items])
  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (!query) return true
      return [
        row.name,
        row.id,
        row.description,
        row.source_repo,
        row.submitter_user_id,
        row.security_review_summary,
        row.network_targets.join(" "),
      ].some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [allRows, searchQuery])

  const stats: StatCardData[] = [
    { label: t("stats.pendingReview"), value: allRows.filter((row) => row.status === "needs_review").length, color: "amber" },
    { label: t("stats.approved"), value: allRows.filter((row) => row.status === "active").length, color: "emerald" },
    { label: t("stats.rejected"), value: allRows.filter((row) => row.status === "rejected").length, color: "rose" },
  ]

  const statusTextMap: Record<string, string> = {
    needs_review: t("status.pendingReview"),
    active: t("status.approved"),
    rejected: t("status.rejected"),
  }

  const handleDecision = async (row: PluginMarketReviewItem, action: "approve" | "reject", reason?: string) => {
    if (actioningId) return
    setActioningId(row.id)
    setFeedback(null)
    try {
      if (action === "approve") {
        await approveAdminPluginReview(row.id)
        setFeedback(t("feedback.approved", { name: row.name }))
      } else {
        await rejectAdminPluginReview(row.id, reason)
        setFeedback(t("feedback.rejected", { name: row.name }))
        setRejectReview(null)
      }
      await mutate()
    } catch (actionError) {
      setFeedback(actionError instanceof Error ? actionError.message : t("feedback.operationFailed"))
    } finally {
      setActioningId(null)
    }
  }

  const columns: ColumnDef<PluginMarketReviewItem>[] = [
    { key: "name", header: t("table.headers.skill"), sortable: true, render: (row) => <div><div className="font-medium">{row.name}</div><div className="font-mono text-[10px] text-[var(--muted)]">{row.id}</div><div className="truncate text-xs text-[var(--muted)]">{row.source_repo ?? row.description ?? "—"}</div></div> },
    { key: "status", header: t("table.headers.status"), render: (row) => <AdminStatusBadge text={statusTextMap[row.status] ?? row.status} tone={getStatusTone(row.status)} /> },
    { key: "risk_level", header: t("table.headers.risk"), render: (row) => <AdminStatusBadge text={row.risk_level ?? "—"} tone={row.risk_level === "high" ? "error" : row.risk_level === "medium" ? "warn" : "default"} /> },
    { key: "security_review_summary", header: t("table.headers.security"), render: (row) => <div className="max-w-[320px] text-xs text-[var(--muted)]"><div>{row.security_review_summary ?? "—"}</div><div>{t("table.summary", { findings: row.findings.length, network: row.network_targets.length, privacy: row.privacy_risks.length })}</div></div> },
    { key: "submitter_user_id", header: t("table.headers.submitter"), render: (row) => <span className="font-mono text-xs">{shortId(row.submitter_user_id)}</span> },
    { key: "reviewed_at", header: t("table.headers.reviewed"), render: (row) => <span className="text-xs text-[var(--muted)]">{formatDate(row.reviewed_at, locale)}</span> },
  ]

  return (
    <>
      <AdminStatCards stats={stats} columns={3} />
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => key === "status" && setStatusFilter(value)}
        filters={[{ key: "status", label: t("filters.status"), options: [{ label: t("status.pendingReview"), value: "needs_review" }, { label: t("status.approved"), value: "active" }, { label: t("status.rejected"), value: "rejected" }] }]}
      />
      {feedback && <p className="text-xs text-[var(--muted)]" role="status">{feedback}</p>}
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={isLoading ? t("empty.loading") : error ? t("empty.failed") : t("empty.noData")}
        rowActions={(row) => <div className="flex items-center gap-1"><Button variant="ghost" size="icon-sm" aria-label={t("actions.details")} onClick={(event) => { event.stopPropagation(); setDetailReview(row) }}><Eye className="size-3.5" /></Button>{row.status === "needs_review" ? <><Button variant="ghost" size="icon-sm" aria-label={t("actions.approve")} disabled={actioningId === row.id} onClick={(event) => { event.stopPropagation(); void handleDecision(row, "approve") }} className="text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-400"><Check className="size-3.5" /></Button><Button variant="ghost" size="icon-sm" aria-label={t("actions.reject")} disabled={actioningId === row.id} onClick={(event) => { event.stopPropagation(); setRejectReview(row) }} className="text-rose-400 hover:bg-rose-500/20 hover:text-rose-400"><X className="size-3.5" /></Button></> : null}</div>}
      />
      <RejectReviewDialog
        review={rejectReview}
        submitting={actioningId === rejectReview?.id}
        onClose={() => setRejectReview(null)}
        onConfirm={async (reason) => {
          if (!rejectReview) return
          await handleDecision(rejectReview, "reject", reason)
        }}
      />
      <ReviewDetailDrawer
        locale={locale}
        review={detailReview}
        onClose={() => setDetailReview(null)}
      />
    </>
  )
}

