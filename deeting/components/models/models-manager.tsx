"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { RefreshCw, AlertCircle } from "lucide-react"

import { useProviderModels, useSyncProviderModels, useProviderInstances, useUpdateProviderModel, useTestProviderModel } from "@/hooks/use-providers"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { ModelMatrix } from "./model-matrix"
import { ModelEmptyState } from "./empty-state"
import { InstanceDashboard } from "./instance-dashboard"
import { TestDrawer } from "./test-drawer"
import type { ProviderModelResponse } from "@/lib/api/providers"
import type { ProviderModel, ModelCapability } from "./types"
import { toast } from "sonner"
import ConnectProviderDrawer from "@/components/providers/connect-provider-drawer"

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

  // State
  const [isSyncing, setIsSyncing] = React.useState(false)
  const [testModel, setTestModel] = React.useState<ProviderModel | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false)
  
  // Derived Data
  const instance = React.useMemo(
    () => instances.find(i => i.id === instanceId),
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
      const capabilitiesFromMeta = Array.isArray(extraMeta.upstream_capabilities)
        ? extraMeta.upstream_capabilities
        : []
      const capabilities: ModelCapability[] =
        capabilitiesFromMeta.length > 0
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
        capabilities,
        context_window: contextWindow,
        pricing: {
          input: inputPrice,
          output: outputPrice,
        },
        is_active: m.is_active,
        updated_at: m.updated_at || m.synced_at || "",
        created_at: m.created_at || undefined,
        family: typeof rawMeta.owned_by === 'string' ? rawMeta.owned_by : undefined,
        version: m.unified_model_id || undefined,
        max_output_tokens: typeof limitConfig.max_output_tokens === 'number' ? limitConfig.max_output_tokens : undefined,
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

      {/* Models Matrix or Empty State */}
      {normalizedModels.length > 0 ? (
        <ModelMatrix
          models={normalizedModels}
          onTest={handleTestModel}
          onToggleActive={handleToggleActive}
          onUpdateAlias={handleUpdateAlias}
        />
      ) : (
        <ModelEmptyState 
          onSync={handleSync} 
          isSyncing={isSyncing} 
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
            slug: instance.preset_slug,
            name: instance.preset_slug, // This might need mapping back to display name if lost
            type: "custom", // Assuming custom for edit, or need to derive
            protocol: "openai", // Need to derive
            brand_color: instance.theme_color || "#3b82f6",
            icon_key: instance.icon || "lucide:box",
          }}
          initialValues={{
            name: instance.name,
            description: instance.description,
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
    </div>
  )
}
