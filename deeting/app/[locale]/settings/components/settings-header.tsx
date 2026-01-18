"use client"

import { Cloud, Monitor, ShieldCheck, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
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
    <GlassCard
      blur="sm"
      theme="surface"
      hover="none"
      padding="lg"
      className="mb-6 border border-white/10 bg-[var(--surface)]/70 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.4)]"
    >
      <GlassCardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <GlassCardTitle className="text-2xl font-semibold text-foreground">
              {t("title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-sm text-muted-foreground">
              {t("subtitle")}
            </GlassCardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("env.currentLabel")}</span>
            <Badge
              variant="secondary"
              className="gap-1"
            >
              {isTauri ? <Monitor className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
              {isTauri ? t("env.desktop") : t("env.web")}
            </Badge>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="mt-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{t("role.currentLabel")}</span>
          <Badge
            variant="secondary"
            className="gap-1"
          >
            {isAdmin ? (
              <ShieldCheck className="h-3 w-3" />
            ) : (
              <User className="h-3 w-3" />
            )}
            {roleLabel}
          </Badge>
          {isLoading && <span>{t("role.loading")}</span>}
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}
