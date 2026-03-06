"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import {
  fetchAdminEmbeddingSetting,
  updateAdminEmbeddingSetting,
} from "@/lib/api/admin-dashboard"

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

  useEffect(() => {
    if (data?.model_name) {
      setSelected(data.model_name)
    }
  }, [data?.model_name])

  const handleSave = async () => {
    const nextModel = selected.trim()
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
      <GlassCard padding="default" hover="none" className="max-w-lg">
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
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--muted)]">{t("fields.newModelName")}</label>
            <Input
              type="text"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              placeholder={t("fields.placeholder")}
              className="font-mono"
            />
          </div>

          {feedback && <p className="text-xs text-[var(--muted)]">{feedback}</p>}
          {error && !feedback && <p className="text-xs text-rose-300">{t("feedback.loadFailed")}</p>}

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => void handleSave()}
              disabled={!selected.trim() || isSaving}
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
