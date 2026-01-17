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
        <Alert className="mb-6 border-0 bg-slate-50">
          <Lock className="h-4 w-4 text-slate-500" />
          <AlertTitle className="text-slate-800">
            {t("auth.requiredTitle")}
          </AlertTitle>
          <AlertDescription className="text-slate-600">
            <p>{t("auth.requiredDesc")}</p>
          </AlertDescription>
        </Alert>
      )}

      <Alert className="mb-6 border-0 bg-white/90 shadow-[0_4px_20px_-12px_rgba(37,99,235,0.2)]">
        <Cloud className="h-4 w-4 text-blue-500" />
        <AlertTitle className="text-slate-900">
          {t("alert.consistencyTitle")}
        </AlertTitle>
        <AlertDescription className="text-slate-600">
          <p>{t("alert.consistencyDesc")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>{t("alert.dimensionHint")}</span>
            <span>{t("alert.versionHint")}</span>
          </div>
        </AlertDescription>
      </Alert>
    </>
  )
}