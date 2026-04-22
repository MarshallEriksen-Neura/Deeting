"use client"

import { RotateCcw, Save } from "lucide-react"
import { GlassButton } from "@/ui/common/glass-button"
import { useI18n } from "@/hooks/use-i18n"

interface SettingsFormActionsProps {
  canSave: boolean
  isSaving: boolean
  isSubmitting: boolean
  onReset: () => void
}

export function SettingsFormActions({
  canSave,
  isSaving,
  isSubmitting,
  onReset
}: SettingsFormActionsProps) {
  const t = useI18n("settings")

  return (
    <div className="sticky bottom-4 z-10 mt-8">
      <div className="rounded-2xl border border-border/50 bg-background/90 px-5 py-3.5 shadow-lg backdrop-blur-xl dark:bg-background/80">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{t("actions.hint")}</span>
          <div className="flex gap-2">
            <GlassButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={onReset}
              disabled={isSaving}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("actions.reset")}
            </GlassButton>
            <GlassButton
              type="submit"
              variant="default"
              size="sm"
              disabled={!canSave || isSaving || isSubmitting}
              loading={isSaving}
              className="gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? t("actions.saving") : t("actions.save")}
            </GlassButton>
          </div>
        </div>
      </div>
    </div>
  )
}
