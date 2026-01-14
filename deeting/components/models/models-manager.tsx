"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { RefreshCw, AlertCircle, Sparkles } from "lucide-react"

import { useProviderModels, useSyncProviderModels, useProviderInstances, useUpdateProviderModel, useTestProviderModel, useQuickAddProviderModels } from "@/hooks/use-providers"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { ModelEmptyState } from "./empty-state"
import { InstanceDashboard } from "./instance-dashboard"
import { TestDrawer } from "./test-drawer"
import type { ProviderModelResponse, ProviderModelUpdate } from "@/lib/api/providers"
import type { ProviderModel, ModelCapability } from "./types"
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

  // State
  const [isSyncing, setIsSyncing] = React.useState(false)
  const [testModel, setTestModel] = React.useState<ProviderModel | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false)
  const [quickAddOpen, setQuickAddOpen] = React.useState(false)
  const [quickAddInput, setQuickAddInput] = React.useState("")
  const [quickAddLoading, setQuickAddLoading] = React.useState(false)
  
  // Derived Data
  const instance = React.useMemo<import("./types").ProviderInstance | undefined>(
    () => {
      const raw = instances.find(i => i.id === instanceId)
      if (!raw) return undefined
      return {
        ...raw,
        provider_display_name: raw.preset_slug, // 使用 slug 作为显示名称兜底
        status: (raw.health_status as any) || "offline",
        latency: raw.latency_ms,
        model_count: typeof raw.model_count === "number" ? raw.model_count : 0,
        last_synced_at: raw.updated_at,
        theme_color: raw.theme_color || undefined,
        description: raw.description || undefined,
        icon: raw.icon || undefined
      }
    },
    [instances, instanceId]
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
      const capabilitiesFromRouting = Array.isArray(routingConfig.capabilities)
        ? routingConfig.capabilities
        : []
      const capabilitiesFromMeta = Array.isArray(extraMeta.upstream_capabilities)
        ? extraMeta.upstream_capabilities
        : []
      const capabilities: ModelCapability[] =
        capabilitiesFromRouting.length > 0
          ? (capabilitiesFromRouting as ModelCapability[])
          : capabilitiesFromMeta.length > 0
            ? (capabilitiesFromMeta as ModelCapability[])
            : m.capability
              ? [m.capability as ModelCapability]
              : ["chat"]

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
        weight: toNumber(m.weight, 0),
        priority: toNumber(m.priority, 0),
        updated_at: m.updated_at || m.synced_at || "",
        created_at: m.created_at || undefined,
        family: typeof rawMeta.owned_by === 'string' ? rawMeta.owned_by : undefined,
        version: m.unified_model_id || undefined,
        max_output_tokens: typeof limitConfig.max_output_tokens === 'number' ? limitConfig.max_output_tokens : undefined,
        rpm: typeof limitConfig.rpm === 'number' ? limitConfig.rpm : undefined,
        tpm: typeof limitConfig.tpm === 'number' ? limitConfig.tpm : undefined,
        supports_functions: !!rawMeta.supports_functions,
        supports_json_mode: !!rawMeta.supports_json_mode,
        deprecated_at: typeof rawMeta.deprecated_at === 'string' ? rawMeta.deprecated_at : undefined,
      }
    },
    [toNumber]
  )

  const normalizedModels = React.useMemo<ProviderModel[]>(
    () => (models || []).map(normalizeModel),
    [models, normalizeModel]
  )

  const handleToggleActive = React.useCallback(async (model: ProviderModel, active: boolean) => {
    try {
      await updateModel(model.uuid, { is_active: active })
      await mutateModels()
      toast.success(t("toast.updateSuccess"))
    } catch (err) {
      toast.error(t("toast.updateFailed"))
    }
  }, [updateModel, mutateModels, t])

  const handleUpdateAlias = React.useCallback(async (model: ProviderModel, alias: string) => {
    try {
      await updateModel(model.uuid, { display_name: alias })
      await mutateModels()
      toast.success(t("toast.updateSuccess"))
    } catch (err) {
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
    } catch (err) {
      toast.error(t("toast.syncFailed"))
    } finally {
      setIsSyncing(false)
    }
  }

  const handleTestModel = (model: ProviderModel) => {
    setTestModel(model)
  }

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
    } catch (err) {
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

      {/* Models Matrix or Empty State */}
      {normalizedModels.length > 0 ? (
        <ModelAccordion
          models={normalizedModels}
          onTest={handleTestModel}
          onToggleActive={handleToggleActive}
          onUpdateAlias={handleUpdateAlias}
          onSave={handleSaveConfig}
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
            protocol: "openai", // Need to derive
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
