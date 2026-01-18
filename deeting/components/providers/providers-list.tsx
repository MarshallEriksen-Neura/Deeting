"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { useProviderHub, useProviderInstances, useUpdateProviderInstance, useDeleteProviderInstance } from "@/hooks/use-providers"
import { ProviderHubResponse, ProviderInstanceResponse } from "@/lib/api/providers"
import ProviderInstanceRow from "./provider-instance-row"
import ConnectProviderDrawer from "./connect-provider-drawer"
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card"
import { Skeleton } from "@/components/ui/skeleton"
import { RefreshCw } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"

// ... (keep helper functions mapFromHub, mapFromInstanceOnly, buildItems)
const mapFromHub = (preset: ProviderHubResponse["providers"][number], inst: any) => ({
  id: inst.id as string,
  name: inst.name as string,
  presetName: preset.name,
  presetSlug: preset.slug,
  category: preset.category,
  icon: inst.icon || preset.icon,
  latency_ms: inst.latency_ms ?? 0,
  health_status: inst.health_status ?? "unknown",
  is_enabled: inst.is_enabled ?? true,
  models_count: inst.sparkline ? inst.sparkline.length : undefined,
  sparkline: inst.sparkline ?? [],
})

const mapFromInstanceOnly = (inst: ProviderInstanceResponse) => ({
  id: inst.id,
  name: inst.name,
  presetName: inst.preset_slug,
  presetSlug: inst.preset_slug,
  category: "custom",
  icon: inst.icon,
  latency_ms: inst.latency_ms ?? 0,
  health_status: inst.health_status ?? "unknown",
  is_enabled: inst.is_enabled ?? true,
  models_count: inst.sparkline ? inst.sparkline.length : undefined,
  sparkline: inst.sparkline ?? [],
})

function buildItems(hub?: ProviderHubResponse, instances: ProviderInstanceResponse[] = []) {
  const result: Array<ReturnType<typeof mapFromHub>> = []
  const seen = new Set<string>()

  if (hub?.providers?.length) {
    for (const preset of hub.providers) {
      for (const inst of preset.instances || []) {
        const mapped = mapFromHub(preset, inst)
        result.push(mapped)
        seen.add(mapped.id)
      }
    }
  }

  for (const inst of instances) {
    if (seen.has(inst.id)) continue
    result.push(mapFromInstanceOnly(inst))
  }

  // 先按是否连接、再按延迟排序
  return result.sort((a, b) => {
    if (a.health_status === "healthy" && b.health_status !== "healthy") return -1
    if (a.health_status !== "healthy" && b.health_status === "healthy") return 1
    return (a.latency_ms || 0) - (b.latency_ms || 0)
  })
}

export function ProvidersList() {
  const router = useRouter()
  const t = useTranslations("providers.manager")
  
  // Data Fetching
  const { data, isLoading, isError, error, mutate } = useProviderHub({ include_public: true })
  const { instances, mutate: mutateInstances } = useProviderInstances({ include_public: true })
  
  // Mutations
  const { update } = useUpdateProviderInstance()
  const { remove } = useDeleteProviderInstance()
  
  // Local UI State
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)

  const items = React.useMemo(() => buildItems(data, instances), [data, instances])
  const editingItem = React.useMemo(() => items.find((i) => i.id === editing), [items, editing])
  const editingInstance = React.useMemo<ProviderInstanceResponse | undefined>(() => {
    if (!editing) return undefined
    return instances.find((i) => i.id === editing)
  }, [instances, editing])
  const isSystemPreset = React.useMemo(() => {
    if (editingInstance) {
      return !editingInstance.user_id
    }
    return !(editingItem?.category?.toLowerCase().includes("custom") ?? false)
  }, [editingInstance, editingItem?.category])

  const handleToggle = async (id: string, enabled: boolean) => {
    await update(id, { is_enabled: enabled })
    await Promise.all([mutate(), mutateInstances()])
  }

  const handleDelete = async (id: string) => {
    await remove(id)
    await Promise.all([mutate(), mutateInstances()])
  }

  const handleViewModels = (id: string) => {
    router.push(`/dashboard/user/providers/${id}/models`)
  }

  const handleRetry = () => {
    mutate()
    mutateInstances()
  }

  if (isLoading) {
    return <ProvidersSkeleton />
  }

  if (isError) {
    return (
      <GlassCard className="py-12 text-center">
        <GlassCardContent className="flex flex-col items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10">
            <RefreshCw className="size-5 text-red-500" />
          </div>
          <p className="text-sm text-[var(--muted)]">{error?.message || t("error")}</p>
          <GlassButton onClick={handleRetry} variant="secondary">
            <RefreshCw className="size-4" />
            Retry
          </GlassButton>
        </GlassCardContent>
      </GlassCard>
    )
  }

  if (!items.length) {
    return (
      <div className="py-12 text-center text-[var(--muted)]">
        {t("empty")}
      </div>
    )
  }

  return (
    <>
      <div className="grid w-full grid-cols-1 gap-4">
        {items.map((item, idx) => (
          <ProviderInstanceRow
            key={item.id}
            index={idx}
            data={item}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onViewModels={handleViewModels}
            onEdit={() => { setEditing(item.id); setDrawerOpen(true) }}
          />
        ))}
      </div>

      <ConnectProviderDrawer
        isOpen={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditing(null) }}
        preset={
          editingItem
            ? {
                slug: editingItem.presetSlug,
                name: editingItem.presetName,
                type: isSystemPreset ? "system" : "custom",
                protocol: "openai",
                brand_color: editingInstance?.theme_color || "#10a37f",
                icon_key: editingInstance?.icon || editingItem.icon || "lucide:server",
              }
            : null
        }
        mode="edit"
        instanceId={editingItem?.id}
        initialValues={
          editingItem
            ? {
                name: editingItem.name,
                base_url: editingInstance?.base_url || "",
                description: editingInstance?.description || "",
                is_enabled: editingInstance?.is_enabled ?? editingItem.is_enabled !== false,
                icon: editingInstance?.icon || editingItem.icon || null,
                theme_color: editingInstance?.theme_color || null,
                protocol: editingInstance?.protocol || undefined,
                auto_append_v1: editingInstance?.auto_append_v1 ?? undefined,
                has_credentials: editingInstance?.has_credentials ?? undefined,
              }
            : undefined
        }
        onSave={async () => {
          await Promise.all([mutate(), mutateInstances()])
        }}
      />
    </>
  )
}

function ProvidersSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <GlassCard key={i} className="p-4">
          <div className="flex items-center gap-4">
             <Skeleton className="size-10 rounded-xl" />
             <div className="space-y-2 flex-1">
               <Skeleton className="h-4 w-32" />
               <Skeleton className="h-3 w-48" />
             </div>
             <Skeleton className="h-8 w-20" />
          </div>
        </GlassCard>
      ))}
    </div>
  )
}
