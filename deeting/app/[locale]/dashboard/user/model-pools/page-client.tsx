"use client"

import * as React from "react"
import useSWR from "swr"
import {
  Activity,
  AlertCircle,
  BatteryMedium,
  ChevronRight,
  Cpu,
  Link2,
  PlugZap,
  Waves,
  Zap,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { Container } from "@/components/ui/container"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { PageHeader } from "@/components/ui/page-header/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  fetchLocalModelPoolsStatus,
  type LocalModelPoolMemberStatus,
  type LocalModelPoolSessionBinding,
  type LocalModelPoolStatus,
} from "@/lib/api/model-pools"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import { cn } from "@/lib/utils"

const QUERY_KEY = "local-model-pools-status"
const EMPTY_VALUE = "--"

type Translate = (key: string, values?: Record<string, string | number>) => string

const STATUS_COLORS: Record<string, { dot: string; bg: string; text: string; ring: string }> = {
  active: {
    dot: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]",
    bg: "bg-emerald-500/8 dark:bg-emerald-400/10",
    text: "text-emerald-600 dark:text-emerald-300",
    ring: "ring-emerald-500/20",
  },
  ready: {
    dot: "bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.6)]",
    bg: "bg-cyan-500/8 dark:bg-cyan-400/10",
    text: "text-cyan-600 dark:text-cyan-300",
    ring: "ring-cyan-500/20",
  },
  cooldown: {
    dot: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]",
    bg: "bg-amber-500/8 dark:bg-amber-400/10",
    text: "text-amber-600 dark:text-amber-300",
    ring: "ring-amber-500/20",
  },
  idle: {
    dot: "bg-slate-400 dark:bg-slate-500",
    bg: "bg-slate-500/6 dark:bg-slate-400/8",
    text: "text-slate-500 dark:text-slate-400",
    ring: "ring-slate-400/20",
  },
}

const formatPercent = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : EMPTY_VALUE

const formatLatency = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? `${Math.round(value)} ms` : EMPTY_VALUE

const formatTimestamp = (value: string | null | undefined, locale: string) => {
  if (!value) return EMPTY_VALUE
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}

const countReadyMembers = (pool: LocalModelPoolStatus) =>
  pool.members.filter((m) => m.status === "active" || m.status === "ready").length

/* ─── Apple Watch Activity Ring ─── */
function HealthRing({ score, size = 96 }: { score: number; size?: number }) {
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const safeScore = Math.max(0, Math.min(100, score))
  const offset = circumference - (safeScore / 100) * circumference
  const gradientId = React.useId()

  const stopColor =
    score >= 80
      ? { from: "#34d399", to: "#06b6d4" }
      : score >= 55
        ? { from: "#fbbf24", to: "#f97316" }
        : { from: "#fb7185", to: "#ef4444" }

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-black/[0.04] dark:text-white/[0.06]"
          strokeWidth={strokeWidth}
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={stopColor.from} />
            <stop offset="100%" stopColor={stopColor.to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ filter: `drop-shadow(0 0 6px ${stopColor.from}44)` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[28px] font-bold tracking-tight text-[var(--foreground)]">
          {safeScore}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
          SCORE
        </span>
      </div>
    </div>
  )
}

/* ─── iOS Widget Stat Tile ─── */
function WidgetStatTile({
  icon,
  label,
  value,
  accentFrom,
  accentTo,
  index,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accentFrom: string
  accentTo: string
  index: number
}) {
  const gradientId = React.useId()

  return (
    <div
      className={cn(
        "animate-glass-card-in opacity-0",
        `stagger-${index + 1}`,
        "group relative isolate overflow-hidden rounded-[22px]",
        "border border-black/[0.05] dark:border-white/[0.07]",
        "bg-white/70 dark:bg-white/[0.04]",
        "backdrop-blur-2xl",
        "p-5",
        "shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]",
        "dark:shadow-[0_2px_16px_-4px_rgba(0,0,0,0.5)]",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.12)]",
        "dark:hover:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.6)]"
      )}
    >
      {/* Ambient gradient glow */}
      <svg className="pointer-events-none absolute inset-0 size-full opacity-60 dark:opacity-40" aria-hidden>
        <defs>
          <radialGradient id={gradientId} cx="80%" cy="20%" r="70%">
            <stop offset="0%" stopColor={accentFrom} stopOpacity="0.15" />
            <stop offset="100%" stopColor={accentTo} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
      </svg>

      {/* Top shine line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/[0.08]" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            {label}
          </p>
          <p className="text-[32px] font-bold leading-none tracking-tight text-[var(--foreground)]">
            {value}
          </p>
        </div>
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-[14px]"
          style={{
            background: `linear-gradient(135deg, ${accentFrom}18, ${accentTo}18)`,
          }}
        >
          <div style={{ color: accentFrom }}>{icon}</div>
        </div>
      </div>
    </div>
  )
}

/* ─── Status Pill ─── */
function StatusBadge({ status, t }: { status: string; t: Translate }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.idle
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold ring-1",
        colors.bg,
        colors.text,
        colors.ring
      )}
    >
      <span className={cn("size-[5px] rounded-full", colors.dot)} />
      {t(`status.${status}`)}
    </span>
  )
}

/* ─── iOS Inline Metric ─── */
function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-black/[0.04] bg-black/[0.02] px-3.5 py-2.5 dark:border-white/[0.05] dark:bg-white/[0.025]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-semibold text-[var(--foreground)]">{value}</p>
    </div>
  )
}

/* ─── iOS Grouped Section ─── */
function IOSGroupedSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="px-1">
        <h3 className="text-[17px] font-bold text-[var(--foreground)]">{title}</h3>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">{description}</p>
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-[20px]",
          "border border-black/[0.05] dark:border-white/[0.06]",
          "bg-white/60 dark:bg-white/[0.03]",
          "backdrop-blur-2xl",
          "shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_6px_rgba(0,0,0,0.3)]"
        )}
      >
        {children}
      </div>
    </div>
  )
}

/* ─── Pool Directory Row (iOS Settings style) ─── */
function PoolDirectoryItem({
  pool,
  selected,
  onSelect,
  isFirst,
  isLast,
  t,
}: {
  pool: LocalModelPoolStatus
  selected: boolean
  onSelect: () => void
  isFirst: boolean
  isLast: boolean
  t: Translate
}) {
  const readyMembers = countReadyMembers(pool)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative w-full text-left transition-colors duration-150",
        "px-4 py-3.5",
        selected
          ? "bg-[var(--primary)]/[0.06] dark:bg-[var(--primary)]/[0.1]"
          : "hover:bg-black/[0.02] active:bg-black/[0.04] dark:hover:bg-white/[0.03] dark:active:bg-white/[0.05]",
        !isLast && "border-b border-black/[0.04] dark:border-white/[0.05]"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Health mini ring */}
        <div className="relative flex size-11 shrink-0 items-center justify-center">
          <svg width={44} height={44} className="-rotate-90">
            <circle
              cx={22}
              cy={22}
              r={18}
              fill="none"
              stroke="currentColor"
              className="text-black/[0.04] dark:text-white/[0.06]"
              strokeWidth={3.5}
            />
            <circle
              cx={22}
              cy={22}
              r={18}
              fill="none"
              stroke={pool.health_score >= 80 ? "#34d399" : pool.health_score >= 55 ? "#fbbf24" : "#fb7185"}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 18}
              strokeDashoffset={2 * Math.PI * 18 * (1 - pool.health_score / 100)}
              className="transition-all duration-700"
            />
          </svg>
          <span className="absolute text-[11px] font-bold text-[var(--foreground)]">
            {pool.health_score}
          </span>
        </div>

        {/* Label + details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-[var(--foreground)]">
              {pool.display_name}
            </span>
            {selected && (
              <span className="rounded-full bg-[var(--primary)]/12 px-2 py-0.5 text-[10px] font-bold text-[var(--primary)] dark:bg-[var(--primary)]/20">
                {t("badges.selected")}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">
            {readyMembers}/{pool.members.length} {t("labels.readyMembers").toLowerCase()} · {pool.active_session_count} {t("labels.sessions", { count: pool.active_session_count }).toLowerCase()}
          </p>
        </div>

        {/* Chevron */}
        <ChevronRight
          className={cn(
            "size-4 shrink-0 transition-colors",
            selected ? "text-[var(--primary)]" : "text-black/20 dark:text-white/20"
          )}
        />
      </div>
    </button>
  )
}

/* ─── Focus Hero Card ─── */
function FocusHero({ pool, t }: { pool: LocalModelPoolStatus; t: Translate }) {
  const readyMembers = countReadyMembers(pool)

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[24px]",
        "border border-black/[0.05] dark:border-white/[0.06]",
        "bg-white/60 dark:bg-white/[0.03]",
        "backdrop-blur-2xl",
        "shadow-[0_2px_16px_-6px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5)]",
        "p-6 md:p-7"
      )}
    >
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute -right-20 -top-20 size-[280px] rounded-full bg-emerald-400/[0.08] blur-[80px] dark:bg-emerald-400/[0.05]" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 size-[220px] rounded-full bg-cyan-400/[0.06] blur-[60px] dark:bg-cyan-400/[0.04]" />

      {/* Top shine */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/[0.08]" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-5">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-500/15 bg-emerald-500/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-600 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
              {t("badges.desktopLocal")}
            </span>
            <span className="rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1 text-[11px] font-medium text-[var(--muted)] dark:border-white/[0.08] dark:bg-white/[0.03]">
              {pool.pool_key}
            </span>
          </div>

          {/* Title */}
          <div>
            <h2 className="text-[26px] font-bold tracking-tight text-[var(--foreground)] md:text-[30px]">
              {pool.display_name}
            </h2>
            <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-[var(--muted)]">
              {t("descriptions.focus")}
            </p>
          </div>

          {/* Metric grid */}
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <MetricPill label={t("labels.activeProviders")} value={`${pool.active_provider_count}/${pool.provider_count}`} />
            <MetricPill label={t("labels.readyMembers")} value={`${readyMembers}/${pool.members.length}`} />
            <MetricPill label={t("labels.success")} value={formatPercent(pool.success_rate)} />
            <MetricPill label={t("labels.latency")} value={formatLatency(pool.avg_latency_ms)} />
          </div>
        </div>

        {/* Health Ring */}
        <div className="flex shrink-0 flex-col items-center rounded-[22px] border border-black/[0.04] bg-black/[0.02] px-6 py-5 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <HealthRing score={pool.health_score} />
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
            {t("metrics.health")}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Empty State ─── */
function EmptyListState({ message }: { message: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-black/[0.03] dark:bg-white/[0.04]">
        <Cpu className="size-4.5 text-[var(--muted)]" />
      </div>
      <p className="text-[13px] text-[var(--muted)]">{message}</p>
    </div>
  )
}

/* ─── Member Row (iOS grouped list) ─── */
function MemberRow({
  member,
  isLast,
  t,
}: {
  member: LocalModelPoolMemberStatus
  isLast: boolean
  t: Translate
}) {
  const modelLabel = member.display_name || member.model_id
  const providerLabel = member.provider ? `${member.instance_name} · ${member.provider}` : member.instance_name

  return (
    <div
      className={cn(
        "px-4 py-4 transition-colors duration-150",
        "hover:bg-black/[0.015] dark:hover:bg-white/[0.02]",
        !isLast && "border-b border-black/[0.04] dark:border-white/[0.05]"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-[var(--foreground)]">{modelLabel}</span>
            <StatusBadge status={member.status} t={t} />
            {member.is_pinned && (
              <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--primary)]">
                {t("labels.pinned")}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{providerLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[var(--muted)]">{t("labels.memberModel")}</p>
          <p className="truncate text-[13px] font-medium text-[var(--foreground)]">
            {member.unified_model_id || member.model_id}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricPill label={t("labels.success")} value={formatPercent(member.success_rate)} />
        <MetricPill label={t("labels.latency")} value={formatLatency(member.avg_latency_ms)} />
        <MetricPill label={t("labels.trials")} value={`${member.successes}/${member.total_trials}`} />
        <MetricPill label={t("labels.pinnedSessions")} value={String(member.pinned_session_count)} />
      </div>
    </div>
  )
}

/* ─── Binding Row (iOS grouped list) ─── */
function BindingRow({
  binding,
  isLast,
  t,
  locale,
}: {
  binding: LocalModelPoolSessionBinding
  isLast: boolean
  t: Translate
  locale: string
}) {
  return (
    <div
      className={cn(
        "px-4 py-4 transition-colors duration-150",
        "hover:bg-black/[0.015] dark:hover:bg-white/[0.02]",
        !isLast && "border-b border-black/[0.04] dark:border-white/[0.05]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-[var(--foreground)]">
            {binding.title || binding.session_id}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{binding.session_id}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-blue-500/8 text-blue-500 dark:bg-blue-400/10 dark:text-blue-400">
          <Link2 className="size-4" />
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <MetricPill label={t("labels.boundProvider")} value={binding.pinned_provider_model_id} />
        <MetricPill
          label={t("labels.lastActive")}
          value={formatTimestamp(binding.last_active_at || binding.updated_at, locale)}
        />
      </div>
    </div>
  )
}

/* ─── iOS Loading Skeleton ─── */
function IOSSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-[22px]" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Skeleton className="h-[480px] rounded-[20px]" />
        <div className="space-y-6">
          <Skeleton className="h-[280px] rounded-[24px]" />
          <Skeleton className="h-[360px] rounded-[20px]" />
          <Skeleton className="h-[240px] rounded-[20px]" />
        </div>
      </div>
    </div>
  )
}

/* ─── Main Page ─── */
export function ModelPoolsPageClient() {
  const t = useTranslations("model-pools") as unknown as Translate
  const locale = useLocale()
  const [desktopSupport, setDesktopSupport] = React.useState<boolean | null>(null)
  const isDesktop = desktopSupport === true

  React.useEffect(() => {
    setDesktopSupport(isTauriRuntime())
  }, [])
  const { data, isLoading, error } = useSWR<LocalModelPoolStatus[]>(
    isDesktop ? QUERY_KEY : null,
    fetchLocalModelPoolsStatus,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  )
  const pools = React.useMemo(() => data ?? [], [data])
  const [selectedPoolKey, setSelectedPoolKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!pools.length) {
      setSelectedPoolKey(null)
      return
    }
    if (!selectedPoolKey || !pools.some((p) => p.pool_key === selectedPoolKey)) {
      setSelectedPoolKey(pools[0].pool_key)
    }
  }, [pools, selectedPoolKey])

  const selectedPool = React.useMemo(
    () => pools.find((p) => p.pool_key === selectedPoolKey) ?? pools[0] ?? null,
    [pools, selectedPoolKey]
  )

  const summary = React.useMemo(() => {
    const totalPools = pools.length
    const activeSessions = pools.reduce((s, p) => s + p.active_session_count, 0)
    const coolingProviders = pools.reduce((s, p) => s + p.cooling_down_count, 0)
    const avgHealth = totalPools
      ? Math.round(pools.reduce((s, p) => s + p.health_score, 0) / totalPools)
      : 0
    return { totalPools, activeSessions, coolingProviders, avgHealth }
  }, [pools])

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md" size="full">
      <PageHeader title={t("title")} description={t("subtitle")} icon={Activity} />

      {/* ── Desktop-only gate ── */}
      {desktopSupport === null ? (
        <IOSSkeleton />
      ) : !isDesktop ? (
        <GlassCard theme="surface" hover="none" className="border-black/[0.05] p-10 dark:border-white/[0.06]">
          <GlassCardHeader className="items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-[18px] bg-black/[0.03] dark:bg-white/[0.04]">
              <Cpu className="size-6 text-[var(--muted)]" />
            </div>
            <GlassCardTitle className="mt-3">{t("desktopOnlyTitle")}</GlassCardTitle>
            <GlassCardDescription className="max-w-sm">{t("desktopOnlyDescription")}</GlassCardDescription>
          </GlassCardHeader>
        </GlassCard>
      ) : isLoading ? (
        <IOSSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center rounded-[24px] border border-rose-500/15 bg-rose-500/[0.04] p-10 text-center backdrop-blur-xl dark:border-rose-400/20 dark:bg-rose-400/[0.06]">
          <div className="flex size-14 items-center justify-center rounded-[18px] bg-rose-500/10">
            <AlertCircle className="size-6 text-rose-500" />
          </div>
          <h3 className="mt-4 text-[17px] font-bold text-[var(--foreground)]">{t("errorTitle")}</h3>
          <p className="mt-1 max-w-md text-[13px] text-[var(--muted)]">{String(error)}</p>
        </div>
      ) : pools.length === 0 ? (
        <div className="flex flex-col items-center rounded-[24px] border border-black/[0.05] bg-white/60 p-14 text-center backdrop-blur-2xl dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex size-16 items-center justify-center rounded-[22px] bg-black/[0.03] dark:bg-white/[0.04]">
            <Cpu className="size-7 text-[var(--muted)]" />
          </div>
          <h3 className="mt-5 text-[19px] font-bold text-[var(--foreground)]">{t("emptyTitle")}</h3>
          <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-[var(--muted)]">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="space-y-7">
          {/* ── Overview Widgets ── */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <WidgetStatTile
              icon={<BatteryMedium className="size-5" />}
              label={t("metrics.pools")}
              value={String(summary.totalPools)}
              accentFrom="#f59e0b"
              accentTo="#f97316"
              index={0}
            />
            <WidgetStatTile
              icon={<PlugZap className="size-5" />}
              label={t("metrics.sessions")}
              value={String(summary.activeSessions)}
              accentFrom="#06b6d4"
              accentTo="#3b82f6"
              index={1}
            />
            <WidgetStatTile
              icon={<Waves className="size-5" />}
              label={t("metrics.cooling")}
              value={String(summary.coolingProviders)}
              accentFrom="#f97316"
              accentTo="#ef4444"
              index={2}
            />
            <WidgetStatTile
              icon={<Zap className="size-5" />}
              label={t("metrics.health")}
              value={`${summary.avgHealth}%`}
              accentFrom="#34d399"
              accentTo="#06b6d4"
              index={3}
            />
          </div>

          {selectedPool && (
            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              {/* ── Left: Sticky Pool Directory ── */}
              <div className="xl:sticky xl:top-6 xl:self-start">
                <IOSGroupedSection
                  title={t("sections.directory")}
                  description={t("descriptions.directory")}
                >
                  {pools.map((pool, i) => (
                    <PoolDirectoryItem
                      key={pool.pool_key}
                      pool={pool}
                      selected={pool.pool_key === selectedPool.pool_key}
                      onSelect={() => setSelectedPoolKey(pool.pool_key)}
                      isFirst={i === 0}
                      isLast={i === pools.length - 1}
                      t={t}
                    />
                  ))}
                </IOSGroupedSection>
              </div>

              {/* ── Right: Hero + Members + Bindings ── */}
              <div className="space-y-6">
                <FocusHero pool={selectedPool} t={t} />

                <IOSGroupedSection
                  title={t("sections.members")}
                  description={t("descriptions.members")}
                >
                  {selectedPool.members.length ? (
                    selectedPool.members.map((member, i) => (
                      <MemberRow
                        key={member.provider_model_id}
                        member={member}
                        isLast={i === selectedPool.members.length - 1}
                        t={t}
                      />
                    ))
                  ) : (
                    <EmptyListState message={t("empty.members")} />
                  )}
                </IOSGroupedSection>

                <IOSGroupedSection
                  title={t("sections.bindings")}
                  description={t("descriptions.bindings")}
                >
                  {selectedPool.bindings.length ? (
                    selectedPool.bindings.map((binding, i) => (
                      <BindingRow
                        key={`${binding.session_id}:${binding.pinned_provider_model_id}`}
                        binding={binding}
                        isLast={i === selectedPool.bindings.length - 1}
                        t={t}
                        locale={locale}
                      />
                    ))
                  ) : (
                    <EmptyListState message={t("empty.bindings")} />
                  )}
                </IOSGroupedSection>
              </div>
            </div>
          )}
        </div>
      )}
    </Container>
  )
}
