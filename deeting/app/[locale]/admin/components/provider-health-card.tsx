"use client"

import { useLocale, useTranslations } from "next-intl"
import { Sparkline } from "@/components/admin"
import { GlassCard } from "@/components/ui/glass-card"
import { AdminStatusBadge, getStatusTone } from "@/components/admin"

interface ProviderHealthData {
  id: string
  name: string
  status: string
  latency: number
  sparkline?: number[]
}

interface ProviderHealthCardProps {
  /**
   * 提供商健康数据
   */
  providers: ProviderHealthData[]
}

const statusColorMap: Record<string, string> = {
  active: "rgb(52, 211, 153)",
  up: "rgb(52, 211, 153)",
  degraded: "rgb(251, 191, 36)",
  down: "rgb(248, 113, 113)",
}

export function ProviderHealthCard({ providers }: ProviderHealthCardProps) {
  const t = useTranslations("admin.dashboard")
  const locale = useLocale()
  const statusLabelMap: Record<string, string> = {
    active: t("providerHealth.status.active"),
    up: t("providerHealth.status.up"),
    degraded: t("providerHealth.status.degraded"),
    down: t("providerHealth.status.down"),
  }

  return (
    <GlassCard padding="default" hover="none" className="lg:col-span-2">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          {t("providerHealth.title")}
        </h3>
        <span className="text-xs text-[var(--muted)]">{t("providerHealth.realtime")}</span>
      </div>
      <div className="space-y-3">
        {(providers ?? []).map((provider) => (
          <div
            key={provider.id}
            className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2.5"
          >
            <div className="flex items-center gap-3">
              <span
                className="size-2 rounded-full"
                style={{
                  backgroundColor: statusColorMap[provider.status] ?? "rgb(148, 163, 184)",
                }}
              />
              <span className="text-sm font-medium text-[var(--foreground)]">
                {provider.name}
              </span>
              <AdminStatusBadge
                text={statusLabelMap[provider.status.toLowerCase()] ?? provider.status}
                tone={getStatusTone(provider.status)}
                dot={false}
              />
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-[var(--muted)]">
                {provider.latency > 0
                  ? t("providerHealth.latencyMs", {
                      value: new Intl.NumberFormat(locale).format(provider.latency),
                    })
                  : "—"}
              </span>
              <Sparkline
                data={provider.sparkline ?? []}
                color={statusColorMap[provider.status] ?? "rgb(148, 163, 184)"}
                width={80}
                height={24}
              />
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

export default ProviderHealthCard
