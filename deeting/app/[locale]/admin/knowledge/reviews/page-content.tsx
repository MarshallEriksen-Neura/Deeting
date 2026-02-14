"use client"

import { useState } from "react"
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

  const columns: ColumnDef<KnowledgeArtifactItem>[] = [
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.title || "Untitled"}</span>,
    },
    {
      key: "source_url",
      header: "Source",
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
      header: "Type",
      render: (row) => <AdminStatusBadge text={row.artifact_type.replace(/_/g, " ")} tone={getStatusTone(row.artifact_type)} dot={false} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "embedding_model",
      header: "Model",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.embedding_model || "—"}</span>,
    },
    {
      key: "chunk_count",
      header: "Chunks",
      sortable: true,
      render: (row) => <span className={row.chunk_count > 0 ? "text-[var(--foreground)]" : "text-[var(--muted)]"}>{row.chunk_count || "—"}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      render: (row) => <span className="text-xs text-[var(--muted)]">{new Date(row.created_at).toLocaleDateString()}</span>,
    },
  ]

  return (
    <AdminPageShell title="Knowledge Reviews" description="Review knowledge artifacts and embeddings" icon={BookOpen}>
      <AdminFilterBar
        searchPlaceholder="Search artifacts..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "type") setTypeFilter(value)
          if (key === "status") setStatusFilter(value)
        }}
        filters={[
          { key: "type", label: "Type", options: [{ label: "Documentation", value: "documentation" }, { label: "Assistant", value: "assistant" }, { label: "Provider Spec", value: "provider_spec" }] },
          { key: "status", label: "Status", options: [{ label: "Pending", value: "pending" }, { label: "Processing", value: "processing" }, { label: "Indexed", value: "indexed" }, { label: "Failed", value: "failed" }] },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={rows}
        emptyMessage={isLoading ? "Loading artifacts..." : error ? "Failed to load artifacts" : "No artifacts found"}
      />
    </AdminPageShell>
  )
}
