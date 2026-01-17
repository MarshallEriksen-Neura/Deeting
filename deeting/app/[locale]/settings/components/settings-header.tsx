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
      className="mb-6 border border-white/40 bg-white/80 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]"
    >
      <GlassCardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <GlassCardTitle className="text-2xl font-semibold text-slate-900">
              {t("title")}
            </GlassCardTitle>
            <GlassCardDescription className="text-sm text-slate-600">
              {t("subtitle")}
            </GlassCardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{t("env.currentLabel")}</span>
            <Badge
              variant="secondary"
              className="gap-1 bg-slate-100 text-slate-700"
            >
              {isTauri ? <Monitor className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
              {isTauri ? t("env.desktop") : t("env.web")}
            </Badge>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardContent className="mt-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>{t("role.currentLabel")}</span>
          <Badge
            variant="secondary"
            className="gap-1 bg-slate-100 text-slate-700"
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