"use client"

import {
  Crosshair,
  Activity,
  Pause,
  AlertTriangle,
  Coins,
} from "lucide-react"
import { GlassCard } from "@/components/ui/glass-card"
import { cn } from "@/lib/utils"
import type { MonitorStats } from "@/lib/api/monitors"

interface MonitorStatsRowProps {
  stats: MonitorStats | undefined
  isLoading: boolean
}

export function MonitorStatsRow({ stats, isLoading }: MonitorStatsRowProps) {
  const cards = [
    {
      id: "total",
      icon: Crosshair,
      iconBg: "bg-[var(--primary)]/10",
      iconColor: "text-[var(--primary)]",
      label: "寻猎任务",
      value: stats?.total_tasks ?? 0,
    },
    {
      id: "active",
      icon: Activity,
      iconBg: "bg-emerald-500/10",
      iconColor: "text-emerald-400",
      label: "运行中",
      value: stats?.active_tasks ?? 0,
    },
    {
      id: "paused",
      icon: Pause,
      iconBg: "bg-amber-500/10",
      iconColor: "text-amber-400",
      label: "已暂停",
      value: stats?.paused_tasks ?? 0,
    },
    {
      id: "tokens",
      icon: Coins,
      iconBg: "bg-teal-500/10",
      iconColor: "text-[var(--teal-accent)]",
      label: "累计 Token",
      value: stats ? formatTokens(stats.total_tokens) : "0",
    },
  ]

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, index) => (
        <GlassCard
          key={card.id}
          className={cn(
            "group relative overflow-visible transition-all duration-300",
            "hover:-translate-y-1 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.15)]",
            "animate-glass-card-in",
            `stagger-${index + 1}`
          )}
          padding="default"
        >
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                {card.label}
              </span>
              <span className="text-3xl font-bold text-[var(--foreground)] tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-9 w-20 animate-pulse rounded bg-[var(--foreground)]/10" />
                ) : (
                  card.value
                )}
              </span>
            </div>
            <div
              className={cn(
                "flex items-center justify-center rounded-xl p-2.5",
                card.iconBg
              )}
            >
              <card.icon className={cn("h-5 w-5", card.iconColor)} />
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
