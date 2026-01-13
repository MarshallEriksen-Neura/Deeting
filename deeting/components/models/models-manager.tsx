"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { ArrowLeft, RefreshCw, AlertCircle, Settings2, Trash2 } from "lucide-react"

import { useProviderModels, useSyncProviderModels, useProviderInstances, useDeleteProviderInstance, useUpdateProviderInstance } from "@/hooks/use-providers"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
import { ModelMatrix } from "./model-matrix"
import { ModelEmptyState } from "./empty-state"
import { InstanceDashboard } from "./instance-dashboard"
import { TestDrawer } from "./test-drawer"
import type { ProviderModelResponse } from "@/lib/api/providers"
import { toast } from "sonner"
import ConnectProviderDrawer, { ProviderPresetConfig } from "@/components/providers/connect-provider-drawer"

interface ModelsManagerProps {
  instanceId: string
}

export function ModelsManager({ instanceId }: ModelsManagerProps) {
  const router = useRouter()
  const t = useTranslations("models")
  
  // Data Fetching
  const { instances, mutate: mutateInstance } = useProviderInstances()
  const { models, isLoading, isError, error, mutate: mutateModels } = useProviderModels(instanceId)
  
  // Actions
  const { sync } = useSyncProviderModels()
  const { remove: deleteInstance } = useDeleteProviderInstance()
  const { update: updateInstance } = useUpdateProviderInstance()

  // State
  const [isSyncing, setIsSyncing] = React.useState(false)
  const [testModel, setTestModel] = React.useState<ProviderModelResponse | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false)
  
  // Derived Data
  const instance = React.useMemo(
    () => instances.find(i => i.id === instanceId),
    [instances, instanceId]
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

  const handleDeleteInstance = async () => {
    if (confirm(t("confirmDelete"))) {
      await deleteInstance(instanceId)
      router.push("/dashboard/user/providers")
    }
  }

  const handleTestModel = (model: ProviderModelResponse) => {
    setTestModel(model)
  }

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
          modelCount={models.length}
          onSync={handleSync}
          isSyncing={isSyncing}
          onEdit={() => setEditDrawerOpen(true)}
          onDelete={handleDeleteInstance}
        />
      )}

      {/* Models Matrix or Empty State */}
      {models.length > 0 ? (
        <ModelMatrix 
          models={models} 
          onTest={handleTestModel}
          onRefresh={mutateModels}
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
        providerName={instance?.name}
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
