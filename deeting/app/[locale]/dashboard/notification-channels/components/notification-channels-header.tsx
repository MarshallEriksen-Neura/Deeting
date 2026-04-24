"use client"

import { useTranslations } from "next-intl"
import { Bell, Plus, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"

export function NotificationChannelsHeader({
  stats,
  onRefresh,
  onCreate,
}: {
  stats: {
    total: number
    active: number
    runtimeReady: number
    available: number
  }
  onRefresh: () => void
  onCreate: () => void
}) {
  const t = useTranslations("monitoring")

  return (
    <section className="border-b border-[color:var(--border)] bg-[color:var(--card)]">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between px-6 py-8 md:px-10">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-[#E61919]">
              [ {t("notificationChannels.header.eyebrow")} ]
            </span>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-black uppercase tracking-tight text-foreground md:text-4xl" style={{ lineHeight: 0.9, letterSpacing: '-0.04em' }}>
              {t("notificationChannels.header.title")}
            </h1>
            <p className="max-w-2xl font-mono text-[11px] uppercase leading-relaxed tracking-wider text-muted-foreground">
              {t("notificationChannels.header.description")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              variant="ios-primary"
              size="sm"
              onClick={onCreate}
              className="h-9 px-5 font-medium shadow-none"
            >
              <Plus className="mr-2 size-4" />
              {t("notificationChannels.header.actions.create")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-9 border-[color:var(--border)] bg-transparent px-4 font-medium transition-colors hover:bg-muted"
            >
              <RefreshCw className="mr-2 size-3.5" />
              {t("notificationChannels.header.actions.refresh")}
            </Button>
          </div>
        </div>

        <div className="grid shrink-0 gap-px overflow-hidden border border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-2 lg:grid-cols-4">
          <HeroMetric label={t("notificationChannels.header.metrics.total")} value={String(stats.total)} />
          <HeroMetric label={t("notificationChannels.header.metrics.active")} value={String(stats.active)} />
          <HeroMetric label={t("notificationChannels.header.metrics.runtimeReady")} value={String(stats.runtimeReady)} />
          <HeroMetric label={t("notificationChannels.header.metrics.available")} value={String(stats.available)} />
        </div>
      </div>
    </section>
  )
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative bg-[color:var(--card)] p-4 min-w-[140px]">
      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-3xl font-black tracking-tighter text-foreground" style={{ lineHeight: 0.9 }}>{value}</div>
    </div>
  )
}
