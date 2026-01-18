"use client"

import { GlassButton } from "@/components/ui/glass-button"
import { Separator } from "@/components/ui/separator"
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
    <>
      <Separator className="bg-border/60" />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">{t("actions.hint")}</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <GlassButton
            type="button"
            variant="secondary"
            onClick={onReset}
            disabled={isSaving}
          >
            {t("actions.reset")}
          </GlassButton>
          <GlassButton
            type="submit"
            variant="default"
            disabled={!canSave || isSaving || isSubmitting}
            loading={isSaving}
          >
            {isSaving ? t("actions.saving") : t("actions.save")}
          </GlassButton>
        </div>
      </div>
    </>
  )
}
