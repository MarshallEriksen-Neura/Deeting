"use client"

import { Cloud, Lock } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useI18n } from "@/hooks/use-i18n"

interface SettingsAlertsProps {
  isAuthenticated: boolean
}

export function SettingsAlerts({ isAuthenticated }: SettingsAlertsProps) {
  const t = useI18n("settings")

  return (
    <>
      {!isAuthenticated && (
        <Alert className="mb-6 border border-white/10 bg-[var(--surface)]/70">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <AlertTitle className="text-foreground">
            {t("auth.requiredTitle")}
          </AlertTitle>
          <AlertDescription className="text-muted-foreground">
            <p>{t("auth.requiredDesc")}</p>
          </AlertDescription>
        </Alert>
      )}

      <Alert className="mb-6 border border-white/10 bg-[var(--surface)]/70 shadow-[0_4px_20px_-12px_rgba(124,109,255,0.25)]">
        <Cloud className="h-4 w-4 text-primary" />
        <AlertTitle className="text-foreground">
          {t("alert.consistencyTitle")}
        </AlertTitle>
        <AlertDescription className="text-muted-foreground">
          <p>{t("alert.consistencyDesc")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{t("alert.dimensionHint")}</span>
            <span>{t("alert.versionHint")}</span>
          </div>
        </AlertDescription>
      </Alert>
    </>
  )
}
