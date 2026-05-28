"use client"

import { type ReactNode, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import useSWR from "swr"
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  ChevronRight,
  Database,
  Orbit,
  RefreshCw,
  Route,
  Sparkles,
  Star,
  Target,
  TimerReset,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { Container } from "@/components/ui/common/container"
import { GlassButton } from "@/components/ui/common/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"
import {
  KNOWN_BANDIT_SCENES,
  fetchLocalBanditDashboard,
  type KnownBanditScene,
  type LocalBanditArmState,
  type LocalBanditSceneSnapshot,
} from "@/lib/api/bandit"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import { cn } from "@/lib/utils"

const QUERY_KEY = "local-bandit-dashboard"

type SceneTone = "accent" | "ok" | "warn" | "muted"

const SCENE_META: Record<
  KnownBanditScene,
  {
    key: "routerLlm" | "workerSelection" | "memoryRecall"
    icon: LucideIcon
    tileClassName: string
    iconClassName: string
  }
> = {
  "router:llm": {
    key: "routerLlm",
    icon: Route,
    tileClassName: "border-[var(--accent-border)] bg-[var(--accent-soft)]/30",
    iconClassName: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
  },
  "task_learning:worker_selection": {
    key: "workerSelection",
    icon: Bot,
    tileClassName: "border-[var(--warn-border)] bg-[var(--warn-soft)]/22",
    iconClassName: "bg-[var(--warn-soft)] text-[var(--warn)]",
  },
  "memory:recall": {
    key: "memoryRecall",
    icon: Database,
    tileClassName: "border-[var(--ok-border)] bg-[var(--ok-soft)]/20",
    iconClassName: "bg-[var(--ok-soft)] text-[var(--ok)]",
  },
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
          if (summary.avgSuccessRate === null) return sum
          return sum + summary.avgSuccessRate * summary.totalTrials
        }, 0) / totalTrials
      : null
    const avgExploration = totalScenes > 0
      ? sceneSummaries.reduce((sum, summary) => sum + summary.meanEpsilon, 0) / totalScenes
      : 0

    return { totalScenes, totalArms, totalTrials, cooldowns, avgSuccessRate, avgExploration }
  }, [sceneSummaries])

  const heroStats = [
    {
      label: t("stats.scenes"),
      value: formatNumber(overallStats.totalScenes, locale),
      hint: t("stats.scenesHint"),
      icon: <Target className="size-4" />,
      toneClassName: "bg-[rgba(116,145,255,0.18)]",
    },
    {
      label: t("stats.arms"),
      value: formatNumber(overallStats.totalArms, locale),
      hint: t("stats.armsHint"),
      icon: <Orbit className="size-4" />,
      toneClassName: "bg-[rgba(255,255,255,0.14)]",
    },
    {
      label: t("stats.trials"),
      value: formatNumber(overallStats.totalTrials, locale),
      hint: t("stats.trialsHint"),
      icon: <ArrowUpRight className="size-4" />,
      toneClassName: "bg-[rgba(255,255,255,0.14)]",
    },
    {
      label: t("stats.cooling"),
      value: formatNumber(overallStats.cooldowns, locale),
      hint: t("stats.coolingHint"),
      icon: <TimerReset className="size-4" />,
      toneClassName: "bg-[rgba(255,255,255,0.14)]",
    },
    {
      label: t("stats.averageSuccess"),
      value: formatPercent(overallStats.avgSuccessRate, 1),
      hint: t("stats.averageSuccessHint"),
      icon: <TrendingUp className="size-4" />,
      toneClassName: "bg-[rgba(79,214,152,0.14)]",
    },
    {
      label: t("stats.exploration"),
      value: formatPercent(overallStats.avgExploration, 1),
      hint: t("stats.explorationHint"),
      icon: <Zap className="size-4" />,
      toneClassName: "bg-[rgba(255,177,74,0.14)]",
    },
  ]

  if (!desktopRuntime) {
    return (
      <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
        <GlassCard theme="surface" hover="none" className="border-[var(--hairline)] bg-[var(--panel-bg)]/78">
          <GlassCardHeader>
            <GlassCardTitle>{t("runtime.desktopOnlyTitle")}</GlassCardTitle>
            <GlassCardDescription>{t("runtime.desktopOnlyDescription")}</GlassCardDescription>
          </GlassCardHeader>
        </GlassCard>
      </Container>
    )
  }

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="space-y-5">
        <GlassCard
          theme="surface"
          hover="none"
          padding="none"
          className="overflow-hidden border-white/8 bg-[#0c1222] text-white shadow-[0_24px_72px_-28px_rgba(7,12,24,0.72)]"
        >
          <div className="relative overflow-hidden rounded-[var(--r-14)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,109,255,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(255,168,94,0.2),transparent_32%),linear-gradient(126deg,#0a1225_0%,#0f1f40_46%,#7d5049_118%)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="relative grid gap-6 p-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(540px,0.84fr)] xl:gap-10 xl:p-8">
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/8 px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.18em] text-white/80">
                    <Sparkles className="size-3.5" />
                    <span>{t("hero.eyebrow")}</span>
                  </div>
                  <GlassButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void mutate()}
                    className="h-8 rounded-full border border-white/12 bg-white/8 px-3 text-white/78 hover:bg-white/12 hover:text-white"
                  >
                    <RefreshCw className="size-3.5" />
                    {t("actions.refresh")}
                  </GlassButton>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white md:text-[3.05rem]">
                      {title}
                    </h1>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-medium text-white/72">
                      <Route className="size-3.5" />
                      {t("hero.runtimeTag")}
                    </span>
                  </div>
                  <p className="max-w-2xl text-sm leading-8 text-white/72 md:text-[15px]">
                    {t("hero.description")}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <HeroSelectorCard
                    label={t("hero.selectorScene")}
                    value={currentScene ? sceneLabel(currentScene.scene, t) : "--"}
                  />
                  <HeroSelectorCard
                    label={t("hero.selectorLeader")}
                    value={formatCompactIdentifier(getArmLabel(currentScene?.leader))}
                    accentDot={Boolean(currentScene?.leader)}
                  />
                  <HeroSelectorCard
                    label={t("hero.selectorStrategy")}
                    value={currentScene?.leader ? strategyLabel(currentScene.leader.strategy, t) : "--"}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {heroStats.map((stat) => (
                  <HeroMetricCard
                    key={stat.label}
                    label={stat.label}
                    value={stat.value}
                    hint={stat.hint}
                    icon={stat.icon}
                    toneClassName={stat.toneClassName}
                  />
                ))}
              </div>
            </div>
          </div>
        </GlassCard>

        {error ? (
          <GlassCard theme="surface" hover="none" className="border-[var(--danger-border)] bg-[var(--danger-soft)]/18">
            <GlassCardHeader>
              <GlassCardTitle className="text-[var(--danger)]">{t("runtime.loadFailedTitle")}</GlassCardTitle>
              <GlassCardDescription className="text-[var(--ink-2)]">
                {error instanceof Error ? error.message : t("runtime.loadFailedDescription")}
              </GlassCardDescription>
            </GlassCardHeader>
          </GlassCard>
        ) : null}

        {isLoading ? (
          <BanditLoadingState />
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-3">
              {sceneSummaries.map((summary) => (
                <SceneCard
                  key={summary.scene}
                  summary={summary}
                  locale={locale}
                  t={t}
                  active={summary.scene === currentScene.scene}
                  onSelect={() => setActiveScene(summary.scene)}
                />
              ))}
            </div>

            {!currentScene || currentScene.activeArms === 0 ? (
              <GlassCard theme="surface" hover="none" className="border-[var(--hairline)] bg-[var(--panel-bg)]/78">
                <GlassCardHeader>
                  <GlassCardTitle>{t("runtime.emptyTitle")}</GlassCardTitle>
                  <GlassCardDescription>{t("runtime.emptyDescription")}</GlassCardDescription>
                </GlassCardHeader>
              </GlassCard>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(340px,0.92fr)_minmax(0,1.16fr)]">
                <ScenePulseCard summary={currentScene} locale={locale} t={t} />
                <RecommendedArmCard summary={currentScene} locale={locale} t={t} />
                <ArmLeaderboardCard summary={currentScene} locale={locale} t={t} />
              </div>
            )}
          </>
        )}
      </div>
    </Container>
  )
}

function BanditLoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <GlassCard
            key={`bandit-scene-skel-${index}`}
            theme="surface"
            hover="none"
            className="h-[206px] animate-pulse border-[var(--hairline)] bg-[var(--panel-bg)]/60"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(340px,0.92fr)_minmax(0,1.16fr)]">
        {Array.from({ length: 3 }).map((_, index) => (
          <GlassCard
            key={`bandit-panel-skel-${index}`}
            theme="surface"
            hover="none"
            className="h-[440px] animate-pulse border-[var(--hairline)] bg-[var(--panel-bg)]/60"
          />
        ))}
      </div>
    </div>
  )
}

function SceneCard({
  summary,
  locale,
  t,
  active,
  onSelect,
}: {
  summary: SceneSummary
  locale: string
  t: ReturnType<typeof useTranslations>
  active: boolean
  onSelect: () => void
}) {
  const meta = SCENE_META[summary.scene]
  const Icon = meta.icon
  const status = getSceneStatus(summary, t)

  return (
    <GlassCard
      theme="surface"
      hover="lift"
      padding="none"
      className={cn(
        "border-[var(--hairline)] bg-[var(--panel-bg)]/78 shadow-[var(--elev-floating)]",
        active && "border-[var(--accent-border)] shadow-[0_18px_48px_-26px_rgba(109,92,255,0.42)]",
      )}
    >
      <div className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-11 items-center justify-center rounded-[var(--r-12)] border border-white/60",
                meta.iconClassName,
              )}
            >
              <Icon className="size-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">
                {sceneChip(summary.scene, t)}
              </div>
              <h2 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.03em] text-[var(--ink)]">
                {sceneLabel(summary.scene, t)}
              </h2>
            </div>
          </div>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <SceneMetric
            label={t("sceneCards.activity")}
            value={formatNumber(summary.activeArms, locale)}
          />
          <SceneMetric
            label={t("sceneCards.successRate")}
            value={formatPercent(summary.avgSuccessRate, 1)}
          />
          <SceneMetric
            label={t("sceneCards.exploration")}
            value={formatPercent(summary.meanEpsilon, 1)}
          />
        </div>

        <div
          className={cn(
            "mt-4 rounded-[var(--r-12)] border px-3.5 py-3",
            meta.tileClassName,
          )}
        >
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-3)]">
            {t("sceneCards.leader")}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-[var(--ink)]">
            {formatCompactIdentifier(getArmLabel(summary.leader))}
          </div>
        </div>

        <div className="mt-auto pt-5">
          <GlassButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSelect}
            className={cn(
              "w-full justify-center rounded-[var(--r-10)] px-0 text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]/55",
              active && "bg-[var(--accent-soft)]/42"
            )}
          >
            {t("actions.viewDetails")}
            <ArrowRight className="size-3.5" />
          </GlassButton>
        </div>
      </div>
    </GlassCard>
  )
}

function ScenePulseCard({
  summary,
  locale,
  t,
}: {
  summary: SceneSummary
  locale: string
  t: ReturnType<typeof useTranslations>
}) {
  const status = getSceneStatus(summary, t)

  return (
    <GlassCard theme="surface" hover="none" className="border-[var(--hairline)] bg-[var(--panel-bg)]/78 shadow-[var(--elev-floating)]">
      <GlassCardHeader className="space-y-2">
        <div className="flex items-center gap-2 text-[var(--accent-strong)]">
          <Activity className="size-4" />
          <GlassCardTitle className="text-[1.05rem]">{t("overview.title")}</GlassCardTitle>
        </div>
        <GlassCardDescription className="text-[var(--ink-2)]">
          {sceneLabel(summary.scene, t)} · {t("pulse.snapshot")}
        </GlassCardDescription>
      </GlassCardHeader>

      <GlassCardContent className="space-y-5 pt-0">
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricTile label={t("overview.totalTrials")} value={formatNumber(summary.totalTrials, locale)} />
          <MetricTile label={t("overview.leaderShare")} value={formatPercent(summary.dominantShare, 1)} />
          <MetricTile label={t("overview.exploration")} value={formatPercent(summary.meanEpsilon, 1)} />
          <MetricTile label={t("overview.avgSuccess")} value={formatPercent(summary.avgSuccessRate, 1)} />
        </div>

        <div className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[linear-gradient(180deg,rgba(109,92,255,0.06),rgba(42,127,255,0.02))] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-[var(--ink)]">{t("pulse.chartTitle")}</div>
            <span className="rounded-full border border-[var(--hairline)] bg-white/60 px-3 py-1 text-xs text-[var(--ink-2)]">
              {t("pulse.chartWindow")}
            </span>
          </div>
          <PulseChart summary={summary} locale={locale} />
        </div>

        <div className="space-y-3 rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/48 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-3)]">
                {t("overview.lastUpdated")}
              </div>
              <div className="mt-1 text-[1.3rem] font-semibold tracking-[-0.03em] text-[var(--ink)]">
                {formatTimestamp(summary.lastUpdated, locale)}
              </div>
            </div>
            <StatusPill tone={status.tone}>{healthLabel(status.tone, t)}</StatusPill>
          </div>
          <p className="text-sm leading-7 text-[var(--ink-2)]">{describeSceneState(summary, t)}</p>
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}

function RecommendedArmCard({
  summary,
  locale,
  t,
}: {
  summary: SceneSummary
  locale: string
  t: ReturnType<typeof useTranslations>
}) {
  const leader = summary.leader
  const posteriorMean = leader ? computePosteriorMean(leader) : null

  return (
    <GlassCard theme="surface" hover="none" className="border-[var(--hairline)] bg-[var(--panel-bg)]/78 shadow-[var(--elev-floating)]">
      <GlassCardHeader className="space-y-2">
        <div className="flex items-center gap-2 text-[var(--accent-strong)]">
          <Star className="size-4" />
          <GlassCardTitle className="text-[1.05rem]">{t("effect.title")}</GlassCardTitle>
        </div>
        <GlassCardDescription className="text-[var(--ink-2)]">
          {t("effect.description")}
        </GlassCardDescription>
      </GlassCardHeader>

      <GlassCardContent className="space-y-5 pt-0">
        <div className="space-y-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-3)]">
            {t("effect.leadingArm")}
          </div>
          <div className="break-all text-[2rem] font-semibold leading-[1.2] tracking-[-0.05em] text-[var(--ink)]">
            {leader ? leader.arm_id ?? leader.provider_model_id ?? leader.id : "--"}
          </div>
        </div>

        <div className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[linear-gradient(180deg,rgba(109,92,255,0.06),rgba(109,92,255,0.02))] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-3)]">
                {t("effect.strategy")}
              </div>
              <div className="mt-1 text-base font-semibold text-[var(--ink)]">
                {leader ? strategyLabel(leader.strategy, t) : "--"}
              </div>
            </div>
            <div className="flex size-9 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Activity className="size-4" />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label={t("effect.confidence")} value={formatPercent(posteriorMean, 1)} />
          <MetricTile label={t("effect.cooldowns")} value={formatNumber(summary.cooldownCount, locale)} />
          <MetricTile label={t("overview.exploration")} value={formatPercent(summary.meanEpsilon, 1)} />
        </div>

        <div className="rounded-[var(--r-14)] border border-[var(--ok-border)] bg-[var(--ok-soft)]/35 p-4">
          <div className="text-sm font-semibold text-[var(--ok)]">{t("recommend.adviceTitle")}</div>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-2)]">{describeSceneState(summary, t)}</p>
        </div>

        <Link
          href={`/${locale}/dashboard/task-learning`}
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--accent-strong)] transition-opacity hover:opacity-80"
        >
          {t("actions.openTaskLearning")}
          <ArrowRight className="size-3.5" />
        </Link>
      </GlassCardContent>
    </GlassCard>
  )
}

function ArmLeaderboardCard({
  summary,
  locale,
  t,
}: {
  summary: SceneSummary
  locale: string
  t: ReturnType<typeof useTranslations>
}) {
  const topArms = summary.arms.slice(0, 5)

  return (
    <GlassCard
      theme="surface"
      hover="none"
      className="border-[var(--hairline)] bg-[var(--panel-bg)]/78 shadow-[var(--elev-floating)]"
      id="arm-ranking"
    >
      <GlassCardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[var(--accent-strong)]">
            <TrendingUp className="size-4" />
            <GlassCardTitle className="text-[1.05rem]">{t("arms.title")}</GlassCardTitle>
          </div>
          <span className="text-sm font-medium text-[var(--accent-strong)]">{t("actions.viewAll")}</span>
        </div>
        <GlassCardDescription className="text-[var(--ink-2)]">
          {t("arms.description")}
        </GlassCardDescription>
      </GlassCardHeader>

      <GlassCardContent className="space-y-4 pt-0">
        {topArms.map((arm, index) => {
          const successRate = computeSuccessRate(arm)
          const posteriorMean = computePosteriorMean(arm)
          const coolingDown = isCoolingDown(arm)

          return (
            <div key={arm.id} className="space-y-2.5">
              <div className="flex items-start gap-3">
                <div className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", rankBadgeClassName(index))}>
                  {index + 1}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--ink)]">
                        {getArmLabel(arm)}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-3)]">
                        {t("leaderboard.trials", {
                          count: formatNumber(arm.total_trials, locale),
                          latency: formatLatency(computeAverageLatency(arm)),
                        })}
                      </div>
                    </div>
                    <StatusPill tone={coolingDown ? "warn" : arm.total_trials > 0 ? "ok" : "muted"}>
                      {coolingDown ? t("status.cooling") : arm.total_trials > 0 ? t("status.live") : t("status.idle")}
                    </StatusPill>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-4 text-sm">
                    <div className="font-semibold text-[var(--ink)]">{formatPercent(successRate, 1)}</div>
                    <div className="text-[var(--ink-3)]">
                      {t("leaderboard.posterior", { value: formatPercent(posteriorMean, 1) })}
                    </div>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-bg-inset)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-strong),var(--info))]"
                      style={{ width: `${Math.max(((successRate ?? posteriorMean ?? 0) * 100), 8)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </GlassCardContent>
    </GlassCard>
  )
}

function HeroMetricCard({
  label,
  value,
  hint,
  icon,
  toneClassName,
}: {
  label: string
  value: string
  hint: string
  icon: ReactNode
  toneClassName: string
}) {
  return (
    <div className="rounded-[var(--r-14)] border border-white/10 bg-white/7 p-4 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold tracking-[0.16em] text-white/58">{label}</div>
        <div className={cn("flex size-10 items-center justify-center rounded-full text-white/80", toneClassName)}>
          {icon}
        </div>
      </div>
      <div className="mt-3 text-[2.15rem] font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-2 text-xs leading-6 text-white/58">{hint}</div>
    </div>
  )
}

function HeroSelectorCard({
  label,
  value,
  accentDot = false,
}: {
  label: string
  value: string
  accentDot?: boolean
}) {
  return (
    <div className="rounded-[var(--r-14)] border border-white/10 bg-[#12203b]/78 p-4 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold tracking-[0.16em] text-white/56">{label}</div>
        {accentDot ? <span className="size-2 rounded-full bg-[#41d28d]" /> : <ChevronRight className="size-4 text-white/38" />}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="truncate text-[1.05rem] font-semibold tracking-[-0.03em] text-white">{value}</div>
      </div>
    </div>
  )
}

function SceneMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--ink-3)]">{label}</div>
      <div className="mt-1 text-[1.02rem] font-semibold text-[var(--ink)]">{value}</div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--r-12)] bg-[var(--panel-bg-inset)]/55 px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-3)]">{label}</div>
      <div className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">{value}</div>
    </div>
  )
}

function StatusPill({ tone, children }: { tone: SceneTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", statusPillClassName(tone))}>
      {children}
    </span>
  )
}

function PulseChart({
  summary,
  locale,
}: {
  summary: SceneSummary
  locale: string
}) {
  const series = buildPulseSeries(summary)
  const chartWidth = 440
  const chartHeight = 180
  const leftPadding = 10
  const bottomPadding = 18
  const drawableHeight = chartHeight - 16
  const stepX = (chartWidth - leftPadding * 2) / (series.length - 1)
  const points = series.map((value, index) => {
    const x = leftPadding + stepX * index
    const y = drawableHeight - value * (drawableHeight - bottomPadding)
    return { x, y }
  })
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ")
  const areaPath = [
    `M ${points[0]?.x ?? 0} ${drawableHeight}`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${points[points.length - 1]?.x ?? 0} ${drawableHeight}`,
    "Z",
  ].join(" ")
  const labels = [
    summary.lastUpdated ? formatTimestamp(summary.lastUpdated, locale) : "00:00",
    formatPercent(summary.avgSuccessRate, 0),
    formatPercent(summary.leader ? computePosteriorMean(summary.leader) : null, 0),
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[40px_1fr] gap-3">
        <div className="flex flex-col justify-between text-[11px] text-[var(--ink-3)]">
          <span>100%</span>
          <span>60%</span>
          <span>20%</span>
          <span>0%</span>
        </div>
        <div className="overflow-hidden rounded-[var(--r-12)] border border-white/50 bg-white/58">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="h-[180px] w-full text-[var(--accent-strong)]"
            preserveAspectRatio="none"
          >
            {[0.2, 0.4, 0.6, 0.8].map((mark) => (
              <line
                key={mark}
                x1="0"
                x2={chartWidth}
                y1={drawableHeight - mark * (drawableHeight - bottomPadding)}
                y2={drawableHeight - mark * (drawableHeight - bottomPadding)}
                stroke="rgba(20,21,28,0.08)"
                strokeDasharray="4 6"
              />
            ))}
            <path d={areaPath} fill="url(#bandit-area-fill)" opacity="0.32" />
            <polyline
              points={polyline}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient id="bandit-area-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(109,92,255,0.42)" />
                <stop offset="100%" stopColor="rgba(109,92,255,0.02)" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px] text-[var(--ink-3)]">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`} className={cn(index === 1 && "text-center", index === 2 && "text-right")}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function getSceneStatus(summary: SceneSummary, t: ReturnType<typeof useTranslations>) {
  if (summary.activeArms === 0) {
    return { tone: "muted" as const, label: t("sceneState.idle") }
  }
  if (summary.cooldownCount > 0) {
    return { tone: "warn" as const, label: t("sceneState.cooling") }
  }
  if (summary.meanEpsilon >= 0.12) {
    return { tone: "warn" as const, label: t("sceneState.exploring") }
  }
  return { tone: "ok" as const, label: t("sceneState.balanced") }
}

function describeSceneState(summary: SceneSummary, t: ReturnType<typeof useTranslations>) {
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

function sceneLabel(scene: KnownBanditScene, t: ReturnType<typeof useTranslations>) {
  return t(`scenes.${SCENE_META[scene].key}.name`)
}

function sceneChip(scene: KnownBanditScene, t: ReturnType<typeof useTranslations>) {
  return t(`scenes.${SCENE_META[scene].key}.chip`)
}

function strategyLabel(strategy: string | null | undefined, t: ReturnType<typeof useTranslations>) {
  if (!strategy) return t("strategy.unknown")
  if (strategy === "epsilon_greedy") return t("strategy.epsilonGreedy")
  if (strategy === "thompson") return t("strategy.thompson")
  if (strategy === "ucb") return t("strategy.ucb")
  return strategy
}

function getArmLabel(arm: LocalBanditArmState | null | undefined) {
  if (!arm) return "--"
  return arm.arm_id ?? arm.provider_model_id ?? arm.id
}

function buildPulseSeries(summary: SceneSummary) {
  const leaderRate = summary.leader ? computeSuccessRate(summary.leader) ?? 0.5 : summary.avgSuccessRate ?? 0.5
  const baseline = clamp((summary.avgSuccessRate ?? leaderRate) * 0.78 + leaderRate * 0.22, 0.18, 0.92)
  const volatility = clamp(summary.meanEpsilon * 0.42 + (summary.totalTrials < 12 ? 0.1 : 0.04), 0.04, 0.16)
  const dominanceLift = summary.dominantShare * 0.06
  const cooldownPenalty = summary.cooldownCount > 0 ? 0.08 : 0

  return Array.from({ length: 12 }, (_, index) => {
    const wave = Math.sin((index + 1) * 0.78) * volatility + Math.cos((index + 1) * 0.44) * (volatility * 0.42)
    const drift = ((index / 11) - 0.5) * (dominanceLift + 0.04)
    return clamp(baseline + wave + drift - cooldownPenalty, 0.14, 0.94)
  })
}

function statusPillClassName(tone: SceneTone) {
  if (tone === "ok") return "bg-[var(--ok-soft)] text-[var(--ok)]"
  if (tone === "warn") return "bg-[var(--warn-soft)] text-[var(--warn)]"
  if (tone === "accent") return "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
  return "bg-[var(--panel-bg-inset)] text-[var(--ink-3)]"
}

function healthLabel(tone: SceneTone, t: ReturnType<typeof useTranslations>) {
  if (tone === "ok") return t("health.healthy")
  if (tone === "warn") return t("health.watch")
  return t("health.idle")
}

function rankBadgeClassName(index: number) {
  if (index === 0) return "bg-[rgba(255,192,83,0.22)] text-[var(--warn)]"
  if (index === 1) return "bg-[rgba(107,176,255,0.18)] text-[var(--info)]"
  if (index === 2) return "bg-[rgba(255,170,122,0.2)] text-[#d46f3f]"
  return "bg-[var(--panel-bg-inset)] text-[var(--ink-3)]"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatCompactIdentifier(value: string) {
  if (!value || value === "--") return "--"
  if (value.length <= 18) return value
  return `${value.slice(0, 8)}...${value.slice(-4)}`
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
  return `${Math.round(value).toLocaleString()}ms`
}

function formatTimestamp(value: string | null | undefined, locale: string) {
  if (!value) return "--"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}
