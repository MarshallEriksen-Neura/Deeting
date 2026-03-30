"use client"

import { Bot, CheckCircle2, RefreshCw, Sparkles } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
} from "@/components/ui/glass-card"

type AgentStats = {
  total: number
  enabled: number
  discoverable: number
  lastUpdated: string
}

type AgentStatsBarProps = {
  stats: AgentStats
  t: (key: string) => string
}

const statConfig = [
  { key: "total" as const, labelKey: "stats.total", icon: Bot, color: "text-[var(--primary)]", bg: "bg-[var(--primary)]/8" },
  { key: "enabled" as const, labelKey: "stats.enabled", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/8" },
  { key: "discoverable" as const, labelKey: "stats.discoverable", icon: Sparkles, color: "text-amber-300", bg: "bg-amber-500/8" },
  { key: "lastUpdated" as const, labelKey: "stats.updated", icon: RefreshCw, color: "text-blue-300", bg: "bg-blue-500/8" },
]

export function AgentStatsBar({ stats, t }: AgentStatsBarProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {statConfig.map((cfg) => {
        const Icon = cfg.icon
        const value = stats[cfg.key]
        return (
          <GlassCard
            key={cfg.key}
            hover="none"
            className="overflow-hidden border-white/6"
          >
            <GlassCardContent className="flex items-center gap-3.5">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
                <Icon className={`size-[18px] ${cfg.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]/70">
                  {t(cfg.labelKey)}
                </p>
                <p className="mt-0.5 truncate text-lg font-semibold leading-tight text-[var(--foreground)]">
                  {value}
                </p>
              </div>
            </GlassCardContent>
          </GlassCard>
        )
      })}
    </div>
  )
}
