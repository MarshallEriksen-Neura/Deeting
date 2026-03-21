"use client"

import { Cloud, Monitor, ShieldCheck, User } from "lucide-react"
import { useI18n } from "@/hooks/use-i18n"

interface SettingsHeaderProps {
  isTauri: boolean
  isAdmin: boolean
  roleLabel: string
  isLoading: boolean
}

export function SettingsHeader({ isTauri, isAdmin, roleLabel, isLoading }: SettingsHeaderProps) {
  const t = useI18n("settings")

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2.5 pb-0.5">
          <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50">
            {isTauri ? <Monitor className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
            <span>{isTauri ? t("env.desktop") : t("env.web")}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50">
            {isAdmin ? (
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            ) : (
              <User className="h-3.5 w-3.5" />
            )}
            <span>{isLoading ? t("role.loading") : roleLabel}</span>
          </div>
        </div>
      </div>
      <div className="mt-5 h-px bg-gradient-to-r from-primary/30 via-primary/8 to-transparent" />
    </div>
  )
}
