"use client"

import { type ReactNode, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import useSWR from "swr"
import {
  Activity,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Database,
  Gauge,
  RefreshCw,
  Route,
  Sparkles,
  Target,
  TimerReset,
  TrendingUp,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/shadcn/button"
import { Badge } from "@/components/ui/shadcn/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Container } from "@/components/ui/common/container"
import {
  KNOWN_BANDIT_SCENES,
  fetchLocalBanditDashboard,
  type KnownBanditScene,
  type LocalBanditArmState,
  type LocalBanditSceneSnapshot,
} from "@/lib/api/bandit"
import { isTauriRuntime } from "@/lib/runtime/tauri"

const QUERY_KEY = "local-bandit-dashboard"

const SCENE_META: Record<
  KnownBanditScene,
  {
    key: "routerLlm" | "taskRoute" | "workerSelection" | "memoryRecall"
    icon: typeof Route
  }
> = {
  "router:llm": {
    key: "routerLlm",
    icon: Route,
  },
  "task_learning:route": {
    key: "taskRoute",
    icon: BrainCircuit,
  },
  "task_learning:worker_selection": {
    key: "workerSelection",
    icon: Bot,
  },
  "memory:recall": {
    key: "memoryRecall",
    icon: Database,
  },
}

function computeSuccessRate(arm: LocalBanditArmState) {
  return arm.total_trials > 0 ? arm.successes / arm.total_trials : null
}

function computePosteriorMean(arm: LocalBanditArmState) {
  const denominator = arm.alpha + arm.beta
  return denominator > 0 ? arm.alpha / denominator : null
}

function computeAverageLatency(arm: LocalBanditArmState) {
  return arm.total_trials > 0 ? arm.total_latency_ms / arm.total_trials : null
}

function computeCostPerTrial(arm: LocalBanditArmState) {
  return arm.total_trials > 0 ? arm.total_cost / arm.total_trials : null
}

function isCoolingDown(arm: LocalBanditArmState) {
  if (!arm.cooldown_until) return false
  return new Date(arm.cooldown_until).getTime() > Date.now()
}

function sortArms(arms: LocalBanditArmState[]) {
  return [...arms].sort((left, right) => {
    const rightSuccess = computeSuccessRate(right) ?? -1
    const leftSuccess = computeSuccessRate(left) ?? -1
    if (right.total_trials !== left.total_trials) return right.total_trials - left.total_trials
    if (rightSuccess !== leftSuccess) return rightSuccess - leftSuccess
    return (computePosteriorMean(right) ?? -1) - (computePosteriorMean(left) ?? -1)
  })
}

type SceneSummary = {
  scene: KnownBanditScene
  arms: LocalBanditArmState[]
  leader: LocalBanditArmState | null
  totalTrials: number
  activeArms: number
  avgSuccessRate: number | null
  dominantShare: number
  meanEpsilon: number
  cooldownCount: number
  lastUpdated: string | null
}

function summarizeScene(snapshot: LocalBanditSceneSnapshot): SceneSummary {
  const arms = sortArms(snapshot.arms)
  const totalTrials = arms.reduce((sum, arm) => sum + arm.total_trials, 0)
  const totalSuccesses = arms.reduce((sum, arm) => sum + arm.successes, 0)
  const meanEpsilon = arms.length > 0 ? arms.reduce((sum, arm) => sum + arm.epsilon, 0) / arms.length : 0
  const cooldownCount = arms.filter(isCoolingDown).length
  const leader = arms[0] ?? null
  const dominantShare = leader && totalTrials > 0 ? Math.min(1, leader.total_trials / totalTrials) : 0
  const lastUpdated = arms.map((arm) => arm.updated_at).sort((left, right) => right.localeCompare(left))[0] ?? null

  return {
    scene: snapshot.scene,
    arms,
    leader,
    totalTrials,
    activeArms: arms.length,
    avgSuccessRate: totalTrials > 0 ? totalSuccesses / totalTrials : null,
    dominantShare,
    meanEpsilon,
    cooldownCount,
    lastUpdated,
  }
}

export function BanditPageClient({ title }: { title: string }) {
  const t = useTranslations("bandit")
  const locale = useLocale()
  const desktopRuntime = isTauriRuntime()
  const { data, error, isLoading, mutate } = useSWR(
    desktopRuntime ? QUERY_KEY : null,
    fetchLocalBanditDashboard,
  )
  const sceneSummaries = useMemo(
    () => (data ?? KNOWN_BANDIT_SCENES.map((scene) => ({ scene, arms: [] }))).map(summarizeScene),
    [data],
  )
  const [activeScene, setActiveScene] = useState<KnownBanditScene>(KNOWN_BANDIT_SCENES[0])
  const currentScene = sceneSummaries.find((summary) => summary.scene === activeScene) ?? sceneSummaries[0]

  const overallStats = useMemo(() => {
    const totalScenes = sceneSummaries.length
    const totalArms = sceneSummaries.reduce((sum, summary) => sum + summary.activeArms, 0)
    const totalTrials = sceneSummaries.reduce((sum, summary) => sum + summary.totalTrials, 0)
    const cooldowns = sceneSummaries.reduce((sum, summary) => sum + summary.cooldownCount, 0)
    const avgSuccessRate = totalTrials > 0
      ? sceneSummaries.reduce((sum, summary) => {
          if (!summary.avgSuccessRate) return sum
          return sum + summary.avgSuccessRate * summary.totalTrials
        }, 0) / totalTrials
      : null
    const avgExploration = totalScenes > 0
      ? sceneSummaries.reduce((sum, summary) => sum + summary.meanEpsilon, 0) / totalScenes
      : 0

    return { totalScenes, totalArms, totalTrials, cooldowns, avgSuccessRate, avgExploration }
  }, [sceneSummaries])

  if (!desktopRuntime) {
    return (
      <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
        <Card>
          <CardHeader>
            <CardTitle>{t("runtime.desktopOnlyTitle")}</CardTitle>
            <CardDescription>{t("runtime.desktopOnlyDescription")}</CardDescription>
          </CardHeader>
        </Card>
      </Container>
    )
  }

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="space-y-6">
        <Card className="overflow-hidden border-white/15 bg-[linear-gradient(128deg,rgba(8,15,32,0.95),rgba(28,51,102,0.88)_44%,rgba(233,121,53,0.75)_115%)] text-white">
          <div className="grid gap-8 p-7 lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-50/90">
                <Sparkles className="size-3.5" />
                {t("hero.eyebrow")}
              </div>

              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.05em] md:text-5xl">
                  {title}
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-white/75 md:text-base">
                  {t("hero.description")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {sceneSummaries.map((summary) => {
                  const meta = SCENE_META[summary.scene]
                  const Icon = meta.icon
                  return (
                    <div key={summary.scene} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80">
                      <Icon className="size-3.5" />
                      <span>{t(`scenes.${meta.key}.chip`)}</span>
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="ghost" size="sm" onClick={() => void mutate()} className="rounded-full border border-white/15 bg-white/10 px-4 text-white hover:bg-white/15">
                  <RefreshCw className="mr-1.5 size-3.5" />
                  {t("actions.refresh")}
                </Button>
                <Link href="/dashboard/task-learning" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15">
                  <ArrowUpRight className="size-4" />
                  {t("actions.openTaskLearning")}
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <HeroStat icon={<Target className="size-4" />} label={t("stats.scenes")} value={formatNumber(overallStats.totalScenes, locale)} hint={t("stats.scenesHint")} />
              <HeroStat icon={<Activity className="size-4" />} label={t("stats.arms")} value={formatNumber(overallStats.totalArms, locale)} hint={t("stats.armsHint")} />
              <HeroStat icon={<TrendingUp className="size-4" />} label={t("stats.trials")} value={formatNumber(overallStats.totalTrials, locale)} hint={t("stats.trialsHint")} />
              <HeroStat icon={<TimerReset className="size-4" />} label={t("stats.cooling")} value={formatNumber(overallStats.cooldowns, locale)} hint={t("stats.coolingHint")} />
              <HeroStat icon={<Gauge className="size-4" />} label={t("stats.averageSuccess")} value={formatPercent(overallStats.avgSuccessRate, 1)} hint={t("stats.averageSuccessHint")} />
              <HeroStat icon={<Zap className="size-4" />} label={t("stats.exploration")} value={formatPercent(overallStats.avgExploration, 1)} hint={t("stats.explorationHint")} />
            </div>
          </div>
        </Card>

        {error ? (
          <Card className="border-rose-200/80 bg-rose-50/70">
            <CardHeader>
              <CardTitle className="text-rose-800">{t("runtime.loadFailedTitle")}</CardTitle>
              <CardDescription className="text-rose-700">{error instanceof Error ? error.message : t("runtime.loadFailedDescription")}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {isLoading ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-[28px] border bg-card" />
              ))}
            </div>
            <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="h-80 animate-pulse rounded-[28px] border bg-card" />
              <div className="h-80 animate-pulse rounded-[28px] border bg-card" />
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-4">
              {sceneSummaries.map((summary) => {
                const meta = SCENE_META[summary.scene]
                const Icon = meta.icon
                const active = summary.scene === currentScene.scene

                return (
                  <button
                    key={summary.scene}
                    type="button"
                    onClick={() => setActiveScene(summary.scene)}
                    className={`rounded-[28px] border p-4 text-left transition-all duration-200 ${active ? "border-sky-300/80 bg-sky-50/60" : "border-border bg-card hover:bg-sky-50/30"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t(`scenes.${meta.key}.chip`)}</div>
                        <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-900">{t(`scenes.${meta.key}.name`)}</div>
                      </div>
                      <div className="rounded-2xl bg-white/75 p-3 text-slate-700">
                        <Icon className="size-4" />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>{t("sceneTabs.activity")}</span>
                      <span>{formatNumber(summary.totalTrials, locale)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-700">{describeSceneState(summary, t)}</div>
                  </button>
                )
              })}
            </div>

            {!currentScene || currentScene.activeArms === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("runtime.emptyTitle")}</CardTitle>
                  <CardDescription>{t("runtime.emptyDescription")}</CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <>
                <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Activity className="size-4 text-sky-500" />
                        {t("overview.title")}
                      </CardTitle>
                      <CardDescription>{t(`scenes.${SCENE_META[currentScene.scene].key}.description`)}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <MetricCell label={t("overview.totalTrials")} value={formatNumber(currentScene.totalTrials, locale)} />
                        <MetricCell label={t("overview.leaderShare")} value={formatPercent(currentScene.dominantShare, 1)} />
                        <MetricCell label={t("overview.exploration")} value={formatPercent(currentScene.meanEpsilon, 1)} />
                        <MetricCell label={t("overview.avgSuccess")} value={formatPercent(currentScene.avgSuccessRate, 1)} />
                      </div>

                      <div className="rounded-[26px] border border-slate-100 bg-slate-50/70 p-5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("overview.lastUpdated")}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">{formatTimestamp(currentScene.lastUpdated, locale)}</div>
                        <p className="mt-3 text-sm leading-7 text-slate-600">{describeSceneState(currentScene, t)}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="size-4 text-amber-500" />
                        {t("effect.title")}
                      </CardTitle>
                      <CardDescription>{t("effect.description")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="rounded-[28px] border border-slate-100 bg-[linear-gradient(145deg,rgba(248,250,252,0.96),rgba(255,247,237,0.96))] p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("effect.leadingArm")}</div>
                            <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-900">{currentScene.leader?.arm_id ?? "--"}</div>
                          </div>
                          <div className="rounded-[20px] bg-white/80 px-4 py-3 text-right shadow-sm">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("effect.strategy")}</div>
                            <div className="mt-1 text-sm font-semibold text-slate-800">{currentScene.leader ? strategyLabel(currentScene.leader.strategy, t) : "--"}</div>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <MetricCell label={t("effect.confidence")} value={formatPercent(currentScene.leader ? computePosteriorMean(currentScene.leader) : null, 1)} />
                          <MetricCell label={t("effect.cooldowns")} value={formatNumber(currentScene.cooldownCount, locale)} />
                        </div>
                      </div>

                      <div className="rounded-[26px] border border-dashed border-slate-200 bg-white/60 p-5 text-sm leading-7 text-slate-600">
                        {describeSceneState(currentScene, t)}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="size-4 text-indigo-500" />
                      {t("arms.title")}
                    </CardTitle>
                    <CardDescription>{t("arms.description")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {currentScene.arms.map((arm) => (
                        <ArmCard key={arm.id} arm={arm} t={t} locale={locale} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </Container>
  )
}

function HeroStat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[28px] border border-white/12 bg-white/10 p-4 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">{label}</div>
        <div className="rounded-2xl bg-white/10 p-2 text-white/80">{icon}</div>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-2 text-xs leading-5 text-white/60">{hint}</div>
    </div>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  )
}

function ArmCard({
  arm,
  t,
  locale,
}: {
  arm: LocalBanditArmState
  t: ReturnType<typeof useTranslations>
  locale: string
}) {
  const successRate = computeSuccessRate(arm)
  const posteriorMean = computePosteriorMean(arm)
  const avgLatency = computeAverageLatency(arm)
  const coolingDown = isCoolingDown(arm)
  const armLabel = arm.arm_id ?? arm.provider_model_id ?? arm.id
  const rewardMetric = arm.reward_metric_type ?? "reward"

  return (
    <div className="group relative overflow-hidden rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-[0_20px_44px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{strategyLabel(arm.strategy, t)}</div>
          <div className="mt-2 truncate text-lg font-semibold tracking-[-0.03em] text-slate-900">{armLabel}</div>
          <div className="mt-1 text-xs text-slate-500">{t("arms.rewardMetric", { value: rewardMetric })}</div>
        </div>

        <Badge variant="outline" className={coolingDown ? "text-amber-700" : arm.total_trials > 0 ? "text-emerald-700" : "text-slate-500"}>
          {coolingDown ? t("status.cooling") : arm.total_trials > 0 ? t("status.live") : t("status.idle")}
        </Badge>
      </div>

      <div className="mt-5 space-y-3">
        <ProgressMetric label={t("arms.successRate")} value={successRate} />
        <ProgressMetric label={t("arms.posteriorMean")} value={posteriorMean} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCell label={t("arms.trials")} value={formatNumber(arm.total_trials, locale)} />
        <MetricCell label={t("arms.avgLatency")} value={formatLatency(avgLatency)} />
        <MetricCell label={t("arms.totalCost")} value={formatMoney(arm.total_cost)} />
        <MetricCell label={t("arms.totalCostPerTrial")} value={formatMoney(computeCostPerTrial(arm))} />
        <MetricCell label={t("arms.lastReward")} value={arm.last_reward.toFixed(3)} />
        <MetricCell label={t("arms.cooldown")} value={formatTimestamp(arm.cooldown_until, locale)} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{t("arms.alphaBeta", { alpha: arm.alpha.toFixed(1), beta: arm.beta.toFixed(1) })}</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{t("arms.version", { value: arm.version })}</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{t("arms.updated", { value: formatTimestamp(arm.updated_at, locale) })}</span>
      </div>
    </div>
  )
}

function ProgressMetric({ label, value }: { label: string; value: number | null | undefined }) {
  const normalized = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="font-semibold text-slate-700">{formatPercent(value, 1)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-400 transition-all duration-700" style={{ width: `${normalized * 100}%` }} />
      </div>
    </div>
  )
}

function describeSceneState(
  summary: SceneSummary,
  t: ReturnType<typeof useTranslations>,
) {
  if (summary.activeArms === 0) return t("insights.noTraffic")
  if (summary.cooldownCount > 0) {
    return t("insights.cooling", { count: summary.cooldownCount })
  }
  if (summary.totalTrials < 12) {
    return t("insights.warming", { trials: summary.totalTrials })
  }
  if (summary.dominantShare >= 0.58 && summary.leader?.arm_id) {
    return t("insights.leader", { arm: summary.leader.arm_id })
  }
  if (summary.meanEpsilon >= 0.15) return t("insights.exploring")
  return t("insights.balanced")
}

function strategyLabel(strategy: string | null | undefined, t: ReturnType<typeof useTranslations>) {
  if (!strategy) return t("strategy.unknown")
  if (strategy === "epsilon_greedy") return t("strategy.epsilonGreedy")
  if (strategy === "thompson") return t("strategy.thompson")
  if (strategy === "ucb") return t("strategy.ucb")
  return strategy
}

function formatPercent(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--"
  return `${(value * 100).toFixed(digits)}%`
}

function formatNumber(value: number | null | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--"
  return new Intl.NumberFormat(locale).format(value)
}

function formatLatency(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "--"
  return `${Math.round(value)} ms`
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "--"
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

function formatTimestamp(value: string | null | undefined, locale: string) {
  if (!value) return "--"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}
