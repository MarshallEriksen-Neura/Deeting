"use client"

import { useTranslations } from "next-intl"
import { Server, Activity } from "lucide-react"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { cn } from "@/lib/utils"
import { useProviderHealth } from "@/lib/swr/use-provider-health"

/**
 * Provider Health Status Component
 *
 * Lists upstream model providers with:
 * - Health status indicator (🟢 Active, 🔴 Down, 🟡 Degraded)
 * - Current routing priority/weight
 * - Latency sparkline
 */
export function ProviderHealthStatus() {
  const t = useTranslations("dashboard.providerHealth")
  const { data: providers, isLoading } = useProviderHealth()

  return (
    <GlassCard className="h-full">
      <GlassCardHeader>
        <GlassCardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-[var(--primary)]" />
          {t("title")}
        </GlassCardTitle>
        <GlassCardDescription className="mt-1">
          {t("description")}
        </GlassCardDescription>
      </GlassCardHeader>
      <GlassCardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-[var(--foreground)]/5"
              />
            ))}
          </div>
        ) : providers && providers.length > 0 ? (
          <div className="space-y-2">
            {providers.map((provider) => (
              <ProviderRow key={provider.id} provider={provider} />
            ))}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-[var(--muted)]">
            {t("noProviders")}
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  )
}

interface Provider {
  id: string
  name: string
  status: "active" | "down" | "degraded"
  priority: number
  latency: number
  sparkline?: number[]
}

function ProviderRow({ provider }: { provider: Provider }) {
  const t = useTranslations("dashboard.providerHealth")

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-lg border border-[var(--border)]/50 p-3 transition-all",
        "hover:border-[var(--border)] hover:bg-[var(--muted)]/5"
      )}
    >
      {/* Status Indicator */}
      <div className="flex-shrink-0">
        <StatusBadge status={provider.status} />
      </div>

      {/* Provider Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-[var(--foreground)]">
            {provider.name}
          </span>
          <span className="text-xs text-[var(--muted)]">
            {t("priority")}: {provider.priority}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
          <Activity className="h-3 w-3" />
          <span>
            {provider.latency}ms {t("latency")}
          </span>
        </div>
      </div>

      {/* Sparkline */}
      {provider.sparkline && provider.sparkline.length > 0 && (
        <div className="flex-shrink-0">
          <MiniSparkline data={provider.sparkline} status={provider.status} />
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: Provider["status"] }) {
  const statusConfig = {
    active: {
      icon: "🟢",
      label: "Active",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    down: {
      icon: "🔴",
      label: "Down",
      color: "text-red-400",
      bg: "bg-red-500/10",
    },
    degraded: {
      icon: "🟡",
      label: "Degraded",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
  }

  const config = statusConfig[status]

  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-lg",
        config.bg
      )}
    >
      <span className="text-lg">{config.icon}</span>
    </div>
  )
}

function MiniSparkline({
  data,
  status,
}: {
  data: number[]
  status: Provider["status"]
}) {
  if (data.length === 0) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 60
      const y = 20 - ((value - min) / range) * 20
      return `${x},${y}`
    })
    .join(" ")

  const color =
    status === "active"
      ? "text-emerald-400"
      : status === "degraded"
        ? "text-amber-400"
        : "text-red-400"

  return (
    <svg
      className="h-8 w-16"
      viewBox="0 0 60 20"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={color}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
