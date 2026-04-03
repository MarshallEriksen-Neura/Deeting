"use client"

import * as React from "react"
import useSWR from "swr"
import { Activity, AlertCircle, BatteryMedium, Cpu, PlugZap, Waves } from "lucide-react"
import { useTranslations } from "next-intl"

import { Container } from "@/components/ui/container"
import { PageHeader } from "@/components/ui/page-header/page-header"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import {
  fetchLocalModelPoolsStatus,
  type LocalModelPoolMemberStatus,
  type LocalModelPoolStatus,
} from "@/lib/api/model-pools"

const QUERY_KEY = "local-model-pools-status"
type Translate = (key: string, values?: Record<string, string | number>) => string

const formatPercent = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—"

const formatLatency = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? `${Math.round(value)} ms` : "—"

function BatteryMeter({ score }: { score: number }) {
  const tone =
    score >= 80
      ? "from-emerald-400 via-teal-300 to-cyan-300"
      : score >= 55
        ? "from-amber-400 via-orange-300 to-yellow-200"
        : "from-rose-500 via-orange-400 to-amber-300"

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-4 flex-1 rounded-full bg-white/8 ring-1 ring-white/10">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-all", tone)}
          style={{ width: `${Math.max(6, Math.min(100, score))}%` }}
        />
      </div>
      <div className="flex h-6 min-w-14 items-center justify-center rounded-full bg-white/6 px-2 text-xs font-semibold text-white/90">
        {score}%
      </div>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <GlassCard theme="surface" hover="none" className="border-white/6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.18em] text-white/50">{label}</div>
          <div className="text-3xl font-semibold text-white">{value}</div>
          {hint ? <div className="text-xs text-white/45">{hint}</div> : null}
        </div>
        <div className="flex size-11 items-center justify-center rounded-2xl bg-white/8 text-white/85">
          {icon}
        </div>
      </div>
    </GlassCard>
  )
}

function PoolMemberRow({
  member,
  t,
}: {
  member: LocalModelPoolMemberStatus
  t: Translate
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-white/6 bg-white/[0.03] p-4 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))]">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            {member.display_name || member.model_id}
          </span>
          {member.is_pinned ? (
            <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
              {t("labels.pinned")}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-white/45">
          {member.instance_name}
          {member.provider ? ` · ${member.provider}` : ""}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t("labels.status")}</div>
        <div className="mt-1 text-sm text-white">{t(`status.${member.status}` as never)}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t("labels.success")}</div>
        <div className="mt-1 text-sm text-white">{formatPercent(member.success_rate)}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t("labels.latency")}</div>
        <div className="mt-1 text-sm text-white">{formatLatency(member.avg_latency_ms)}</div>
      </div>
    </div>
  )
}

export function ModelPoolsPageClient() {
  const t = useTranslations("model-pools") as unknown as Translate
  const desktop = isTauriRuntime()
  const { data, isLoading, error } = useSWR<LocalModelPoolStatus[]>(
    desktop ? QUERY_KEY : null,
    fetchLocalModelPoolsStatus,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  )
  const pools = data ?? []
  const [selectedPoolKey, setSelectedPoolKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!pools.length) {
      setSelectedPoolKey(null)
      return
    }
    if (!selectedPoolKey || !pools.some((pool) => pool.pool_key === selectedPoolKey)) {
      setSelectedPoolKey(pools[0].pool_key)
    }
  }, [pools, selectedPoolKey])

  const selectedPool = React.useMemo(
    () => pools.find((pool) => pool.pool_key === selectedPoolKey) ?? pools[0] ?? null,
    [pools, selectedPoolKey]
  )

  const summary = React.useMemo(() => {
    const totalPools = pools.length
    const activeSessions = pools.reduce((sum, pool) => sum + pool.active_session_count, 0)
    const coolingProviders = pools.reduce((sum, pool) => sum + pool.cooling_down_count, 0)
    const avgHealth = totalPools
      ? Math.round(pools.reduce((sum, pool) => sum + pool.health_score, 0) / totalPools)
      : 0
    return { totalPools, activeSessions, coolingProviders, avgHealth }
  }, [pools])

  return (
    <Container as="main" className="py-6 md:py-8" gutter="md" size="full">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        icon={Activity}
      />

      {!desktop ? (
        <GlassCard theme="surface" hover="none" className="border-white/6 p-8">
          <GlassCardHeader>
            <GlassCardTitle>{t("desktopOnlyTitle")}</GlassCardTitle>
            <GlassCardDescription>{t("desktopOnlyDescription")}</GlassCardDescription>
          </GlassCardHeader>
        </GlassCard>
      ) : isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-32 rounded-3xl" />
            ))}
          </div>
          <Skeleton className="h-[520px] rounded-3xl" />
        </div>
      ) : error ? (
        <GlassCard theme="surface" hover="none" className="border-rose-500/20 p-8">
          <GlassCardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-200">
                <AlertCircle className="size-5" />
              </div>
              <div>
                <GlassCardTitle>{t("errorTitle")}</GlassCardTitle>
                <GlassCardDescription>{String(error)}</GlassCardDescription>
              </div>
            </div>
          </GlassCardHeader>
        </GlassCard>
      ) : pools.length === 0 ? (
        <GlassCard theme="surface" hover="none" className="border-white/6 p-10">
          <GlassCardHeader>
            <GlassCardTitle>{t("emptyTitle")}</GlassCardTitle>
            <GlassCardDescription>{t("emptyDescription")}</GlassCardDescription>
          </GlassCardHeader>
        </GlassCard>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={<BatteryMedium className="size-5" />}
              label={t("metrics.pools")}
              value={String(summary.totalPools)}
              hint={selectedPool ? t("labels.providers", { count: selectedPool.provider_count }) : undefined}
            />
            <SummaryCard
              icon={<PlugZap className="size-5" />}
              label={t("metrics.sessions")}
              value={String(summary.activeSessions)}
            />
            <SummaryCard
              icon={<Waves className="size-5" />}
              label={t("metrics.cooling")}
              value={String(summary.coolingProviders)}
            />
            <SummaryCard
              icon={<Cpu className="size-5" />}
              label={t("metrics.health")}
              value={`${summary.avgHealth}%`}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_420px]">
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                {t("sections.overview")}
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {pools.map((pool) => {
                  const selected = pool.pool_key === selectedPool?.pool_key
                  return (
                    <button
                      key={pool.pool_key}
                      type="button"
                      onClick={() => setSelectedPoolKey(pool.pool_key)}
                      className="text-left"
                    >
                      <GlassCard
                        theme="surface"
                        hover="lift"
                        className={cn(
                          "border-white/6 p-5 transition-all",
                          selected && "border-cyan-300/30 bg-cyan-300/[0.08]"
                        )}
                      >
                        <GlassCardHeader className="space-y-3">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <GlassCardTitle className="text-xl">{pool.display_name}</GlassCardTitle>
                              <GlassCardDescription className="mt-1 text-xs uppercase tracking-[0.16em] text-white/40">
                                {pool.pool_key}
                              </GlassCardDescription>
                            </div>
                            <div className="rounded-full bg-white/6 px-3 py-1 text-xs font-medium text-white/75">
                              {t("labels.sessions", { count: pool.active_session_count })}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-white/45">
                              <span>{t("labels.battery")}</span>
                              <span>{pool.health_score}%</span>
                            </div>
                            <BatteryMeter score={pool.health_score} />
                          </div>
                        </GlassCardHeader>
                        <GlassCardContent className="mt-4 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                              {t("labels.providers", { count: pool.provider_count })}
                            </div>
                            <div className="mt-1 text-white">{pool.active_provider_count}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t("labels.success")}</div>
                            <div className="mt-1 text-white">{formatPercent(pool.success_rate)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t("labels.latency")}</div>
                            <div className="mt-1 text-white">{formatLatency(pool.avg_latency_ms)}</div>
                          </div>
                        </GlassCardContent>
                      </GlassCard>
                    </button>
                  )
                })}
              </div>
            </div>

            <GlassCard theme="surface" hover="none" className="border-white/6 p-5 xl:sticky xl:top-6 xl:h-fit">
              {selectedPool ? (
                <>
                  <GlassCardHeader className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <GlassCardTitle className="text-2xl">{selectedPool.display_name}</GlassCardTitle>
                        <GlassCardDescription className="mt-1">
                          {t("labels.poolKey")}: {selectedPool.pool_key}
                        </GlassCardDescription>
                      </div>
                      <div className="rounded-full bg-white/6 px-3 py-1 text-xs font-medium text-white/75">
                        {t("labels.providers", { count: selectedPool.provider_count })}
                      </div>
                    </div>
                    <BatteryMeter score={selectedPool.health_score} />
                  </GlassCardHeader>

                  <GlassCardContent className="mt-6 space-y-6">
                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                        {t("sections.bindings")}
                      </h3>
                      {selectedPool.bindings.length ? (
                        <div className="space-y-3">
                          {selectedPool.bindings.map((binding) => (
                            <div
                              key={`${binding.session_id}:${binding.pinned_provider_model_id}`}
                              className="rounded-2xl border border-white/6 bg-white/[0.03] p-4"
                            >
                              <div className="text-sm font-semibold text-white">
                                {binding.title || binding.session_id}
                              </div>
                              <div className="mt-2 text-xs text-white/55">
                                {t("labels.boundProvider")}: {binding.pinned_provider_model_id}
                              </div>
                              <div className="mt-1 text-xs text-white/40">
                                {t("labels.updatedAt")}: {binding.last_active_at || binding.updated_at || "—"}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-white/45">
                          {t("labels.none")}
                        </div>
                      )}
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                        {t("sections.members")}
                      </h3>
                      <div className="space-y-3">
                        {selectedPool.members.map((member) => (
                          <PoolMemberRow key={member.provider_model_id} member={member} t={t} />
                        ))}
                      </div>
                    </section>
                  </GlassCardContent>
                </>
              ) : null}
            </GlassCard>
          </div>
        </div>
      )}
    </Container>
  )
}
