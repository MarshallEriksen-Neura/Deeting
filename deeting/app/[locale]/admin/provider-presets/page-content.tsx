"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import {
  Database,
  Package2,
  Plus,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react"
import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatCards,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import {
  deleteAdminProviderPreset,
  fetchAdminProviderPresets,
  type ProviderPresetItem,
} from "@/lib/api/admin-dashboard"

function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getCapabilities(preset: ProviderPresetItem) {
  const raw = preset.protocol_profiles
  if (!raw || typeof raw !== "object") return []
  return Object.keys(raw)
}

function PresetRowActions({
  preset,
  onDeleted,
}: {
  preset: ProviderPresetItem
  onDeleted: (slug: string) => Promise<void>
}) {
  const t = useTranslations("admin.providerPresetsPage")
  const common = useTranslations("admin.common")
  const [deleting, setDeleting] = useState(false)

  const slug = preset.slug ?? ""

  return (
    <div className="flex items-center justify-end gap-2">
      {slug ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/provider-presets/${slug}`}>{t("actions.edit")}</Link>
        </Button>
      ) : null}
      {slug ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" className="text-rose-300 hover:text-rose-200">
              <Trash2 className="mr-2 size-4" />
              {common("delete")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>{t("deleteConfirm.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("deleteConfirm.description", {
                  name: preset.name ?? slug,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{common("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={async (event) => {
                  event.preventDefault()
                  if (deleting) return
                  setDeleting(true)
                  try {
                    await onDeleted(slug)
                  } finally {
                    setDeleting(false)
                  }
                }}
              >
                {common("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}

export function PageContent() {
  const t = useTranslations("admin.providerPresetsPage")
  const common = useTranslations("admin.common")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [providerFilter, setProviderFilter] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success")

  const { data, error, isLoading, mutate } = useSWR(
    "/api/v1/admin/provider-presets",
    fetchAdminProviderPresets
  )

  const rows = data ?? []
  const providerOptions = useMemo(() => {
    const unique = new Set<string>()
    for (const preset of rows) {
      const provider = String(preset.provider ?? "").trim()
      if (provider) unique.add(provider)
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return rows.filter((preset) => {
      if (statusFilter === "active" && !preset.is_active) return false
      if (statusFilter === "inactive" && preset.is_active) return false
      if (providerFilter && preset.provider !== providerFilter) return false
      if (!query) return true
      return [
        preset.name,
        preset.slug,
        preset.provider,
        preset.category,
        preset.base_url,
      ].some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [providerFilter, rows, searchQuery, statusFilter])

  const stats = useMemo(() => {
    const activeCount = rows.filter((item) => item.is_active).length
    const totalCapabilities = rows.reduce(
      (count, preset) => count + getCapabilities(preset).length,
      0
    )
    const customCount = rows.filter((item) => {
      const provider = String(item.provider ?? "").trim().toLowerCase()
      return provider === "custom" || provider === "volcengine" || provider === "modelscope"
    }).length
    return [
      {
        label: t("stats.totalPresets"),
        value: rows.length,
        icon: Package2,
        color: "primary" as const,
      },
      {
        label: t("stats.activePresets"),
        value: activeCount,
        icon: ShieldCheck,
        color: "emerald" as const,
      },
      {
        label: t("stats.capabilityProfiles"),
        value: totalCapabilities,
        icon: Workflow,
        color: "teal" as const,
      },
      {
        label: t("stats.customProviders"),
        value: customCount,
        icon: Database,
        color: "amber" as const,
      },
    ]
  }, [rows, t])

  const columns: ColumnDef<ProviderPresetItem>[] = [
    {
      key: "preset",
      header: t("table.headers.preset"),
      sortable: true,
      render: (row) => (
        <div className="space-y-1">
          <div className="font-semibold text-[var(--foreground)]">{row.name || "—"}</div>
          <div className="font-mono text-xs text-[var(--muted)]">{row.slug || "—"}</div>
        </div>
      ),
    },
    {
      key: "provider",
      header: t("table.headers.provider"),
      sortable: true,
      render: (row) => (
        <div className="space-y-1">
          <div className="text-sm text-[var(--foreground)]">{row.provider || "—"}</div>
          <div className="text-xs text-[var(--muted)]">{row.category || "—"}</div>
        </div>
      ),
    },
    {
      key: "capabilities",
      header: t("table.headers.capabilities"),
      render: (row) => {
        const capabilities = getCapabilities(row)
        if (capabilities.length === 0) {
          return <span className="text-xs text-[var(--muted)]">—</span>
        }
        return (
          <div className="flex flex-wrap gap-1.5">
            {capabilities.map((capability) => (
              <span
                key={capability}
                className="rounded-full border border-[var(--primary)]/20 bg-[var(--primary)]/8 px-2 py-0.5 font-mono text-[10px] text-[var(--primary)]"
              >
                {capability}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      key: "base_url",
      header: t("table.headers.endpoint"),
      render: (row) => (
        <span className="block max-w-[24rem] truncate font-mono text-xs text-[var(--muted)]">
          {row.base_url || "—"}
        </span>
      ),
    },
    {
      key: "protocol_schema_version",
      header: t("table.headers.schema"),
      render: (row) => (
        <span className="font-mono text-xs text-[var(--muted)]">
          {row.protocol_schema_version || "—"}
        </span>
      ),
    },
    {
      key: "updated_at",
      header: t("table.headers.updated"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">{formatDate(row.updated_at)}</span>
      ),
    },
    {
      key: "is_active",
      header: t("table.headers.status"),
      render: (row) => {
        const status = row.is_active ? "active" : "inactive"
        return (
          <AdminStatusBadge
            text={t(`status.${status}`)}
            tone={getStatusTone(status)}
          />
        )
      },
    },
  ]

  async function handleDelete(slug: string) {
    setFeedback(null)
    try {
      await deleteAdminProviderPreset(slug)
      setFeedbackTone("success")
      setFeedback(t("feedback.deleted", { slug }))
      await mutate()
    } catch (deleteError) {
      setFeedbackTone("error")
      setFeedback(
        deleteError instanceof Error ? deleteError.message : t("feedback.deleteFailed")
      )
    }
  }

  return (
    <div className="space-y-5">
      <GlassCard padding="default" hover="none" className="overflow-hidden">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/15 bg-[var(--primary)]/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--primary)]">
              <Package2 className="size-3.5" />
              {t("consoleLabel")}
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                {t("consoleTitle")}
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
                {t("managementHint")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href="/admin/provider-presets/new">
                <Plus className="mr-2 size-4" />
                {t("actions.create")}
              </Link>
            </Button>
          </div>
        </div>
      </GlassCard>

      <AdminStatCards stats={stats} columns={4} />

      <AdminFilterBar
        searchPlaceholder={common("searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
          if (key === "provider") setProviderFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.active"), value: "active" },
              { label: t("status.inactive"), value: "inactive" },
            ],
          },
          {
            key: "provider",
            label: t("filters.provider"),
            options: providerOptions.map((provider) => ({
              label: provider,
              value: provider,
            })),
          },
        ]}
      />

      {feedback ? (
        <GlassCard padding="default" hover="none">
          <p
            className={
              feedbackTone === "error"
                ? "text-sm text-rose-300"
                : "text-sm text-emerald-300"
            }
          >
            {feedback}
          </p>
        </GlassCard>
      ) : null}

      <AdminDataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={
          isLoading ? t("empty.loading") : error ? t("empty.failed") : t("empty.noData")
        }
        pageSize={12}
        rowActions={(row) => (
          <PresetRowActions preset={row} onDeleted={handleDelete} />
        )}
      />
    </div>
  )
}
