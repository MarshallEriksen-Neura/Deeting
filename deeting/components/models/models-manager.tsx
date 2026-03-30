"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { RefreshCw, AlertCircle, Sparkles } from "lucide-react"

import { useProviderModels, useSyncProviderModels, useProviderInstances, useUpdateProviderModel, useTestProviderModel, useQuickAddProviderModels, useProviderModelPurchase } from "@/hooks/use-providers"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
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
import ConnectProviderDrawer from "@/components/providers/connect-provider-drawer"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

const ModelAccordion = dynamic(
  () => import("./model-accordion").then((m) => m.ModelAccordion),
  { ssr: false }
)

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

export function ModelsManager({ instanceId }: ModelsManagerProps) {
  const t = useTranslations("models")
  
  // Data Fetching
  const { instances, mutate: mutateInstance } = useProviderInstances()
  const { models, isLoading, isError, error, mutate: mutateModels } = useProviderModels(instanceId)
  
  // Actions
  const { sync } = useSyncProviderModels()
  const { update: updateModel } = useUpdateProviderModel()
  const { test: testModelApi } = useTestProviderModel()
  const { quickAdd } = useQuickAddProviderModels()
  const { purchase: purchaseModel } = useProviderModelPurchase()

  // State
  const [isSyncing, setIsSyncing] = React.useState(false)
  const [testModel, setTestModel] = React.useState<ProviderModel | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false)
  const [quickAddOpen, setQuickAddOpen] = React.useState(false)
  const [quickAddInput, setQuickAddInput] = React.useState("")
  const [quickAddLoading, setQuickAddLoading] = React.useState(false)
  const [purchasingModelUuid, setPurchasingModelUuid] = React.useState<string | null>(null)
  const [filters, setFilters] = React.useState<ModelFilterState>({
    search: "",
    capabilities: [],
    min_context_window: null,
    active_only: false,
    price_tier: null,
  })

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
        provider_display_name: raw.preset_slug, // 使用 slug 作为显示名称兜底
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

  // Normalization helpers to provide UI-ready safe defaults
  const toNumber = React.useCallback((v: unknown, fallback = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }, [])

  const normalizeModel = React.useCallback(
    (m: ProviderModelResponse): ProviderModel => {
      const pricing = (m.pricing_config || {}) as Record<string, unknown>
      const inputPrice = toNumber(
        pricing.input_per_1k ?? pricing.input ?? pricing.input_price,
        0
      )
      const outputPrice = toNumber(
        pricing.output_per_1k ?? pricing.output ?? pricing.output_price,
        0
      )

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

      const contextWindow = toNumber(
        // Prefer tokenizer_config if provided, otherwise look into meta
        tokenizerConfig.context_window ??
          extraMeta.context_window ??
          rawMeta.context_window,
        0
      )

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
        pricing: {
          input: inputPrice,
          output: outputPrice,
        },
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
        max_input_images:
          typeof routingConfig.max_input_images === 'number'
            ? routingConfig.max_input_images
            : undefined,
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
    return result
  }, [normalizedModels, filters])

  const handleBatchUpdateCapabilities = React.useCallback(
    async (capabilities: import("./types").ModelCapability[]) => {
      try {
        await Promise.all(
          filteredModels.map((m) =>
            updateModel(m.uuid, {
              routing_config: { capabilities },
            })
          )
        )
        await mutateModels()
        toast.success(t("filter.batchSuccess", { count: filteredModels.length }))
      } catch {
        toast.error(t("filter.batchFailed"))
      }
    },
    [filteredModels, updateModel, mutateModels, t]
  )

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

  const parseModelsInput = React.useCallback((value: string) => {
    return value
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }, [])

  const handleQuickAddSubmit = async () => {
    const modelsInput = parseModelsInput(quickAddInput)
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

  const handleSendTestMessage = React.useCallback(async (message: string) => {
    if (!testModel) return {
      id: "error",
      role: "assistant" as const,
      content: "No model selected",
      timestamp: new Date().toISOString()
    }

    try {
      const res = await testModelApi(testModel.uuid, { prompt: message })
      
      if (!res.success) {
        throw new Error(res.error || "Unknown error")
      }

      return {
        id: `resp-${Date.now()}`,
        role: "assistant" as const,
        content: res.response_body ? JSON.stringify(res.response_body, null, 2) : (res.error || "Success"),
        timestamp: new Date().toISOString(),
        latency: res.latency_ms,
      }
    } catch (err: unknown) {
      return {
        id: `error-${Date.now()}`,
        role: "assistant" as const,
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      }
    }
  }, [testModel, testModelApi])

  // Loading State
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 bg-[var(--surface)]/30 rounded-2xl" />
        <div className="h-64 bg-[var(--surface)]/30 rounded-2xl" />
      </div>
    )
  }

  // Error State
  if (isError) {
    return (
      <GlassCard className="p-8 flex flex-col items-center justify-center text-center gap-4 border-red-500/20 bg-red-500/5">
        <AlertCircle className="size-10 text-red-500" />
        <div>
          <h3 className="text-lg font-semibold text-red-500">{t("error.title")}</h3>
          <p className="text-sm text-[var(--muted)] max-w-md mt-1">
            {error?.message || t("error.unknown")}
          </p>
        </div>
        <GlassButton onClick={() => mutateModels()}>
          <RefreshCw className="size-4 mr-2" />
          {t("actions.retry")}
        </GlassButton>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-6">
      {/* Dashboard Stats */}
      {instance && (
        <InstanceDashboard 
          instance={instance} 
          syncState={{
            is_syncing: isSyncing,
            progress: isSyncing ? 20 : 0, // 简单占位进度；后端未提供时显示 0/20
            last_sync: instance.last_synced_at ?? null,
            error: null,
          }}
          onSync={handleSync}
          onSettings={() => setEditDrawerOpen(true)}
        />
      )}

      {/* Quick Add entry */}
      <GlassCard className="p-4 flex flex-wrap items-center justify-between gap-3 border-white/5 bg-[var(--surface)]/60">
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Sparkles className="size-4 text-[var(--primary)]" />
          <span>{t("quickAdd.subtitle")}</span>
        </div>
        <div className="flex items-center gap-2">
          <GlassButton onClick={() => setQuickAddOpen(true)} className="gap-2">
            <Sparkles className="size-4" />
            {t("quickAdd.cta")}
          </GlassButton>
        </div>
      </GlassCard>

      {/* Filter Lens */}
      {normalizedModels.length > 0 && (
        <FilterLens
          filters={filters}
          onFiltersChange={setFilters}
          totalModels={normalizedModels.length}
          filteredCount={filteredModels.length}
          onBatchUpdateCapabilities={handleBatchUpdateCapabilities}
        />
      )}

      {/* Models Matrix or Empty State */}
      {normalizedModels.length > 0 ? (
        <ModelAccordion
          models={filteredModels}
          onTest={handleTestModel}
          onToggleActive={handleToggleActive}
          onUpdateAlias={handleUpdateAlias}
          onSave={handleSaveConfig}
          onPurchase={handlePurchaseModel}
          readOnly={instance?.is_public === true}
          purchasingModelUuid={purchasingModelUuid}
        />
      ) : (
        <ModelEmptyState 
          onSync={handleSync} 
          isSyncing={isSyncing} 
          onQuickAdd={() => setQuickAddOpen(true)}
        />
      )}

      {/* Drawers */}
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
            name: instance.preset_slug || "", // This might need mapping back to display name if lost
            type: "custom", // Assuming custom for edit, or need to derive
            protocol: instance.protocol || "openai",
            brand_color: instance.theme_color || "#3b82f6",
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

      {/* Quick Add Dialog */}
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="max-w-lg bg-[var(--surface)]/80 border-white/10">
          <DialogHeader>
            <DialogTitle>{t("quickAdd.title")}</DialogTitle>
            <DialogDescription className="text-sm text-[var(--muted)]">
              {t("quickAdd.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Textarea
              rows={5}
              value={quickAddInput}
              onChange={(e) => setQuickAddInput(e.target.value)}
              placeholder={t("quickAdd.placeholder")}
              className="font-mono bg-black/20 border-white/10"
            />
            <div className="flex flex-wrap gap-2">
              {["gpt-4o", "claude-3.5-sonnet", "text-embedding-3-large", "deepseek-chat"].map((m) => (
                <Badge
                  key={m}
                  variant="outline"
                  className="cursor-pointer hover:bg-white/10"
                  onClick={() => setQuickAddInput((prev) => (prev ? `${prev.trim()}\n${m}` : m))}
                >
                  + {m}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-[var(--muted)]">
              {t("quickAdd.hint")}
            </p>
          </div>

          <DialogFooter className="gap-2">
            <GlassButton variant="ghost" onClick={() => setQuickAddOpen(false)} disabled={quickAddLoading}>
              {t("quickAdd.cancel")}
            </GlassButton>
            <GlassButton onClick={handleQuickAddSubmit} disabled={quickAddLoading}>
              {quickAddLoading ? t("quickAdd.submitting") : t("quickAdd.submit")}
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
