"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { RefreshCw, Sparkles, X, Database, Zap, Search, Trash2 } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import { useProviderModels, useSyncProviderModels, useProviderInstances, useUpdateProviderModel, useTestProviderModel, useQuickAddProviderModels, useProviderModelPurchase, useUpdateProviderInstance, useDeleteProviderInstance } from "@/hooks/use-providers"
import { useDebounce } from "@/hooks/use-debounce"
import {
  hasVersionedPath,
  resolveOpenAICompatibleBaseUrl,
  stripRedundantVersionPrefix,
} from "@/lib/providers/endpoint-normalization"
import { ModelEmptyState } from "./empty-state"
import { InstanceDashboard } from "./instance-dashboard"
import { FilterLens } from "./filter-lens"
import { TestDrawer } from "./test-drawer"
import type { ProviderModelResponse, ProviderModelUpdate } from "@/lib/api/providers"
import { resolveModelCapabilities } from "@/lib/providers/model-capabilities"
import type { ProviderModel, ModelCapability, ModelFilterState, ProviderStatus } from "./types"
import { getPriceTier } from "./types"
import { toast } from "sonner"
import { GlassCard } from "@/components/ui/common/glass-card"
import ConnectProviderDrawer from "@/components/providers/connect-provider-drawer"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/shadcn/dialog"
import { Textarea } from "@/components/ui/shadcn/textarea"
import { Badge } from "@/components/ui/shadcn/badge"
import { ModelMatrix } from "./model-matrix"
import { ModelConfigPanel } from "./model-config-panel"
import { cn } from "@/lib/utils"

interface ModelsManagerProps {
  instanceId: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; detail?: unknown }
    if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message
    if (typeof candidate.detail === "string" && candidate.detail.trim()) return candidate.detail
  }
  return ""
}

function sortModelsByActiveStatus(models: ProviderModel[]): ProviderModel[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      if (a.model.is_active !== b.model.is_active) {
        return a.model.is_active ? -1 : 1
      }
      return a.index - b.index
    })
    .map(({ model }) => model)
}

export function ModelsManager({ instanceId }: ModelsManagerProps) {
  const t = useTranslations("models")
  
  // Data Fetching
  const { instances, mutate: mutateInstance } = useProviderInstances()
  const { models, isLoading, mutate: mutateModels } = useProviderModels(instanceId)
  
  // Actions
  const { sync } = useSyncProviderModels()
  const { update: updateModel } = useUpdateProviderModel()
  const { test: testModelApi } = useTestProviderModel()
  const { quickAdd } = useQuickAddProviderModels()
  const { purchase: purchaseModel } = useProviderModelPurchase()
  const { update: updateInstance } = useUpdateProviderInstance()
  const { remove: deleteInstance } = useDeleteProviderInstance()

  // State
  const [isSyncing, setIsSyncing] = React.useState(false)
  const [testModel, setTestModel] = React.useState<ProviderModel | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false)
  const [quickAddOpen, setQuickAddOpen] = React.useState(false)
  const [quickAddInput, setQuickAddInput] = React.useState("")
  const [quickAddLoading, setQuickAddLoading] = React.useState(false)
  const [purchasingModelUuid, setPurchasingModelUuid] = React.useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = React.useState<string | null>(null)
  const [localSearch, setLocalSearch] = React.useState("")
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isTogglingEnabled, setIsTogglingEnabled] = React.useState(false)
  const debouncedSearch = useDebounce(localSearch, 300)
  const [filters, setFilters] = React.useState<ModelFilterState>({
    search: "",
    capabilities: [],
    min_context_window: null,
    active_only: false,
    price_tier: null,
  })

  // Sync debounced search to filters
  React.useEffect(() => {
    if (debouncedSearch !== filters.search) {
      setFilters(prev => ({ ...prev, search: debouncedSearch }))
    }
  }, [debouncedSearch])

  const normalizeStatus = React.useCallback((value?: string | null): ProviderStatus => {
    const status = (value ?? "").toLowerCase()
    if (status === "online" || status === "healthy" || status === "up" || status === "ok") return "online"
    if (status === "degraded" || status === "warning") return "degraded"
    if (status === "syncing") return "syncing"
    if (status === "offline" || status === "down") return "offline"
    return "unknown"
  }, [])
  
  // Derived Data
  const instance = React.useMemo<import("./types").ProviderInstance | undefined>(
    () => {
      const raw = instances.find(i => i.id === instanceId)
      if (!raw) return undefined
      return {
        ...raw,
        provider_display_name: raw.preset_slug,
        status: normalizeStatus(raw.health_status),
        latency: raw.latency_ms,
        model_count: typeof raw.model_count === "number" ? raw.model_count : 0,
        last_synced_at: raw.updated_at,
        theme_color: raw.theme_color || undefined,
        description: raw.description || undefined,
        icon: raw.icon || undefined,
        is_public: raw.is_public ?? false,
        has_credentials: raw.has_credentials ?? undefined,
      }
    },
    [instances, instanceId, normalizeStatus]
  )

  const supportsOpenAiCompatibleChatContentConfig = React.useMemo(() => {
    const protocolValue = (
      instance?.protocol ||
      instance?.provider ||
      instance?.preset_slug ||
      ""
    ).toLowerCase()
    const presetSlug = (instance?.preset_slug || "").toLowerCase()
    return protocolValue.includes("openai") && presetSlug !== "openai"
  }, [instance?.preset_slug, instance?.protocol, instance?.provider])

  const buildRequestUrl = React.useCallback(
    (baseUrl?: string, upstreamPath?: string) => {
      if (!baseUrl) return ""
      const base = baseUrl.trim().replace(/\/+$/, "")
      if (!base) return ""
      let path = (upstreamPath || "").replace(/^\/+/, "")
      const protocolValue = (
        instance?.protocol ||
        instance?.provider ||
        instance?.preset_slug ||
        ""
      ).toLowerCase()
      const isOpenAI = protocolValue.includes("openai") && !protocolValue.includes("azure")
      const appendV1 = instance?.auto_append_v1 ?? (isOpenAI ? true : false)
      const resolvedBase = isOpenAI
        ? resolveOpenAICompatibleBaseUrl(base, appendV1)
        : base
      if (hasVersionedPath(resolvedBase)) {
        path = stripRedundantVersionPrefix(path)
      }
      return path ? `${resolvedBase}/${path}` : resolvedBase
    },
    [instance]
  )

  const toNumber = React.useCallback((v: unknown, fallback = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }, [])

  const normalizeModel = React.useCallback(
    (m: ProviderModelResponse): ProviderModel => {
      const pricing = (m.pricing_config || {}) as Record<string, unknown>
      const inputPrice = toNumber(pricing.input_per_1k ?? pricing.input ?? pricing.input_price, 0)
      const outputPrice = toNumber(pricing.output_per_1k ?? pricing.output ?? pricing.output_price, 0)
      const extraMeta = (m.extra_meta || {}) as Record<string, unknown>
      const routingConfig = (m.routing_config || {}) as Record<string, unknown>
      const configOverride = (m.config_override || {}) as Record<string, unknown>
      const capabilities = resolveModelCapabilities({
        capabilities: m.capabilities,
        routingConfig,
        extraMeta,
        defaultCapability: "chat",
      }) as ModelCapability[]
      const tokenizerConfig = (m.tokenizer_config || {}) as Record<string, unknown>
      const rawMeta = (extraMeta.raw || {}) as Record<string, unknown>
      const contextWindow = toNumber(tokenizerConfig.context_window ?? extraMeta.context_window ?? rawMeta.context_window, 0)
      const limitConfig = (m.limit_config || {}) as Record<string, unknown>
      const requestUrl = buildRequestUrl(instance?.base_url, m.upstream_path)

      return {
        uuid: m.id,
        id: m.model_id || m.unified_model_id || m.id,
        object: "model",
        display_name: m.display_name || m.unified_model_id || m.model_id,
        unified_model_id: m.unified_model_id || m.model_id,
        capabilities,
        context_window: contextWindow,
        pricing: { input: inputPrice, output: outputPrice },
        is_active: m.is_active,
        is_locked: m.is_locked ?? false,
        is_purchased: m.is_purchased ?? true,
        unlock_price_credits: m.unlock_price_credits ?? null,
        upstream_path: m.upstream_path,
        request_url: requestUrl,
        weight: toNumber(m.weight, 0),
        priority: toNumber(m.priority, 0),
        updated_at: m.updated_at || m.synced_at || "",
        created_at: m.created_at || undefined,
        routing_config: routingConfig,
        config_override: configOverride,
        family: typeof rawMeta.owned_by === 'string' ? rawMeta.owned_by : undefined,
        version: m.unified_model_id || undefined,
        max_output_tokens: typeof limitConfig.max_output_tokens === 'number' ? limitConfig.max_output_tokens : undefined,
        rpm: typeof limitConfig.rpm === 'number' ? limitConfig.rpm : undefined,
        tpm: typeof limitConfig.tpm === 'number' ? limitConfig.tpm : undefined,
        max_input_images: typeof routingConfig.max_input_images === 'number' ? routingConfig.max_input_images : undefined,
        supports_functions: !!rawMeta.supports_functions,
        supports_json_mode: !!rawMeta.supports_json_mode,
        deprecated_at: typeof rawMeta.deprecated_at === 'string' ? rawMeta.deprecated_at : undefined,
      }
    },
    [buildRequestUrl, instance?.base_url, toNumber]
  )

  const normalizedModels = React.useMemo<ProviderModel[]>(
    () => (models || []).map(normalizeModel),
    [models, normalizeModel]
  )

  const filteredModels = React.useMemo<ProviderModel[]>(() => {
    let result = normalizedModels
    if (filters.search) {
      const q = filters.search.toLowerCase()
      result = result.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          (m.display_name ?? "").toLowerCase().includes(q) ||
          (m.unified_model_id ?? "").toLowerCase().includes(q) ||
          (m.family ?? "").toLowerCase().includes(q)
      )
    }
    if (filters.capabilities.length > 0) {
      result = result.filter((m) =>
        filters.capabilities.every((c) => m.capabilities.includes(c))
      )
    }
    if (filters.min_context_window !== null) {
      result = result.filter((m) => m.context_window >= filters.min_context_window!)
    }
    if (filters.active_only) {
      result = result.filter((m) => m.is_active)
    }
    if (filters.price_tier !== null) {
      result = result.filter((m) => getPriceTier(m.pricing.input) === filters.price_tier)
    }
    return sortModelsByActiveStatus(result)
  }, [normalizedModels, filters])

  const selectedModel = React.useMemo(
    () => filteredModels.find(m => m.id === selectedModelId),
    [filteredModels, selectedModelId]
  )

  const providerHost = React.useMemo(() => {
    if (!instance?.base_url) return ""
    return instance.base_url.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  }, [instance?.base_url])

  const handleToggleActive = React.useCallback(async (model: ProviderModel, active: boolean) => {
    try {
      await updateModel(model.uuid, { is_active: active })
      await mutateModels()
      toast.success(t("toast.updateSuccess"))
    } catch {
      toast.error(t("toast.updateFailed"))
    }
  }, [updateModel, mutateModels, t])

  const handleUpdateAlias = React.useCallback(async (model: ProviderModel, alias: string) => {
    try {
      await updateModel(model.uuid, { display_name: alias })
      await mutateModels()
      toast.success(t("toast.updateSuccess"))
    } catch {
      toast.error(t("toast.updateFailed"))
    }
  }, [updateModel, mutateModels, t])

  const handleSaveConfig = React.useCallback(
    async (model: ProviderModel, payload: ProviderModelUpdate) => {
      try {
        await updateModel(model.uuid, payload)
        await mutateModels()
        toast.success(t("toast.updateSuccess"))
      } catch (err) {
        toast.error(t("toast.updateFailed"))
        throw err
      }
    },
    [mutateModels, t, updateModel]
  )

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      await sync(instanceId)
      await mutateModels()
      toast.success(t("toast.syncSuccess"))
    } catch (err: unknown) {
      const detail = getErrorMessage(err)
      toast.error(detail ? `${t("toast.syncFailed")}: ${detail}` : t("toast.syncFailed"))
    } finally {
      setIsSyncing(false)
    }
  }

  const handleQuickAddSubmit = async () => {
    const modelsInput = quickAddInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    if (modelsInput.length === 0) {
      toast.error(t("quickAdd.errorEmpty"))
      return
    }
    setQuickAddLoading(true)
    try {
      const res = await quickAdd(instanceId, { models: modelsInput })
      await mutateModels()
      toast.success(t("quickAdd.toastSuccess", { count: res.length }))
      setQuickAddOpen(false)
      setQuickAddInput("")
    } catch {
      toast.error(t("quickAdd.toastFailed"))
    } finally {
      setQuickAddLoading(false)
    }
  }

  const handleTestModel = (model: ProviderModel) => {
    setTestModel(model)
  }

  const handlePurchaseModel = React.useCallback(
    async (model: ProviderModel) => {
      try {
        setPurchasingModelUuid(model.uuid)
        await purchaseModel(model.uuid)
        await mutateModels()
        toast.success(t("toast.purchaseSuccess"))
      } catch (err) {
        const detail = getErrorMessage(err)
        toast.error(detail ? `${t("toast.purchaseFailed")}: ${detail}` : t("toast.purchaseFailed"))
      } finally {
        setPurchasingModelUuid(null)
      }
    },
    [mutateModels, purchaseModel, t]
  )

  const handleToggleEnabled = React.useCallback(async (enabled: boolean) => {
    if (!instance) return
    setIsTogglingEnabled(true)
    try {
      await updateInstance(instanceId, { is_enabled: enabled })
      await mutateInstance()
      toast.success(t("toast.updateSuccess"))
    } catch {
      toast.error(t("toast.updateFailed"))
    } finally {
      setIsTogglingEnabled(false)
    }
  }, [instance, instanceId, updateInstance, mutateInstance, t])

  const handleDeleteInstance = React.useCallback(async () => {
    if (!instance) return
    setIsDeleting(true)
    try {
      await deleteInstance(instanceId)
      await mutateInstance()
      toast.success(t("toast.deleteSuccess"))
    } catch {
      toast.error(t("toast.deleteFailed"))
    } finally {
      setIsDeleting(false)
      setDeleteDialogOpen(false)
    }
  }, [instance, instanceId, deleteInstance, mutateInstance, t])

  const handleSendTestMessage = React.useCallback(async (message: string) => {
    if (!testModel) {
      return {
        id: "error",
        role: "assistant" as const,
        content: t("test.noModelSelected"),
        timestamp: new Date().toISOString(),
      }
    }
    try {
      const res = await testModelApi(testModel.uuid, { prompt: message })
      if (!res.success) throw new Error(res.error || t("error.unknown"))
      return {
        id: `resp-${Date.now()}`,
        role: "assistant" as const,
        content: res.response_body ? JSON.stringify(res.response_body, null, 2) : (res.error || t("test.success")),
        timestamp: new Date().toISOString(),
        latency: res.latency_ms,
      }
    } catch (err: unknown) {
      return {
        id: `error-${Date.now()}`,
        role: "assistant" as const,
        content: t("test.errorWithDetail", { message: err instanceof Error ? err.message : String(err) }),
        timestamp: new Date().toISOString(),
      }
    }
  }, [t, testModel, testModelApi])

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-24 bg-[var(--panel-bg-inset)] rounded-2xl animate-pulse opacity-50" />
        <div className="h-96 bg-[var(--panel-bg-inset)] rounded-2xl animate-pulse opacity-50" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden px-5 py-6 xl:px-6">
      {/* Dashboard Stats */}
      <div className="flex-none">
        {instance && (
          <InstanceDashboard
            instance={instance}
            syncState={{
              is_syncing: isSyncing,
              progress: isSyncing ? 20 : 0,
              last_sync: instance.last_synced_at ?? null,
              error: null,
            }}
            onSettings={() => setEditDrawerOpen(true)}
            onToggleEnabled={handleToggleEnabled}
            onDelete={() => setDeleteDialogOpen(true)}
          />
        )}
      </div>

      {/* KPI Row */}
      {normalizedModels.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {(() => {
            const activeCount = normalizedModels.filter(m => m.is_active).length
            const lockedCount = normalizedModels.filter(m => m.is_locked).length
            const freeCount = normalizedModels.filter(m => m.pricing.input === 0).length
            return (
              <>
                <GlassCard padding="sm" hover="none" className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">{t("kpi.total")}</span>
                  <span className="font-mono text-[22px] font-semibold leading-none tracking-[-0.5px] text-[var(--ink)]">{normalizedModels.length}</span>
                </GlassCard>
                <GlassCard padding="sm" hover="none" theme="primary" className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">{t("kpi.active")}</span>
                  <span className="font-mono text-[22px] font-semibold leading-none tracking-[-0.5px] text-[var(--ok)]">{activeCount}</span>
                </GlassCard>
                <GlassCard padding="sm" hover="none" className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">{t("kpi.free")}</span>
                  <span className="font-mono text-[22px] font-semibold leading-none tracking-[-0.5px] text-[var(--info)]">{freeCount}</span>
                </GlassCard>
                <GlassCard padding="sm" hover="none" theme={lockedCount > 0 ? "primary" : "default"} className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-3)]">{t("kpi.locked")}</span>
                  <span className="font-mono text-[22px] font-semibold leading-none tracking-[-0.5px] text-[var(--warn)]">{lockedCount}</span>
                </GlassCard>
              </>
            )
          })()}
        </div>
      )}

      {/* Main Workspace with Filter & Matrix */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Workspace Toolbar */}
        <div className="mb-3 flex-none rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-8 flex-none items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)]">
                <Database className="size-4 text-[var(--accent-strong)]" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">{t("title")}</h2>
                  <Badge variant="secondary" className="h-5 rounded-full border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-2 text-[10px] font-medium text-[var(--ink-3)]">
                    {filteredModels.length} / {normalizedModels.length}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[var(--ink-3)]">
                  {instance?.name}
                  {providerHost ? ` · ${providerHost}` : ""}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="relative min-w-0 flex-1 lg:w-[220px] lg:flex-none">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ink-4)]" />
                <input
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  placeholder={t("filter.searchPlaceholder")}
                  className="h-8 w-full rounded-[var(--r-8)] bg-[var(--panel-bg-inset)] pl-8 pr-3 text-[12px] ring-1 ring-[var(--hairline)] outline-none transition-all placeholder:text-[var(--ink-4)] focus:ring-[var(--hairline-strong)]"
                />
              </div>
              <button
                onClick={() => setQuickAddOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-8)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--ink-2)] transition-all hover:border-[var(--hairline-strong)] hover:bg-[var(--panel-bg-inset)] active:scale-[0.98]"
              >
                <Sparkles className="size-3.5 text-[var(--accent-strong)]" />
                {t("quickAdd.cta")}
              </button>
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-8)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--ink)] transition-all hover:border-[var(--hairline-strong)] hover:bg-[var(--panel-bg-inset)] active:scale-[0.98] disabled:opacity-50"
              >
                <RefreshCw className={cn("size-3.5 text-[var(--ok)]", isSyncing && "animate-spin")} />
                {t("instance.syncModels")}
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <FilterLens
          filters={filters}
          onFiltersChange={setFilters}
          totalModels={normalizedModels.length}
          filteredCount={filteredModels.length}
          className="mb-3"
        />

        {/* Scrollable Model Grid */}
        <div className="relative mt-1 flex-1 overflow-y-auto custom-scrollbar">
          {normalizedModels.length > 0 ? (
            <ModelMatrix
              models={filteredModels}
              onTest={handleTestModel}
              onToggleActive={handleToggleActive}
              onUpdateAlias={handleUpdateAlias}
              onPurchase={handlePurchaseModel}
              readOnly={instance?.is_public === true}
              purchasingModelUuid={purchasingModelUuid}
              selectedModelId={selectedModelId}
              onRowClick={(model) => setSelectedModelId(model.id)}
              className="mb-6 shadow-[0_20px_45px_-30px_rgba(15,17,28,0.25)]" 
            />
          ) : (
            <ModelEmptyState 
              onSync={handleSync} 
              isSyncing={isSyncing} 
              onQuickAdd={() => setQuickAddOpen(true)}
            />
          )}

          {/* Inline Inspector (Overlay/Slide-in) */}
          <AnimatePresence>
            {selectedModel && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedModelId(null)}
                  className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[60]"
                />
                <motion.div
                  initial={{ x: "100%", opacity: 0.5 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: "100%", opacity: 0.5 }}
                  transition={{ type: "spring", damping: 28, stiffness: 220 }}
                  className="fixed inset-y-0 right-0 w-[520px] z-[70] bg-[var(--window-bg)] border-l border-[var(--hairline-strong)] shadow-[-20px_0_50px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden"
                >
                  <div className="flex-none flex items-center justify-between px-6 h-[72px] border-b border-[var(--hairline)] bg-[var(--window-bg)]">
                    <div className="flex items-center gap-4 truncate">
                      <div className="size-10 rounded-2xl bg-[var(--accent-soft)] flex items-center justify-center border border-[var(--accent-border)] shadow-sm">
                         <Zap className="size-5 text-[var(--accent-strong)]" />
                      </div>
                      <div className="flex flex-col truncate">
                        <span className="ws-pane-title text-[16px] truncate leading-tight">{selectedModel.display_name}</span>
                        <span className="ws-num text-[11px] opacity-40 uppercase tracking-widest">{selectedModel.id}</span>
                      </div>
                    </div>
                    <button onClick={() => setSelectedModelId(null)} className="p-2 hover:bg-black/5 rounded-xl transition-all active:scale-90">
                      <X className="size-5 text-[var(--ink-3)]" />
                    </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <ModelConfigPanel
                      model={selectedModel}
                      showChatContentCompatibility={supportsOpenAiCompatibleChatContentConfig}
                      onSave={handleSaveConfig}
                    />
                  </div>
                  
                  <div className="flex-none p-6 border-t border-[var(--hairline)] bg-[var(--panel-bg-inset)]/40 flex justify-end gap-3 backdrop-blur-md">
                     <button 
                        onClick={() => setSelectedModelId(null)}
                        className="ws-control h-10 px-6 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)] !text-[var(--ink-2)] font-bold text-[12px] hover:bg-[var(--panel-bg-inset)] transition-all"
                     >
                        {t("actions.dismiss").toUpperCase()}
                     </button>
                     <button 
                        onClick={() => handleTestModel(selectedModel)}
                        className="ws-control h-10 px-8 rounded-xl bg-[var(--accent-strong)] !text-[var(--accent-contrast)] font-bold text-[12px] shadow-lg shadow-[var(--accent-soft)] hover:brightness-110 active:scale-95 transition-all"
                     >
                        {t("actions.initiateTest").toUpperCase()}
                     </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Drawers and Dialogs */}
      <TestDrawer 
        isOpen={!!testModel}
        onClose={() => setTestModel(null)}
        model={testModel}
        instanceName={instance?.name || ""}
        onSendMessage={handleSendTestMessage}
      />

      {instance && (
        <ConnectProviderDrawer
          isOpen={editDrawerOpen}
          onClose={() => setEditDrawerOpen(false)}
          mode="edit"
          instanceId={instanceId}
          preset={{
            slug: instance.preset_slug || "",
            name: instance.preset_slug || "",
            type: "custom",
            protocol: instance.protocol || "openai",
            brand_color: instance.theme_color || "var(--accent-strong)",
            icon_key: instance.icon || "lucide:box",
          }}
          initialValues={{
            name: instance.name,
            description: instance.description || "",
            base_url: instance.base_url,
            is_enabled: instance.is_enabled,
            icon: instance.icon,
            theme_color: instance.theme_color,
            protocol: instance.protocol || undefined,
            auto_append_v1: instance.auto_append_v1 ?? undefined,
            has_credentials: instance.has_credentials ?? undefined,
          }}
          onSave={async () => {
            await Promise.all([mutateInstance(), mutateModels()])
            setEditDrawerOpen(false)
          }}
        />
      )}

      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="max-w-lg ws-bezel-inner border-[var(--hairline-strong)] shadow-2xl">
          <DialogHeader>
            <DialogTitle className="ws-view-title">{t("quickAdd.title")}</DialogTitle>
            <DialogDescription className="ws-body text-xs opacity-60 leading-relaxed">{t("quickAdd.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Textarea
              rows={8}
              value={quickAddInput}
              onChange={(e) => setQuickAddInput(e.target.value)}
              placeholder={t("quickAdd.placeholder")}
              className="ws-num border-[var(--hairline)] bg-[var(--panel-bg-inset)] font-bold text-[13px] rounded-xl focus:ring-[var(--accent-soft)]"
            />
          </div>
          <DialogFooter className="gap-3">
            <button 
              onClick={() => setQuickAddOpen(false)} 
              disabled={quickAddLoading}
              className="ws-control h-10 px-6 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)] font-bold text-[12px] hover:bg-[var(--panel-bg-inset)] transition-all"
            >
              {t("quickAdd.cancel").toUpperCase()}
            </button>
            <button 
              onClick={handleQuickAddSubmit} 
              disabled={quickAddLoading}
              className="ws-control h-10 px-8 rounded-xl bg-[var(--accent-strong)] text-white font-bold text-[12px] shadow-lg shadow-[var(--accent-soft)] hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all"
            >
              {quickAddLoading ? t("quickAdd.submitting").toUpperCase() : t("quickAdd.submit").toUpperCase()}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm ws-bezel-inner border-[var(--hairline-strong)] shadow-2xl">
          <DialogHeader>
            <DialogTitle className="ws-view-title">{t("deleteProvider.title")}</DialogTitle>
            <DialogDescription className="ws-body text-xs opacity-60 leading-relaxed">
              {t("deleteProvider.description", { name: instance?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 mt-4">
            <button 
              onClick={() => setDeleteDialogOpen(false)} 
              disabled={isDeleting}
              className="ws-control h-10 px-6 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)] font-bold text-[12px] hover:bg-[var(--panel-bg-inset)] transition-all"
            >
              {t("deleteProvider.cancel").toUpperCase()}
            </button>
            <button 
              onClick={handleDeleteInstance} 
              disabled={isDeleting}
              className="ws-control h-10 px-8 rounded-xl bg-[var(--danger)] text-white font-bold text-[12px] shadow-lg shadow-[var(--danger-soft)] hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all"
            >
              {isDeleting ? t("deleteProvider.deleting").toUpperCase() : t("deleteProvider.confirm").toUpperCase()}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
