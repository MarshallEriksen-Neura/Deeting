"use client"

import { Lock } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useI18n } from "@/hooks/use-i18n"

interface SettingsAlertsProps {
  isAuthenticated: boolean
}

export function SettingsAlerts({ isAuthenticated }: SettingsAlertsProps) {
  const t = useI18n("settings")

  if (isAuthenticated) return null

  return (
    <Alert className="mb-6 border border-white/10 bg-[var(--surface)]/70">
      <Lock className="h-4 w-4 text-muted-foreground" />
      <AlertTitle className="text-foreground">
        {t("auth.requiredTitle")}
      </AlertTitle>
      <AlertDescription className="text-muted-foreground">
        <p>{t("auth.requiredDesc")}</p>
      </AlertDescription>
    </Alert>
  )
}
