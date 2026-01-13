"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { GlassButton } from "@/components/ui/glass-button"
import { useProviderHub, useProviderInstances, useUpdateProviderInstance, useDeleteProviderInstance } from "@/hooks/use-providers"
import { ProviderHubResponse, ProviderInstanceResponse } from "@/lib/api/providers"
import ProviderInstanceRow from "./provider-instance-row"
import ConnectProviderDrawer from "./connect-provider-drawer"

function flattenHub(resp?: ProviderHubResponse) {
  if (!resp) return []
  const result: Array<ReturnType<typeof mapInstance>> = []
  for (const preset of resp.providers) {
    for (const inst of preset.instances || []) {
      result.push(mapInstance(preset, inst))
    }
  }
  // 先按是否连接、再按延迟排序
  return result.sort((a, b) => {
    if (a.health_status === "healthy" && b.health_status !== "healthy") return -1
    if (a.health_status !== "healthy" && b.health_status === "healthy") return 1
    return (a.latency_ms || 0) - (b.latency_ms || 0)
  })
}

const mapInstance = (preset: ProviderHubResponse["providers"][number], inst: any) => ({
  id: inst.id as string,
  name: inst.name as string,
  presetName: preset.name,
  presetSlug: preset.slug,
  category: preset.category,
  icon: preset.icon,
  latency_ms: inst.latency_ms ?? 0,
  health_status: inst.health_status ?? "unknown",
  is_enabled: inst.is_enabled ?? true,
  models_count: inst.sparkline ? inst.sparkline.length : undefined,
  sparkline: inst.sparkline ?? [],
})

export function ProvidersManager() {
  const router = useRouter()
  const t = useTranslations("providers.manager")
  const { data, isLoading, isError, error, mutate } = useProviderHub({ include_public: true })
  const { instances, mutate: mutateInstances } = useProviderInstances({ include_public: true })
  const { update } = useUpdateProviderInstance()
  const { remove } = useDeleteProviderInstance()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)

  const items = React.useMemo(() => flattenHub(data), [data])
  const editingItem = React.useMemo(() => items.find((i) => i.id === editing), [items, editing])
  const editingInstance = React.useMemo<ProviderInstanceResponse | undefined>(() => {
    if (!editing) return undefined
    return instances.find((i) => i.id === editing)
  }, [instances, editing])

  const handleToggle = async (id: string, enabled: boolean) => {
    await update(id, { is_enabled: enabled })
    await Promise.all([mutate(), mutateInstances()])
  }

  const handleDelete = async (id: string) => {
    await remove(id)
    await Promise.all([mutate(), mutateInstances()])
  }

  return (
    <div className="space-y-8 p-6 lg:p-10 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">
            {t("title")}
          </h1>
          <p className="text-[var(--muted)]">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <GlassButton 
            variant="outline" 
            onClick={() => router.push("/dashboard/user/providers/market")}
          >
            <Plus className="mr-2 size-4" />
            {t("connect")}
          </GlassButton>
        </div>
      </div>

      <div className="grid gap-4">
        {isLoading && <div className="text-sm text-[var(--muted)]">{t("loading")}</div>}
        {isError && <div className="text-sm text-red-400">{error?.message || t("error")}</div>}
        {!isLoading && !items.length && <div className="text-sm text-[var(--muted)]">{t("empty")}</div>}
        {items.map((item, idx) => (
          <ProviderInstanceRow
            key={item.id}
            index={idx}
            data={item}
            onToggle={handleToggle}
            onDelete={handleDelete}
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
                type: "system",
                protocol: "openai",
                brand_color: "#10a37f",
                icon_key: editingItem.icon || "lucide:server",
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
              }
            : undefined
        }
        onSave={async () => {
          await Promise.all([mutate(), mutateInstances()])
        }}
      />
    </div>
  )
}
