"use client"

import { Lock } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"

interface SettingsAlertsProps {
  isAuthenticated: boolean
  isTauriRuntime: boolean
}

export function SettingsAlerts({
  isAuthenticated,
  isTauriRuntime,
}: SettingsAlertsProps) {
  const t = useI18n("settings")

  if (isAuthenticated || isTauriRuntime) return null

  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3.5 dark:border-amber-400/15 dark:bg-amber-400/[0.06]">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 dark:bg-amber-400/10">
        <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">
          {t("auth.requiredTitle")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("auth.requiredDesc")}
        </p>
      </div>
    </div>
  )
}
