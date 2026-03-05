"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import { Cloud } from "lucide-react"
import {
  AdminPageShell,
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  Sparkline,
  type ColumnDef,
} from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import { Switch } from "@/components/ui/switch"
import {
  createAdminProviderInstance,
  fetchAdminProviderModels,
  fetchAdminProviderInstances,
  syncAdminProviderModels,
  updateAdminProviderInstance,
  updateAdminProviderModel,
  type AdminProviderModelResponse,
  type ProviderInstanceItem,
} from "@/lib/api/admin-dashboard"

type ModelEditorState = {
  isActive: boolean
  inputPer1k: string
  outputPer1k: string
  saving: boolean
}

function toPriceInput(value: unknown): string {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(numeric) : ""
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : null
}

export function PageContent() {
  const tAdmin = useTranslations("admin")
  const t = useTranslations("admin.providerInstancesPage")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [healthFilter, setHealthFilter] = useState("")
  const [enabledFilter, setEnabledFilter] = useState("")
  const [presetSlug, setPresetSlug] = useState("")
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<ProviderInstanceItem | null>(null)
  const [modelFeedback, setModelFeedback] = useState<string | null>(null)
  const [isSyncingModels, setIsSyncingModels] = useState(false)
  const [modelEditorState, setModelEditorState] = useState<Record<string, ModelEditorState>>({})
  const [publishingInstanceId, setPublishingInstanceId] = useState<string | null>(null)

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/provider-instances", fetchAdminProviderInstances)

  const {
    data: models,
    error: modelsError,
    isLoading: modelsLoading,
    mutate: mutateModels,
  } = useSWR(
    selectedInstance ? ["/api/v1/admin/provider-instances/models", selectedInstance.id] : null,
    ([, instanceId]) => fetchAdminProviderModels(instanceId)
  )

  const allRows = useMemo(() => data ?? [], [data])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return allRows.filter((row) => {
      if (healthFilter && (row.health_status ?? "unknown") !== healthFilter) return false
      if (enabledFilter === "true" && !row.is_enabled) return false
      if (enabledFilter === "false" && row.is_enabled) return false
      if (!query) return true
      return [row.name, row.preset_slug, row.base_url, row.id].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    })
  }, [allRows, searchQuery, healthFilter, enabledFilter])

  useEffect(() => {
    if (!selectedInstance || !models) {
      setModelEditorState({})
      return
    }

    const nextState: Record<string, ModelEditorState> = {}
    for (const model of models) {
      const pricing = (model.pricing_config ?? {}) as Record<string, unknown>
      nextState[model.id] = {
        isActive: Boolean(model.is_active),
        inputPer1k: toPriceInput(
          pricing.input_per_1k ?? pricing.input ?? pricing.input_price
        ),
        outputPer1k: toPriceInput(
          pricing.output_per_1k ?? pricing.output ?? pricing.output_price
        ),
        saving: false,
      }
    }
    setModelEditorState(nextState)
  }, [models, selectedInstance])

  const handleOpenModelsPanel = (instance: ProviderInstanceItem) => {
    setSelectedInstance(instance)
    setModelFeedback(null)
  }

  const handleCloseModelsPanel = () => {
    setSelectedInstance(null)
    setModelFeedback(null)
    setModelEditorState({})
  }

  const handleSyncModels = async () => {
    if (!selectedInstance || isSyncingModels) return
    setIsSyncingModels(true)
    setModelFeedback(null)
    try {
      await syncAdminProviderModels(selectedInstance.id)
      await Promise.all([mutateModels(), mutate()])
      setModelFeedback(t("models.feedback.syncSuccess"))
    } catch (syncError) {
      const message =
        syncError instanceof Error ? syncError.message : t("models.feedback.syncFailed")
      setModelFeedback(message)
    } finally {
      setIsSyncingModels(false)
    }
  }

  const handleModelStateChange = (
    modelId: string,
    patch: Partial<Omit<ModelEditorState, "saving">>
  ) => {
    setModelEditorState((current) => {
      const existing = current[modelId]
      if (!existing) return current
      return {
        ...current,
        [modelId]: {
          ...existing,
          ...patch,
        },
      }
    })
  }

  const handleSaveModel = async (model: AdminProviderModelResponse) => {
    const draft = modelEditorState[model.id]
    if (!draft || draft.saving) return

    const inputPer1k = parsePrice(draft.inputPer1k)
    const outputPer1k = parsePrice(draft.outputPer1k)
    if (inputPer1k === null || outputPer1k === null) {
      setModelFeedback(t("models.feedback.invalidPricing"))
      return
    }

    setModelFeedback(null)
    setModelEditorState((current) => ({
      ...current,
      [model.id]: {
        ...current[model.id],
        saving: true,
      },
    }))

    try {
      const pricingConfig = {
        ...(model.pricing_config ?? {}),
        input_per_1k: inputPer1k,
        output_per_1k: outputPer1k,
      }
      await updateAdminProviderModel(model.id, {
        is_active: draft.isActive,
        pricing_config: pricingConfig,
      })
      await Promise.all([mutateModels(), mutate()])
      setModelFeedback(t("models.feedback.saveSuccess", { model: model.display_name || model.model_id }))
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : t("models.feedback.saveFailed")
      setModelFeedback(message)
    } finally {
      setModelEditorState((current) => ({
        ...current,
        [model.id]: {
          ...current[model.id],
          saving: false,
        },
      }))
    }
  }

  const handleCreateInstance = async () => {
    if (!presetSlug.trim() || !name.trim() || !baseUrl.trim() || !apiKey.trim() || isSubmitting) {
      return
    }
    setIsSubmitting(true)
    setFeedback(null)
    try {
      const created = await createAdminProviderInstance({
        preset_slug: presetSlug.trim(),
        name: name.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
      })
      setPresetSlug("")
      setName("")
      setBaseUrl("")
      setApiKey("")
      setFeedback(t("feedback.created", { name: created.name }))
      await mutate()
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : t("feedback.createFailed")
      setFeedback(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePublishToggle = async (instance: ProviderInstanceItem, nextPublic: boolean) => {
    if (publishingInstanceId) return
    setPublishingInstanceId(instance.id)
    setFeedback(null)
    try {
      await updateAdminProviderInstance(instance.id, { is_public: nextPublic })
      await mutate()
      setFeedback(
        nextPublic
          ? t("feedback.published", { name: instance.name })
          : t("feedback.unpublished", { name: instance.name })
      )
    } catch (toggleError) {
      const message =
        toggleError instanceof Error ? toggleError.message : t("feedback.publishFailed")
      setFeedback(message)
    } finally {
      setPublishingInstanceId(null)
    }
  }

  const statusColor: Record<string, string> = {
    up: "rgb(52,211,153)",
    active: "rgb(52,211,153)",
    degraded: "rgb(251,191,36)",
    down: "rgb(248,113,113)",
    unknown: "rgb(148,163,184)",
  }

  const healthLabelMap: Record<string, string> = {
    up: t("health.up"),
    active: t("health.active"),
    degraded: t("health.degraded"),
    down: t("health.down"),
    unknown: t("health.unknown"),
  }

  const columns: ColumnDef<ProviderInstanceItem>[] = [
    {
      key: "name",
      header: t("table.headers.name"),
      sortable: true,
      render: (row) => {
        const health = row.health_status ?? "unknown"
        return (
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: statusColor[health] ?? statusColor.unknown }}
            />
            <span className="font-medium text-[var(--foreground)]">{row.name}</span>
          </div>
        )
      },
    },
    {
      key: "preset_slug",
      header: t("table.headers.provider"),
      render: (row) => <AdminStatusBadge text={row.preset_slug} tone="info" dot={false} />,
    },
    {
      key: "base_url",
      header: t("table.headers.baseUrl"),
      render: (row) => (
        <span className="inline-block max-w-[220px] truncate font-mono text-xs text-[var(--muted)]">
          {row.base_url}
        </span>
      ),
    },
    {
      key: "priority",
      header: t("table.headers.priority"),
      sortable: true,
      render: (row) => <span className="font-mono text-xs">{row.priority}</span>,
    },
    {
      key: "is_enabled",
      header: t("table.headers.enabled"),
      render: (row) => (
        <AdminStatusBadge
          text={row.is_enabled ? t("enabled.enabled") : t("enabled.disabled")}
          tone={row.is_enabled ? "success" : "error"}
        />
      ),
    },
    {
      key: "is_public",
      header: t("table.headers.publish"),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(row.is_public)}
            onCheckedChange={(checked) => {
              void handlePublishToggle(row, checked)
            }}
            disabled={publishingInstanceId === row.id}
          />
          <span className="text-xs text-[var(--muted)]">
            {row.is_public ? t("publish.public") : t("publish.private")}
          </span>
        </div>
      ),
    },
    {
      key: "health_status",
      header: t("table.headers.health"),
      render: (row) => {
        const health = row.health_status ?? "unknown"
        return (
          <AdminStatusBadge
            text={healthLabelMap[health] ?? health}
            tone={getStatusTone(health)}
          />
        )
      },
    },
    {
      key: "latency_ms",
      header: t("table.headers.latency"),
      sortable: true,
      render: (row) => {
        const latency = row.latency_ms ?? 0
        return (
          <span
            className={
              latency > 200
                ? "text-amber-400"
                : latency === 0
                  ? "text-[var(--muted)]"
                  : "text-emerald-400"
            }
          >
            {latency > 0
              ? t("table.latencyMs", {
                  value: new Intl.NumberFormat(locale).format(latency),
                })
              : "—"}
          </span>
        )
      },
    },
    {
      key: "model_count",
      header: t("table.headers.models"),
      render: (row) => <span>{row.model_count}</span>,
    },
    {
      key: "sparkline",
      header: t("table.headers.trend"),
      align: "right",
      render: (row) => {
        const health = row.health_status ?? "unknown"
        return (
          <Sparkline
            data={row.sparkline}
            color={statusColor[health] ?? statusColor.unknown}
            width={80}
            height={24}
          />
        )
      },
    },
  ]

  return (
    <AdminPageShell
      title={tAdmin("providerInstances.title")}
      description={tAdmin("providerInstances.description")}
      icon={Cloud}
    >
      <GlassCard padding="default" hover="none">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            value={presetSlug}
            onChange={(event) => setPresetSlug(event.target.value)}
            placeholder={t("form.presetSlug")}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("form.instanceName")}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={t("form.baseUrl")}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t("form.providerApiKey")}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
          />
          <button
            onClick={() => void handleCreateInstance()}
            disabled={!presetSlug.trim() || !name.trim() || !baseUrl.trim() || !apiKey.trim() || isSubmitting}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? t("actions.creating") : t("actions.addInstance")}
          </button>
        </div>
        {feedback && <p className="mt-2 text-xs text-[var(--muted)]">{feedback}</p>}
      </GlassCard>

      <AdminFilterBar
        searchPlaceholder={t("filters.searchPlaceholder")}
        onSearch={setSearchQuery}
        onFilterChange={(key, value) => {
          if (key === "health") setHealthFilter(value)
          if (key === "enabled") setEnabledFilter(value)
        }}
        filters={[
          {
            key: "health",
            label: t("filters.health"),
            options: [
              { label: t("health.up"), value: "up" },
              { label: t("health.degraded"), value: "degraded" },
              { label: t("health.down"), value: "down" },
              { label: t("health.unknown"), value: "unknown" },
            ],
          },
          {
            key: "enabled",
            label: t("filters.enabled"),
            options: [
              { label: t("enabled.yes"), value: "true" },
              { label: t("enabled.no"), value: "false" },
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
        rowActions={(row) => (
          <button
            onClick={(event) => {
              event.stopPropagation()
              handleOpenModelsPanel(row)
            }}
            className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-white/15 px-2 text-xs text-[var(--foreground)] transition-colors hover:bg-white/10"
          >
            {t("actions.manageModels")}
          </button>
        )}
      />

      {selectedInstance && (
        <GlassCard padding="default" hover="none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                {t("models.title", { instance: selectedInstance.name })}
              </h3>
              <p className="text-xs text-[var(--muted)]">{selectedInstance.base_url}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleSyncModels()}
                disabled={isSyncingModels}
                className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-[var(--primary)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSyncingModels ? t("models.actions.syncing") : t("models.actions.sync")}
              </button>
              <button
                onClick={handleCloseModelsPanel}
                className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/15 px-3 text-xs text-[var(--foreground)] transition-colors hover:bg-white/10"
              >
                {t("models.actions.close")}
              </button>
            </div>
          </div>

          {modelFeedback && <p className="mt-3 text-xs text-[var(--muted)]">{modelFeedback}</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-[var(--muted)]">
                  <th className="px-2 py-2">{t("models.table.model")}</th>
                  <th className="px-2 py-2">{t("models.table.active")}</th>
                  <th className="px-2 py-2">{t("models.table.inputPer1k")}</th>
                  <th className="px-2 py-2">{t("models.table.outputPer1k")}</th>
                  <th className="px-2 py-2 text-right">{t("models.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {modelsLoading ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-xs text-[var(--muted)]">
                      {t("models.empty.loading")}
                    </td>
                  </tr>
                ) : modelsError ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-xs text-rose-300">
                      {t("models.empty.failed")}
                    </td>
                  </tr>
                ) : (models ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-xs text-[var(--muted)]">
                      {t("models.empty.noData")}
                    </td>
                  </tr>
                ) : (
                  (models ?? []).map((model) => {
                    const draft = modelEditorState[model.id]
                    if (!draft) return null
                    return (
                      <tr key={model.id} className="border-b border-white/5">
                        <td className="px-2 py-2">
                          <div className="font-medium text-[var(--foreground)]">
                            {model.display_name || model.model_id}
                          </div>
                          <div className="font-mono text-xs text-[var(--muted)]">{model.model_id}</div>
                        </td>
                        <td className="px-2 py-2">
                          <Switch
                            checked={draft.isActive}
                            onCheckedChange={(checked) => {
                              handleModelStateChange(model.id, { isActive: checked })
                            }}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={draft.inputPer1k}
                            onChange={(event) => {
                              handleModelStateChange(model.id, { inputPer1k: event.target.value })
                            }}
                            className="h-8 w-full min-w-[120px] rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={draft.outputPer1k}
                            onChange={(event) => {
                              handleModelStateChange(model.id, { outputPer1k: event.target.value })
                            }}
                            className="h-8 w-full min-w-[120px] rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-[var(--foreground)] focus:border-[var(--primary)]/50 focus:outline-none"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={() => void handleSaveModel(model)}
                            disabled={draft.saving}
                            className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-emerald-300/30 px-2 text-xs text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {draft.saving ? t("models.actions.saving") : t("models.actions.save")}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </AdminPageShell>
  )
}
