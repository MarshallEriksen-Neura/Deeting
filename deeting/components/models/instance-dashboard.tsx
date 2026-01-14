"use client"

import * as React from "react"
import { motion } from "framer-motion"
import {
  RefreshCw,
  Settings,
  Cloud,
  Server,
  Cpu,
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import { GlassCard } from "@/components/ui/glass-card"
import { GlassButton } from "@/components/ui/glass-button"
import { Badge } from "@/components/ui/badge"
import type { ProviderInstance, ProviderStatus, SyncState } from "./types"

/**
 * InstanceDashboard - Layer A: Instance Control Console
 *
 * Displays the current Provider Instance's health status and metadata
 * with a frosted glass card featuring subtle brand color accents.
 */

interface InstanceDashboardProps {
  instance: ProviderInstance
  syncState?: SyncState
  onSync: () => void
  onSettings?: () => void
  className?: string
}

// Provider brand colors and icons
const PROVIDER_THEMES: Record<string, {
  color: string
  gradient: string
  icon: React.ReactNode
}> = {
  openai: {
    color: '#10a37f',
    gradient: 'from-emerald-500/20 via-transparent to-transparent',
    icon: <Cloud className="size-5" />,
  },
  anthropic: {
    color: '#d97706',
    gradient: 'from-amber-500/20 via-transparent to-transparent',
    icon: <Cloud className="size-5" />,
  },
  google: {
    color: '#4285f4',
    gradient: 'from-blue-500/20 via-transparent to-transparent',
    icon: <Cloud className="size-5" />,
  },
  ollama: {
    color: '#7c3aed',
    gradient: 'from-violet-500/20 via-transparent to-transparent',
    icon: <Server className="size-5" />,
  },
  azure: {
    color: '#0078d4',
    gradient: 'from-sky-500/20 via-transparent to-transparent',
    icon: <Cloud className="size-5" />,
  },
  default: {
    color: '#7c6dff',
    gradient: 'from-[var(--primary)]/20 via-transparent to-transparent',
    icon: <Cpu className="size-5" />,
  },
}

// Status indicator components
function StatusIndicator({ status, latency }: { status?: ProviderStatus; latency?: number }) {
  const t = useTranslations('models')
  const statusConfig: Record<ProviderStatus, {
    color: string
    bgColor: string
    label: string
    pulse: boolean
  }> = {
    online: {
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500',
      label: t('status.online', { latency }),
      pulse: true,
    },
    offline: {
      color: 'text-red-500',
      bgColor: 'bg-red-500',
      label: t('status.offline'),
      pulse: false,
    },
    degraded: {
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500',
      label: t('status.degraded', { latency }),
      pulse: true,
    },
    syncing: {
      color: 'text-blue-500',
      bgColor: 'bg-blue-500',
      label: t('status.syncing'),
      pulse: true,
    },
  }

  const statusKey: ProviderStatus = (status ?? 'offline') as ProviderStatus
  const safeLatency = Number.isFinite(latency ?? NaN) ? (latency as number) : 0
  const config = statusConfig[statusKey] ?? statusConfig.offline
  // 若 label 中需要延迟数值，使用安全值
  if (statusKey === 'online' || statusKey === 'degraded') {
    config.label = t(statusKey === 'online' ? 'status.online' : 'status.degraded', { latency: safeLatency })
  }

  return (
    <div className="flex items-center gap-2">
      {/* Breathing dot indicator */}
      <span className="relative flex size-2.5">
        {config.pulse && (
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              config.bgColor
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full size-2.5",
            config.bgColor
          )}
        />
      </span>
      <span className={cn("text-sm font-medium", config.color)}>
        {config.label}
      </span>
    </div>
  )
}

// Sync button with animation
function SyncButton({
  syncState,
  onSync,
}: {
  syncState: SyncState
  onSync: () => void
}) {
  const t = useTranslations('models')
  return (
    <GlassButton
      variant="secondary"
      size="default"
      onClick={onSync}
      disabled={syncState.is_syncing}
      className="gap-2"
    >
      <motion.div
        animate={syncState.is_syncing ? { rotate: 360 } : { rotate: 0 }}
        transition={
          syncState.is_syncing
            ? { duration: 1, repeat: Infinity, ease: "linear" }
            : { duration: 0 }
        }
      >
        <RefreshCw className="size-4" />
      </motion.div>
      <span>
        {syncState.is_syncing ? t('instance.syncing') : t('instance.syncModels')}
      </span>
    </GlassButton>
  )
}

export function InstanceDashboard({
  instance,
  syncState,
  onSync,
  onSettings,
  className,
}: InstanceDashboardProps) {
  const t = useTranslations('models')
  const providerKey =
    instance?.provider ??
    instance?.provider_display_name ??
    instance?.preset_slug ??
    instance?.name ??
    "default"
  const theme = PROVIDER_THEMES[providerKey?.toLowerCase?.() ?? "default"] || PROVIDER_THEMES.default

  // 防御：确保 syncState 可用，避免 undefined 访问
  const safeSyncState: SyncState = syncState ?? {
    is_syncing: false,
    progress: 0,
    last_sync: null,
    error: null,
  }
  const handleSettings = onSettings ?? (() => {})

  // Format last synced time
  const formatLastSynced = (timestamp?: string) => {
    if (!timestamp) return t('instance.neverSynced')
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return t('instance.justNow')
    if (diffMins < 60) return t('instance.ago', { time: `${diffMins}m` })
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return t('instance.ago', { time: `${diffHours}h` })
    return date.toLocaleDateString()
  }

  return (
    <GlassCard
      className={cn("relative overflow-hidden", className)}
      padding="none"
      hover="none"
      blur="lg"
    >
      {/* Brand color flowing light effect */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r opacity-60",
          theme.gradient
        )}
        style={{
          background: `linear-gradient(135deg, ${theme.color}20 0%, transparent 50%)`,
        }}
      />

      {/* Subtle animated shimmer */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.02] to-transparent glass-shimmer" />

      {/* Content */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6 p-6">
        {/* Left: Logo & Identity */}
        <div className="flex items-center gap-4">
          {/* Provider Logo Container */}
          <div
            className="flex size-14 items-center justify-center rounded-2xl border border-white/10 shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${theme.color}30 0%, ${theme.color}10 100%)`,
              boxShadow: `0 8px 32px -8px ${theme.color}40`,
            }}
          >
            <div style={{ color: theme.color }}>
              {theme.icon}
            </div>
          </div>

          {/* Instance Info */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-[var(--foreground)]">
                {instance.name}
              </h1>
              {!instance.is_enabled && (
                <Badge variant="outline" className="text-yellow-500 border-yellow-500/30">
                  {t('instance.disabled')}
                </Badge>
              )}
            </div>
            <p className="text-sm text-[var(--muted)] font-mono">
              {instance.base_url}
            </p>
            <div className="flex items-center gap-4 mt-1">
              <StatusIndicator status={instance.status} latency={instance.latency} />
              <span className="text-xs text-[var(--muted)]">
                •
              </span>
              <span className="text-xs text-[var(--muted)]">
                {t('filter.modelsCount', { count: instance.model_count })}
              </span>
              <span className="text-xs text-[var(--muted)]">
                •
              </span>
              <span className="text-xs text-[var(--muted)]">
                {t('instance.synced', { time: formatLastSynced(instance.last_synced_at) })}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Core Actions */}
        <div className="flex items-center gap-3">
          {/* Sync Progress (when syncing) */}
          {safeSyncState.is_syncing && (
            <div className="flex items-center gap-2 mr-4">
              <div className="h-1.5 w-24 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: theme.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${safeSyncState.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <span className="text-xs text-[var(--muted)]">
                {safeSyncState.progress}%
              </span>
            </div>
          )}

          <SyncButton syncState={safeSyncState} onSync={onSync} />

          <GlassButton
            variant="ghost"
            size="icon"
            onClick={handleSettings}
            className="hover:bg-white/5"
          >
            <Settings className="size-4" />
          </GlassButton>
        </div>
      </div>

      {/* Sync Error Banner */}
      {safeSyncState.error && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="border-t border-red-500/20 bg-red-500/10 px-6 py-3"
        >
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="size-4" />
            <span>{syncState.error}</span>
          </div>
        </motion.div>
      )}
    </GlassCard>
  )
}

export default InstanceDashboard
