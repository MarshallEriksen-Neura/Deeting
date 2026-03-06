"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import useSWR from "swr"
import {
  AdminDataTable,
  AdminFilterBar,
  AdminStatusBadge,
  getStatusTone,
  Sparkline,
  type ColumnDef,
} from "@/components/admin"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  createAdminProviderInstance,
  fetchAdminProviderModels,
  fetchAdminProviderInstances,
  fetchAdminProviderPresets,
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
  unlockPriceCredits: string
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
  const t = useTranslations("admin.providerInstancesPage")
  const locale = useLocale()
  const [searchQuery, setSearchQuery] = useState("")
  const [healthFilter, setHealthFilter] = useState("")
  const [enabledFilter, setEnabledFilter] = useState("")

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [presetSlug, setPresetSlug] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [isPublicOnCreate, setIsPublicOnCreate] = useState(false)
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

  const { data: presets } = useSWR("/api/v1/admin/provider-presets", fetchAdminProviderPresets)

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
        unlockPriceCredits: toPriceInput(pricing.unlock_price_credits),
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
    const unlockPriceCredits = parsePrice(draft.unlockPriceCredits)
    if (inputPer1k === null || outputPer1k === null || unlockPriceCredits === null) {
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
        unlock_price_credits: unlockPriceCredits,
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

  const resetCreateForm = () => {
    setPresetSlug("")
    setName("")
    setDescription("")
    setBaseUrl("")
    setApiKey("")
    setIsPublicOnCreate(false)
  }

  const handlePresetSelect = (slug: string) => {
    setPresetSlug(slug)
    const preset = (presets ?? []).find((p) => p.slug === slug)
    if (preset?.base_url) {
      setBaseUrl(preset.base_url)
    }
    if (preset?.name && !name.trim()) {
      setName(preset.name)
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
        description: description.trim() || undefined,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        is_public: isPublicOnCreate,
      })
      resetCreateForm()
      setCreateDialogOpen(false)
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

  const activePresets = useMemo(
    () => (presets ?? []).filter((p) => p.is_active),
    [presets],
  )

  const canSubmitCreate =
    presetSlug.trim() && name.trim() && baseUrl.trim() && apiKey.trim() && !isSubmitting

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Dialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            setCreateDialogOpen(open)
            if (!open) resetCreateForm()
          }}
        >
          <DialogTrigger asChild>
            <Button>{t("actions.addInstance")}</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("dialog.title")}</DialogTitle>
              <DialogDescription>{t("dialog.description")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="create-preset">{t("form.presetSlug")}</Label>
                <Select value={presetSlug || "__none__"} onValueChange={(v) => handlePresetSelect(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="create-preset">
                    <SelectValue placeholder={t("form.selectPreset")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("form.selectPreset")}</SelectItem>
                    {activePresets.map((p) => (
                      <SelectItem key={p.slug} value={p.slug ?? ""}>
                        {p.name || p.slug} {p.category ? `(${p.category})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-name">{t("form.instanceName")}</Label>
                <Input
                  id="create-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("form.instanceNamePlaceholder")}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-desc">{t("form.description")}</Label>
                <Input
                  id="create-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("form.descriptionPlaceholder")}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-baseurl">{t("form.baseUrl")}</Label>
                <Input
                  id="create-baseurl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-apikey">{t("form.providerApiKey")}</Label>
                <Input
                  id="create-apikey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>

              <div className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
                <div>
                  <Label htmlFor="create-public" className="cursor-pointer">
                    {t("form.isPublic")}
                  </Label>
                  <p className="text-muted-foreground text-xs">{t("form.isPublicHint")}</p>
                </div>
                <Switch
                  id="create-public"
                  checked={isPublicOnCreate}
                  onCheckedChange={setIsPublicOnCreate}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCreateDialogOpen(false)
                  resetCreateForm()
                }}
              >
                {t("dialog.cancel")}
              </Button>
              <Button
                onClick={() => void handleCreateInstance()}
                disabled={!canSubmitCreate}
              >
                {isSubmitting ? t("actions.creating") : t("actions.addInstance")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {feedback && (
          <p className="text-muted-foreground text-xs">{feedback}</p>
        )}
      </div>

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
          <Button
            size="sm"
            variant="outline"
            onClick={(event) => {
              event.stopPropagation()
              handleOpenModelsPanel(row)
            }}
          >
            {t("actions.manageModels")}
          </Button>
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
              <Button
                size="sm"
                onClick={() => void handleSyncModels()}
                disabled={isSyncingModels}
              >
                {isSyncingModels ? t("models.actions.syncing") : t("models.actions.sync")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCloseModelsPanel}
              >
                {t("models.actions.close")}
              </Button>
            </div>
          </div>

          {modelFeedback && <p className="mt-3 text-xs text-[var(--muted)]">{modelFeedback}</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-[var(--muted)]">
                  <th className="px-2 py-2">{t("models.table.model")}</th>
                  <th className="px-2 py-2">{t("models.table.active")}</th>
                  <th className="px-2 py-2">
                    {t("models.table.inputPer1k")}
                    <span className="ml-1 font-normal text-[var(--muted)]">{t("models.table.creditsUnit")}</span>
                  </th>
                  <th className="px-2 py-2">
                    {t("models.table.outputPer1k")}
                    <span className="ml-1 font-normal text-[var(--muted)]">{t("models.table.creditsUnit")}</span>
                  </th>
                  <th className="px-2 py-2">
                    {t("models.table.unlockPriceCredits")}
                    <span className="ml-1 font-normal text-[var(--muted)]">{t("models.table.creditsUnit")}</span>
                  </th>
                  <th className="px-2 py-2 text-right">{t("models.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {modelsLoading ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-xs text-[var(--muted)]">
                      {t("models.empty.loading")}
                    </td>
                  </tr>
                ) : modelsError ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-xs text-rose-300">
                      {t("models.empty.failed")}
                    </td>
                  </tr>
                ) : (models ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-xs text-[var(--muted)]">
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
                          <Input
                            value={draft.inputPer1k}
                            onChange={(event) => {
                              handleModelStateChange(model.id, { inputPer1k: event.target.value })
                            }}
                            className="h-8 min-w-[100px] text-xs"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={draft.outputPer1k}
                            onChange={(event) => {
                              handleModelStateChange(model.id, { outputPer1k: event.target.value })
                            }}
                            className="h-8 min-w-[100px] text-xs"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={draft.unlockPriceCredits}
                            onChange={(event) => {
                              handleModelStateChange(model.id, { unlockPriceCredits: event.target.value })
                            }}
                            className="h-8 min-w-[100px] text-xs"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleSaveModel(model)}
                            disabled={draft.saving}
                          >
                            {draft.saving ? t("models.actions.saving") : t("models.actions.save")}
                          </Button>
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
    </>
  )
}
