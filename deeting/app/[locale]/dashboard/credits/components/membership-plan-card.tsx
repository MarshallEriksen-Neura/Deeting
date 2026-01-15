"use client"

import { useTranslations } from "next-intl"
import { Crown, Calendar } from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"

export function MembershipPlanCard() {
  const t = useTranslations("credits")

  // Mock data - replace with real API call
  const plan = {
    name: "Pro Plan",
    renewDate: "2026-02-14",
    usagePercent: 70,
  }

  return (
    <GlassCard
      blur="lg"
      theme="teal"
      hover="lift"
      className="relative overflow-hidden"
    >
      {/* Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--teal-accent)]/5 via-transparent to-transparent" />

      {/* Content */}
      <div className="relative z-10 p-6 space-y-4">
        {/* Header with Icon */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-[var(--teal-accent)]" />
              <h3 className="text-sm font-medium text-[var(--muted)]">
                {t("plan.title")}
              </h3>
            </div>
            <p className="text-2xl font-bold text-[var(--foreground)]">
              {plan.name}
            </p>
          </div>
        </div>

        {/* Renewal Date */}
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Calendar className="w-3 h-3" />
          <span>
            {t("plan.nextRenewal")}: {plan.renewDate}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--muted)]">{t("plan.monthlyQuota")}</span>
            <span className="font-mono font-medium text-[var(--foreground)]">
              {plan.usagePercent}%
            </span>
          </div>
          <div className="w-full h-2 bg-[var(--muted)]/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--teal-accent)] rounded-full transition-all duration-1000"
              style={{ width: `${plan.usagePercent}%` }}
            />
          </div>
        </div>

        {/* Upgrade Button */}
        <Button
          size="sm"
          variant="outline"
          className="w-full border-[var(--teal-accent)]/30 text-[var(--teal-accent)] hover:bg-[var(--teal-accent)]/10"
        >
          {t("plan.upgrade")}
        </Button>
      </div>
    </GlassCard>
  )
}
