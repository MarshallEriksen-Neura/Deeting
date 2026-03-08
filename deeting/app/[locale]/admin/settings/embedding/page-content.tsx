"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { Save } from "lucide-react"

import { ModelPicker, type ModelPickerGroup } from "@/components/models/model-picker"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import {
  fetchAdminEmbeddingSetting,
  updateAdminEmbeddingSetting,
} from "@/lib/api/admin-dashboard"
import { fetchChatModels } from "@/lib/api/models"

export function PageContent() {
  const t = useTranslations("admin.embeddingSettingsPage")
  const [selected, setSelected] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR("/api/v1/admin/settings/embedding", fetchAdminEmbeddingSetting)
  const {
    data: modelData,
    error: modelError,
    isLoading: isLoadingModels,
  } = useSWR("/api/v1/models?capability=embedding", () =>
    fetchChatModels({ capability: "embedding" })
  )

  useEffect(() => {
    setSelected(data?.model_name?.trim() ?? "")
  }, [data?.model_name])

  const availableModelGroups: ModelPickerGroup[] = (modelData?.instances ?? []).map((group) => ({
    instance_id: group.instance_id,
    instance_name: group.instance_name,
    provider: group.provider,
    models: group.models.map((model) => ({
      id: model.id,
      owned_by: model.owned_by,
      provider_model_id: model.provider_model_id ?? undefined,
      health_status: model.health_status ?? undefined,
      is_platform: model.is_platform,
      pricing: model.pricing ?? undefined,
    })),
  }))
  const selectedValue = selected.trim()
  const currentValue = data?.model_name?.trim() ?? ""
  const isCurrentValueListed = availableModelGroups.some((group) =>
    group.models.some((model) => {
      const modelValue = model.provider_model_id ?? model.id
      return modelValue === currentValue || model.id === currentValue
    })
  )
  const modelGroups: ModelPickerGroup[] =
    currentValue && !isCurrentValueListed
      ? [
          {
            instance_id: "__current__",
            instance_name: t("picker.currentGroup"),
            provider: t("fields.current"),
            models: [
              {
                id: currentValue,
                provider_model_id: currentValue,
              },
            ],
          },
          ...availableModelGroups,
        ]
      : availableModelGroups

  const handleSave = async () => {
    const nextModel = selectedValue
    if (!nextModel || isSaving) return

    setIsSaving(true)
    setFeedback(null)
    try {
      await updateAdminEmbeddingSetting(nextModel)
      await mutate()
      setFeedback(t("feedback.updated"))
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t("feedback.updateFailed")
      setFeedback(message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <GlassCard padding="default" hover="none" className="max-w-2xl">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("section.title")}</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {t("section.description")}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("fields.current")}</label>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <span className="font-mono text-sm text-[var(--foreground)]">
                {isLoading ? t("loading") : data?.model_name || "—"}
              </span>
            </div>
            {!isLoading && currentValue && !isCurrentValueListed ? (
              <p className="text-xs text-amber-300">{t("fields.currentUnlistedHint")}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("fields.newModelName")}</label>
            <ModelPicker
              value={selectedValue}
              onChange={setSelected}
              modelGroups={modelGroups}
              valueField="provider_model_id"
              title={t("picker.title")}
              subtitle={isLoadingModels ? t("picker.loading") : t("picker.subtitle")}
              searchPlaceholder={t("picker.searchPlaceholder")}
              emptyText={isLoadingModels ? t("picker.loading") : t("picker.empty")}
              noResultsText={t("picker.noResults")}
              disabled={isSaving || isLoadingModels}
              showHeader={false}
              scrollAreaClassName="h-80"
            />
          </div>

          {feedback && <p className="text-xs text-[var(--muted)]">{feedback}</p>}
          {error && !feedback && <p className="text-xs text-rose-300">{t("feedback.loadFailed")}</p>}
          {modelError && <p className="text-xs text-rose-300">{t("feedback.modelsLoadFailed")}</p>}

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => void handleSave()}
              disabled={!selectedValue || isSaving || selectedValue === currentValue}
              size="sm"
            >
              <Save className="size-3.5" />
              {isSaving ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>
        </div>
      </GlassCard>
    </>
  )
}
