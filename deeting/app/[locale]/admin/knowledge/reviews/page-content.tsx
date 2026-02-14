"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { BookOpen, ExternalLink } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import {
  fetchAdminKnowledgeArtifacts,
  type KnowledgeArtifactItem,
} from "@/lib/api/admin-dashboard"

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.knowledgeReviewsPage")
  const locale = useLocale()
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  })
  const numberFormatter = new Intl.NumberFormat(locale)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const { data, error, isLoading } = useSWR(
    ["/api/v1/admin/knowledge/artifacts", searchQuery, typeFilter, statusFilter],
    () =>
      fetchAdminKnowledgeArtifacts({
        limit: 100,
        q: searchQuery || undefined,
        artifact_type: typeFilter || undefined,
        status: statusFilter || undefined,
      })
  )

  const rows = data?.items ?? []

  const typeLabelMap: Record<string, string> = {
    documentation: t("type.documentation"),
    assistant: t("type.assistant"),
    provider_spec: t("type.providerSpec"),
  }

  const statusLabelMap: Record<string, string> = {
    pending: t("status.pending"),
    processing: t("status.processing"),
    indexed: t("status.indexed"),
    failed: t("status.failed"),
  }

  const columns: ColumnDef<KnowledgeArtifactItem>[] = [
    {
      key: "title",
      header: t("table.headers.title"),
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.title || t("table.untitled")}</span>,
    },
    {
      key: "source_url",
      header: t("table.headers.source"),
      render: (row) => {
        if (!row.source_url) return <span className="text-[var(--muted)]">—</span>
        let host = row.source_url
        try {
          host = new URL(row.source_url).hostname
        } catch {
          host = row.source_url
        }
        return (
          <span className="inline-flex max-w-[180px] items-center gap-1 truncate text-xs text-[var(--primary)]">
            <ExternalLink className="size-3 shrink-0" />
            {host}
          </span>
        )
      },
    },
    {
      key: "artifact_type",
      header: t("table.headers.type"),
      render: (row) => (
        <AdminStatusBadge
          text={typeLabelMap[row.artifact_type] ?? row.artifact_type.replace(/_/g, " ")}
          tone={getStatusTone(row.artifact_type)}
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
      key: "embedding_model",
      header: t("table.headers.model"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.embedding_model || "—"}</span>,
    },
    {
      key: "chunk_count",
      header: t("table.headers.chunks"),
      sortable: true,
      render: (row) => (
        <span className={row.chunk_count > 0 ? "text-[var(--foreground)]" : "text-[var(--muted)]"}>
          {row.chunk_count > 0 ? numberFormatter.format(row.chunk_count) : "—"}
        </span>
      ),
    },
    {
      key: "created_at",
      header: t("table.headers.created"),
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{dateFormatter.format(new Date(row.created_at))}</span>,
    },
  ]

  return (
    <AdminPageShell title={tAdmin("knowledgeReviews.title")} description={tAdmin("knowledgeReviews.description")} icon={BookOpen}>
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          {
            key: "type",
            label: t("filters.type"),
            options: [
              { label: t("type.documentation"), value: "documentation" },
              { label: t("type.assistant"), value: "assistant" },
              { label: t("type.providerSpec"), value: "provider_spec" },
            ],
          },
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.pending"), value: "pending" },
              { label: t("status.processing"), value: "processing" },
              { label: t("status.indexed"), value: "indexed" },
              { label: t("status.failed"), value: "failed" },
            ],
          },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={rows}
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
