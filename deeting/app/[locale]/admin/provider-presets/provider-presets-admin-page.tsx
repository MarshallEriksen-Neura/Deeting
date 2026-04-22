"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Database, Filter, Package2, Plus, Search, ShieldCheck, Trash2, Workflow } from "lucide-react"

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
import { AdminMetricGrid, AdminPageShell, AdminPanel, AdminStatusPill } from "@/components/admin/admin-shell"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
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

export function ProviderPresetsAdminPage() {
  const [query, setQuery] = useState("")
  const [providerFilter, setProviderFilter] = useState("")
  const [activeOnly, setActiveOnly] = useState(false)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR("admin/provider-presets", fetchAdminProviderPresets)
  const rows = data ?? []

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
      return [preset.name, preset.slug, preset.provider, preset.category, preset.base_url].some((value) =>
        String(value ?? "").toLowerCase().includes(normalized)
      )
    })
  }, [activeOnly, providerFilter, query, rows])

  const metrics = useMemo(() => {
    const activeCount = rows.filter((preset) => preset.is_active).length
    const capabilityCount = rows.reduce((total, preset) => total + getCapabilities(preset).length, 0)
    return [
      { label: "Total presets", value: rows.length, detail: "Cloud registry templates", icon: Package2, tone: "blue" as const },
      { label: "Active", value: activeCount, detail: "Available for discovery", icon: ShieldCheck, tone: "emerald" as const },
      { label: "Capabilities", value: capabilityCount, detail: "Protocol profiles mapped", icon: Workflow, tone: "amber" as const },
      { label: "Providers", value: providers.length, detail: "Unique provider families", icon: Database, tone: "rose" as const },
    ]
  }, [providers.length, rows])

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
      eyebrow="Provider preset control"
      title="Preset registry with routing-grade clarity"
      description="Manage the cloud provider_preset catalogue that powers provider discovery, protocol profiles, and desktop marketplace publication."
      actions={
        <Button className="rounded-full px-5" disabled title="Editor migration is handled separately">
          <Plus className="mr-2 size-4" />
          New preset
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
                placeholder="Search name, slug, provider, endpoint"
                className="h-11 rounded-2xl pl-9"
              />
            </label>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="h-11 rounded-2xl border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 text-sm text-[var(--ink)] outline-none"
            >
              <option value="">All providers</option>
              {providers.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </div>
          <Button variant={activeOnly ? "default" : "outline"} className="rounded-full" onClick={() => setActiveOnly((value) => !value)}>
            <Filter className="mr-2 size-4" />
            Active only
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[color-mix(in_srgb,var(--window-bg)_72%,transparent)] text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)]">
              <tr>
                <th className="px-5 py-4 font-semibold">Preset</th>
                <th className="px-5 py-4 font-semibold">Provider</th>
                <th className="px-5 py-4 font-semibold">Capabilities</th>
                <th className="px-5 py-4 font-semibold">Endpoint</th>
                <th className="px-5 py-4 font-semibold">Updated</th>
                <th className="px-5 py-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {isLoading ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[var(--ink-3)]">Loading presets...</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-rose-500">Failed to load provider presets.</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[var(--ink-3)]">No matching presets.</td></tr>
              ) : filteredRows.map((preset) => {
                const slug = preset.slug ?? ""
                const capabilities = getCapabilities(preset)
                return (
                  <tr key={preset.id ?? slug} className="transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_3%,transparent)]">
                    <td className="px-5 py-4 align-top">
                      <div className="space-y-1">
                        <div className="font-semibold text-[var(--ink)]">{preset.name || "-"}</div>
                        <div className="font-mono text-xs text-[var(--ink-3)]">{slug || "-"}</div>
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="space-y-2">
                        <div className="text-[var(--ink)]">{preset.provider || "-"}</div>
                        <AdminStatusPill active={Boolean(preset.is_active)} label={preset.is_active ? "Active" : "Inactive"} />
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="flex max-w-sm flex-wrap gap-1.5">
                        {capabilities.length ? capabilities.map((capability) => (
                          <span key={capability} className="rounded-full border border-[var(--hairline)] bg-[var(--window-bg)] px-2 py-1 font-mono text-[10px] text-[var(--ink-2)]">
                            {capability}
                          </span>
                        )) : <span className="text-xs text-[var(--ink-3)]">-</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="max-w-[300px] truncate font-mono text-xs text-[var(--ink-3)]">{preset.base_url || "-"}</div>
                    </td>
                    <td className="px-5 py-4 align-top text-xs text-[var(--ink-3)]">{formatDate(preset.updated_at)}</td>
                    <td className="px-5 py-4 align-top text-right">
                      {slug ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="rounded-full text-rose-500 hover:text-rose-500">
                              <Trash2 className="mr-2 size-4" />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete provider preset?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes {preset.name ?? slug} from the admin preset registry.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction disabled={deletingSlug === slug} onClick={(event) => { event.preventDefault(); void handleDelete(slug) }}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </AdminPanel>
    </AdminPageShell>
  )
}
