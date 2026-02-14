"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Plug } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import { fetchAdminSkills, type SkillItem } from "@/lib/api/admin-dashboard"

type SkillRow = SkillItem & {
  tags: string[]
}

function toTags(skill: SkillItem): string[] {
  const raw = skill.manifest_json.tags
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === "string")
}

export function PageContent() {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [riskFilter, setRiskFilter] = useState("")

  const { data, error, isLoading } = useSWR("/api/v1/admin/skills?limit=100", () =>
    fetchAdminSkills({ limit: 100 })
  )

  const allRows = useMemo<SkillRow[]>(() => {
    return (data ?? []).map((skill) => ({
      ...skill,
      tags: toTags(skill),
    }))
  }, [data])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false
      if (riskFilter && (row.risk_level ?? "") !== riskFilter) return false
      if (!query) return true
      return [row.id, row.name, row.description, row.runtime, row.version, ...row.tags].some(
        (value) => String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, statusFilter, riskFilter])

  const riskTone = (level: string | null | undefined) => {
    if (level === "high") return "error" as const
    if (level === "medium") return "warn" as const
    if (level === "low") return "success" as const
    return "default" as const
  }

  const columns: ColumnDef<SkillRow>[] = [
    {
      key: "id",
      header: "ID",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.id}</span>,
    },
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.name}</span>,
    },
    {
      key: "version",
      header: "Version",
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.version || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminStatusBadge text={row.status} tone={getStatusTone(row.status)} />,
    },
    {
      key: "runtime",
      header: "Runtime",
      render: (row) =>
        row.runtime ? (
          <AdminStatusBadge text={row.runtime} tone="info" dot={false} />
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "risk_level",
      header: "Risk",
      render: (row) => (
        <AdminStatusBadge text={row.risk_level || "unknown"} tone={riskTone(row.risk_level)} />
      ),
    },
    {
      key: "complexity_score",
      header: "Complexity",
      sortable: true,
      render: (row) => {
        const complexity = row.complexity_score ?? 0
        const ratio = Math.max(0, Math.min(complexity / 10, 1))
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 rounded-full bg-white/5">
              <div
                className="h-1.5 rounded-full bg-[var(--primary)]"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
            <span className="text-xs text-[var(--muted)]">{complexity.toFixed(1)}/10</span>
          </div>
        )
      },
    },
    {
      key: "tags",
      header: "Tags",
      render: (row) => (
        <div className="flex gap-1">
          {row.tags.length ? (
            row.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-[var(--muted)]">
                {tag}
              </span>
            ))
          ) : (
            <span className="text-[var(--muted)]">—</span>
          )}
        </div>
      ),
    },
  ]

  return (
    <AdminPageShell
      title="Skill Management"
      description="Manage registered skills and capabilities"
      icon={Plug}
    >
      <AdminFilterBar
        searchPlaceholder="Search skills..."
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
          if (key === "risk") setRiskFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { label: "Active", value: "active" },
              { label: "Draft", value: "draft" },
              { label: "Disabled", value: "disabled" },
            ],
          },
          {
            key: "risk",
            label: "Risk",
            options: [
              { label: "Low", value: "low" },
              { label: "Medium", value: "medium" },
              { label: "High", value: "high" },
            ],
          },
        ]}
      />
      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading
            ? "Loading skills..."
            : error
              ? "Failed to load skills"
              : "No skills found"
        }
      />
    </AdminPageShell>
  )
}
