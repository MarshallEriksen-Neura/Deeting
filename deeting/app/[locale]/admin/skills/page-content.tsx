"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
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
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.skillsPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })
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

  const statusLabelMap: Record<string, string> = {
    active: t("status.active"),
    draft: t("status.draft"),
    disabled: t("status.disabled"),
  }

  const riskLabelMap: Record<string, string> = {
    low: t("risk.low"),
    medium: t("risk.medium"),
    high: t("risk.high"),
  }

  const columns: ColumnDef<SkillRow>[] = [
    {
      key: "id",
      header: t("table.headers.id"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.id}</span>,
    },
    {
      key: "name",
      header: t("table.headers.name"),
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--foreground)]">{row.name}</span>,
    },
    {
      key: "version",
      header: t("table.headers.version"),
      render: (row) => <span className="font-mono text-xs text-[var(--muted)]">{row.version || "—"}</span>,
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
      key: "runtime",
      header: t("table.headers.runtime"),
      render: (row) =>
        row.runtime ? (
          <AdminStatusBadge text={row.runtime} tone="info" dot={false} />
        ) : (
          <span className="text-[var(--muted)]">—</span>
        ),
    },
    {
      key: "risk_level",
      header: t("table.headers.risk"),
      render: (row) => (
        <AdminStatusBadge
          text={row.risk_level ? (riskLabelMap[row.risk_level] ?? row.risk_level) : t("risk.unknown")}
          tone={riskTone(row.risk_level)}
        />
      ),
    },
    {
      key: "complexity_score",
      header: t("table.headers.complexity"),
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
            <span className="text-xs text-[var(--muted)]">{t("table.complexityValue", { value: numberFormatter.format(complexity) })}</span>
          </div>
        )
      },
    },
    {
      key: "tags",
      header: t("table.headers.tags"),
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
      title={tAdmin("skills.title")}
      description={tAdmin("skills.description")}
      icon={Plug}
    >
      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
          if (key === "risk") setRiskFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.active"), value: "active" },
              { label: t("status.draft"), value: "draft" },
              { label: t("status.disabled"), value: "disabled" },
            ],
          },
          {
            key: "risk",
            label: t("filters.risk"),
            options: [
              { label: t("risk.low"), value: "low" },
              { label: t("risk.medium"), value: "medium" },
              { label: t("risk.high"), value: "high" },
            ],
          },
        ]}
      />
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
      />
    </AdminPageShell>
  )
}
