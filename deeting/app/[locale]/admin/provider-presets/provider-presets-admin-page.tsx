"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import {
  Database,
  Edit3,
  Filter,
  Package2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react"

import {
  deleteAdminProviderPreset,
  fetchAdminProviderPresets,
  type ProviderPresetItem,
} from "@/lib/api/admin-dashboard"
import { Button } from "@/ui/shadcn/button"
import { Input } from "@/ui/shadcn/input"
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
} from "@/ui/shadcn/alert-dialog"
import {
  AdminMetricGrid,
  AdminPageShell,
  AdminPanel,
  AdminStatusPill,
} from "@/components/admin/admin-shell"

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat(locale, {
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

export function ProviderPresetsAdminPage() {
  const t = useTranslations("admin.providerPresetsPage")
  const common = useTranslations("admin.common")
  const locale = useLocale()
  const [query, setQuery] = useState("")
  const [providerFilter, setProviderFilter] = useState("")
  const [activeOnly, setActiveOnly] = useState(false)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    "admin/provider-presets",
    fetchAdminProviderPresets
  )
  const rows = useMemo(() => data ?? [], [data])

  const providers = useMemo(() => {
    const unique = new Set<string>()
    for (const preset of rows) {
      const provider = String(preset.provider ?? "").trim()
      if (provider) unique.add(provider)
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return rows.filter((preset) => {
      if (activeOnly && !preset.is_active) return false
      if (providerFilter && preset.provider !== providerFilter) return false
      if (!normalized) return true
      return [
        preset.name,
        preset.slug,
        preset.provider,
        preset.category,
        preset.base_url,
      ].some((value) => String(value ?? "").toLowerCase().includes(normalized))
    })
  }, [activeOnly, providerFilter, query, rows])

  const metrics = useMemo(() => {
    const activeCount = rows.filter((preset) => preset.is_active).length
    const capabilityCount = rows.reduce(
      (total, preset) => total + getCapabilities(preset).length,
      0
    )
    return [
      {
        label: t("stats.totalPresets"),
        value: rows.length,
        icon: Package2,
        tone: "blue" as const,
      },
      {
        label: t("stats.activePresets"),
        value: activeCount,
        icon: ShieldCheck,
        tone: "emerald" as const,
      },
      {
        label: t("stats.capabilityProfiles"),
        value: capabilityCount,
        icon: Workflow,
        tone: "amber" as const,
      },
      {
        label: t("stats.customProviders"),
        value: providers.length,
        icon: Database,
        tone: "rose" as const,
      },
    ]
  }, [providers.length, rows, t])

  async function handleDelete(slug: string) {
    setDeletingSlug(slug)
    try {
      await deleteAdminProviderPreset(slug)
      await mutate()
    } finally {
      setDeletingSlug(null)
    }
  }

  return (
    <AdminPageShell
      eyebrow={t("consoleLabel")}
      title={t("consoleTitle")}
      description={t("managementHint")}
      actions={
        <Button asChild className="rounded-full px-5">
          <Link href="/admin/provider-presets/new">
            <Plus className="mr-2 size-4" />
            {t("actions.create")}
          </Link>
        </Button>
      }
    >
      <AdminMetricGrid metrics={metrics} />

      <AdminPanel>
        <div className="flex flex-col gap-4 border-b border-[var(--hairline)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={common("searchPlaceholder")}
                className="h-11 rounded-2xl pl-9"
              />
            </label>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="h-11 rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 text-sm text-[var(--ink)] outline-none"
            >
              <option value="">{common("all")}</option>
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant={activeOnly ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setActiveOnly((value) => !value)}
          >
            <Filter className="mr-2 size-4" />
            {t("status.active")}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[color-mix(in_srgb,var(--window-bg)_72%,transparent)] text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)]">
              <tr>
                <th className="px-5 py-4 font-semibold">{t("table.headers.preset")}</th>
                <th className="px-5 py-4 font-semibold">{t("table.headers.provider")}</th>
                <th className="px-5 py-4 font-semibold">{t("table.headers.capabilities")}</th>
                <th className="px-5 py-4 font-semibold">{t("table.headers.endpoint")}</th>
                <th className="px-5 py-4 font-semibold">{t("table.headers.updated")}</th>
                <th className="px-5 py-4 text-right font-semibold">{common("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[var(--ink-3)]">
                    {t("empty.loading")}
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-rose-500">
                    {t("empty.failed")}
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[var(--ink-3)]">
                    {t("empty.noData")}
                  </td>
                </tr>
              ) : (
                filteredRows.map((preset) => {
                  const slug = preset.slug ?? ""
                  const capabilities = getCapabilities(preset)
                  return (
                    <tr
                      key={preset.id ?? slug}
                      className="transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_3%,transparent)]"
                    >
                      <td className="px-5 py-4 align-top">
                        <div className="space-y-1">
                          <div className="font-semibold text-[var(--ink)]">
                            {preset.name || "-"}
                          </div>
                          <div className="font-mono text-xs text-[var(--ink-3)]">
                            {slug || "-"}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="space-y-2">
                          <div className="text-[var(--ink)]">{preset.provider || "-"}</div>
                          <AdminStatusPill
                            active={Boolean(preset.is_active)}
                            label={preset.is_active ? t("status.active") : t("status.inactive")}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="flex max-w-sm flex-wrap gap-1.5">
                          {capabilities.length ? (
                            capabilities.map((capability) => (
                              <span
                                key={capability}
                                className="rounded-full border border-[var(--hairline)] bg-[var(--window-bg)] px-2 py-1 font-mono text-[10px] text-[var(--ink-2)]"
                              >
                                {capability}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-[var(--ink-3)]">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="max-w-[300px] truncate font-mono text-xs text-[var(--ink-3)]">
                          {preset.base_url || "-"}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-xs text-[var(--ink-3)]">
                        {formatDate(preset.updated_at, locale)}
                      </td>
                      <td className="px-5 py-4 align-top text-right">
                        {slug ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button asChild size="sm" variant="outline" className="rounded-full">
                              <Link href={"/admin/provider-presets/edit?slug=" + encodeURIComponent(slug)}>
                                <Edit3 className="mr-2 size-4" />
                                {t("actions.edit")}
                              </Link>
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full text-rose-500 hover:text-rose-500"
                                >
                                  <Trash2 className="mr-2 size-4" />
                                  {common("delete")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
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
                                    disabled={deletingSlug === slug}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      void handleDelete(slug)
                                    }}
                                  >
                                    {common("delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </AdminPanel>
    </AdminPageShell>
  )
}
