"use client"

import { useTranslations } from "next-intl"
import { Download, Bell, Settings, TrendingUp } from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"

export function QuickActionsCard() {
  const t = useTranslations("credits")

  const actions = [
    {
      icon: Download,
      label: t("actions.export"),
      onClick: () => console.log("Export CSV"),
      variant: "default" as const,
    },
    {
      icon: Bell,
      label: t("actions.alerts"),
      onClick: () => console.log("Configure Alerts"),
      variant: "outline" as const,
    },
    {
      icon: Settings,
      label: t("actions.settings"),
      onClick: () => console.log("Settings"),
      variant: "outline" as const,
    },
  ]

  return (
    <GlassCard blur="lg" theme="default" hover="none" className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {t("actions.title")}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            {t("actions.subtitle")}
          </p>
        </div>

        {/* Quick Actions */}
        <div className="space-y-3">
          {actions.map((action, index) => {
            const Icon = action.icon
            return (
              <Button
                key={index}
                variant={action.variant}
                size="sm"
                className="w-full justify-start gap-3 h-11"
                onClick={action.onClick}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{action.label}</span>
              </Button>
            )
          })}
        </div>

        {/* Recent Alert */}
        <div className="pt-4 border-t border-[var(--muted)]/10">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <TrendingUp className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--foreground)]">
                {t("actions.alert.title")}
              </p>
              <p className="text-xs text-[var(--muted)] mt-1">
                {t("actions.alert.message")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
