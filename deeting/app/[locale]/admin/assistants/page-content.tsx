"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Sparkles, Star } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  type ColumnDef,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import {
  createAdminAssistant,
  fetchAdminAssistants,
  type AdminAssistantItem,
} from "@/lib/api/admin-dashboard"

function shortId(value?: string | null) {
  if (!value) return "—"
  return `${value.slice(0, 8)}...`
}

function getCurrentVersion(row: AdminAssistantItem) {
  if (!row.versions.length) return null
  if (!row.current_version_id) return row.versions[0]
  return (
    row.versions.find((version) => version.id === row.current_version_id) ?? row.versions[0]
  )
}

function getModelName(row: AdminAssistantItem) {
  const current = getCurrentVersion(row)
  if (!current?.model_config) return null
  const model = current.model_config.model
  const modelName = current.model_config.model_name
  if (typeof model === "string") return model
  if (typeof modelName === "string") return modelName
  return null
}

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale).format(date)
}

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.assistantsPage")
  const locale = useLocale()
  const numberFormatter = new Intl.NumberFormat(locale)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [visibilityFilter, setVisibilityFilter] = useState("")
  const [name, setName] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [summary, setSummary] = useState("")
  const [createVisibility, setCreateVisibility] = useState<"private" | "unlisted" | "public">("private")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/assistants?size=50", () => fetchAdminAssistants({ size: 50 }))

  const allRows = useMemo(() => data?.items ?? [], [data?.items])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false
      if (visibilityFilter && row.visibility !== visibilityFilter) return false
      if (!query) return true
      const current = getCurrentVersion(row)
      return [
        row.id,
        row.owner_user_id,
        row.summary,
        current?.name,
        current?.version,
        ...(current?.tags ?? []),
      ].some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [allRows, searchQuery, statusFilter, visibilityFilter])

  const handleCreateAssistant = async () => {
    if (!name.trim() || !systemPrompt.trim() || isSubmitting) return
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const created = await createAdminAssistant({
        visibility: createVisibility,
        summary: summary.trim() || undefined,
        version: {
          name: name.trim(),
          description: summary.trim() || undefined,
          system_prompt: systemPrompt,
          model_config: {
            model: "gpt-4o-mini",
            temperature: 0.7,
          },
        },
      })
      setName("")
      setSystemPrompt("")
      setSummary("")
      setFeedback(t("feedback.created", { id: created.id }))
      await mutate()
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : t("feedback.createFailed")
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const visibilityTextMap: Record<string, string> = {
    private: t("visibility.private"),
    unlisted: t("visibility.unlisted"),
    public: t("visibility.public"),
  }
  const statusTextMap: Record<string, string> = {
    draft: t("status.draft"),
    published: t("status.published"),
    archived: t("status.archived"),
  }

  const columns: ColumnDef<AdminAssistantItem>[] = [
    {
      key: "name",
      header: t("table.headers.name"),
      sortable: true,
      render: (row) => {
        const current = getCurrentVersion(row)
        return (
          <div>
            <span className="font-medium text-[var(--foreground)]">
              {current?.name || row.summary || row.id}
            </span>
            {!!current?.tags.length && (
              <div className="mt-0.5 flex gap-1">
                {current.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-[var(--muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: "owner_user_id",
      header: t("table.headers.owner"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{shortId(row.owner_user_id)}</span>,
    },
    {
      key: "visibility",
      header: t("table.headers.visibility"),
      render: (row) => (
        <AdminStatusBadge
          text={visibilityTextMap[row.visibility] ?? row.visibility}
          tone={getStatusTone(row.visibility)}
          dot={false}
        />
      ),
    },
    {
      key: "status",
      header: t("table.headers.status"),
      render: (row) => (
        <AdminStatusBadge text={statusTextMap[row.status] ?? row.status} tone={getStatusTone(row.status)} />
      ),
    },
    {
      key: "version",
      header: t("table.headers.version"),
      render: (row) => <span className="text-[var(--muted)]">{getCurrentVersion(row)?.version || "—"}</span>,
    },
    {
      key: "install_count",
      header: t("table.headers.installs"),
      sortable: true,
      render: (row) => <span>{numberFormatter.format(row.install_count)}</span>,
    },
    {
      key: "rating_avg",
      header: t("table.headers.rating"),
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-1">
          <Star className="size-3 fill-amber-400 text-amber-400" />
          <span className="text-sm text-[var(--foreground)]">{row.rating_avg.toFixed(1)}</span>
          <span className="text-xs text-[var(--muted)]">({row.rating_count})</span>
        </div>
      ),
    },
    {
      key: "model",
      header: t("table.headers.model"),
      render: (row) => (
        <span className="font-mono text-xs text-[var(--muted)]">{getModelName(row) || "—"}</span>
      ),
    },
    {
      key: "published_at",
      header: t("table.headers.published"),
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--muted)]">
          {row.published_at ? formatDate(row.published_at, locale) : "—"}
        </span>
      ),
    },
  ]

  return (
    <AdminPageShell
      title={tAdmin("assistants.title")}
      description={tAdmin("assistants.description")}
      icon={Sparkles}
    >
      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("form.assistantName")}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder={t("form.summary")}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <select
            value={createVisibility}
            onChange={(event) => setCreateVisibility(event.target.value as "private" | "unlisted" | "public")}
            className="h-9 cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--foreground)] focus:outline-none"
          >
            <option value="private">{t("visibility.private")}</option>
            <option value="unlisted">{t("visibility.unlisted")}</option>
            <option value="public">{t("visibility.public")}</option>
          </select>
          <button
            onClick={() => void handleCreateAssistant()}
            disabled={!name.trim() || !systemPrompt.trim() || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? t("actions.creating") : t("actions.create")}
          </button>
        </div>
        <textarea
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder={t("form.systemPrompt")}
          rows={3}
          className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
        />
        {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "status") setStatusFilter(value)
          if (key === "visibility") setVisibilityFilter(value)
        }}
        filters={[
          {
            key: "status",
            label: t("filters.status"),
            options: [
              { label: t("status.draft"), value: "draft" },
              { label: t("status.published"), value: "published" },
              { label: t("status.archived"), value: "archived" },
            ],
          },
          {
            key: "visibility",
            label: t("filters.visibility"),
            options: [
              { label: t("visibility.private"), value: "private" },
              { label: t("visibility.unlisted"), value: "unlisted" },
              { label: t("visibility.public"), value: "public" },
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
