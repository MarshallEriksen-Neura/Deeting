"use client"

import { type ReactNode, useMemo, useState } from "react"
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
    name: string
    chip: string
    description: string
    icon: typeof Route
  }
> = {
  "router:llm": {
    name: "Router LLM",
    chip: "路由",
    description: "观察模型路由层如何在候选模型间进行选择。",
    icon: Route,
  },
  "task_learning:route": {
    name: "Task Route",
    chip: "任务路由",
    description: "观察任务学习如何影响 route decision。",
    icon: BrainCircuit,
  },
  "task_learning:worker_selection": {
    name: "Worker Selection",
    chip: "执行选择",
    description: "观察不同 worker/action 的被选中与成功情况。",
    icon: Bot,
  },
  "memory:recall": {
    name: "Memory Recall",
    chip: "记忆召回",
    description: "观察记忆召回臂在成功率和探索率上的变化。",
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
            <CardTitle>仅桌面端可用</CardTitle>
            <CardDescription>Bandit 观测依赖本地 Tauri 状态，只在桌面运行时开放。</CardDescription>
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
                桌面端 Bandit 观测
              </div>

              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.05em] md:text-5xl">
                  {title}
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-white/75 md:text-base">
                  查看桌面端不同 bandit scene 的 arm 选择、探索率、成功率和冷却状态，并继续跳转到任务学习页做人工反馈。
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {sceneSummaries.map((summary) => {
                  const meta = SCENE_META[summary.scene]
                  const Icon = meta.icon
                  return (
                    <div key={summary.scene} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80">
                      <Icon className="size-3.5" />
                      <span>{meta.chip}</span>
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="ghost" size="sm" onClick={() => void mutate()} className="rounded-full border border-white/15 bg-white/10 px-4 text-white hover:bg-white/15">
                  <RefreshCw className="mr-1.5 size-3.5" />
                  刷新
                </Button>
                <a href="/dashboard/task-learning" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15">
                  <ArrowUpRight className="size-4" />
                  打开任务学习
                </a>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <HeroStat icon={<Target className="size-4" />} label="Scene 数" value={formatNumber(overallStats.totalScenes)} hint="当前已观测的 bandit scenes" />
              <HeroStat icon={<Activity className="size-4" />} label="Arm 数" value={formatNumber(overallStats.totalArms)} hint="所有 scene 下的 arm 总数" />
              <HeroStat icon={<TrendingUp className="size-4" />} label="Trials" value={formatNumber(overallStats.totalTrials)} hint="累计试验次数" />
              <HeroStat icon={<TimerReset className="size-4" />} label="Cooling" value={formatNumber(overallStats.cooldowns)} hint="当前处于冷却的 arm 数" />
              <HeroStat icon={<Gauge className="size-4" />} label="平均成功率" value={formatPercent(overallStats.avgSuccessRate, 1)} hint="按试验次数加权" />
              <HeroStat icon={<Zap className="size-4" />} label="平均探索率" value={formatPercent(overallStats.avgExploration, 1)} hint="所有 scenes 的 epsilon 平均值" />
            </div>
          </div>
        </Card>

        {error ? (
          <Card className="border-rose-200/80 bg-rose-50/70">
            <CardHeader>
              <CardTitle className="text-rose-800">加载失败</CardTitle>
              <CardDescription className="text-rose-700">{error instanceof Error ? error.message : "Bandit 数据加载失败"}</CardDescription>
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
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{meta.chip}</div>
                        <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-900">{meta.name}</div>
                      </div>
                      <div className="rounded-2xl bg-white/75 p-3 text-slate-700">
                        <Icon className="size-4" />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>Activity</span>
                      <span>{formatNumber(summary.totalTrials)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-700">{describeSceneState(summary)}</div>
                  </button>
                )
              })}
            </div>

            {!currentScene || currentScene.activeArms === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>当前 scene 没有可用 arm</CardTitle>
                  <CardDescription>等待本地运行时产生更多 bandit 试验后，这里会显示数据。</CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <>
                <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Activity className="size-4 text-sky-500" />
                        场景概览
                      </CardTitle>
                      <CardDescription>{SCENE_META[currentScene.scene].description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <MetricCell label="总试验数" value={formatNumber(currentScene.totalTrials)} />
                        <MetricCell label="Leader 占比" value={formatPercent(currentScene.dominantShare, 1)} />
                        <MetricCell label="平均探索率" value={formatPercent(currentScene.meanEpsilon, 1)} />
                        <MetricCell label="平均成功率" value={formatPercent(currentScene.avgSuccessRate, 1)} />
                      </div>

                      <div className="rounded-[26px] border border-slate-100 bg-slate-50/70 p-5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">最近更新时间</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">{formatTimestamp(currentScene.lastUpdated)}</div>
                        <p className="mt-3 text-sm leading-7 text-slate-600">{describeSceneState(currentScene)}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="size-4 text-amber-500" />
                        当前效果
                      </CardTitle>
                      <CardDescription>查看当前领先 arm、策略和冷却状态。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="rounded-[28px] border border-slate-100 bg-[linear-gradient(145deg,rgba(248,250,252,0.96),rgba(255,247,237,0.96))] p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">领先 arm</div>
                            <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-900">{currentScene.leader?.arm_id ?? "--"}</div>
                          </div>
                          <div className="rounded-[20px] bg-white/80 px-4 py-3 text-right shadow-sm">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">策略</div>
                            <div className="mt-1 text-sm font-semibold text-slate-800">{currentScene.leader ? currentScene.leader.strategy : "--"}</div>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <MetricCell label="置信度" value={formatPercent(currentScene.leader ? computePosteriorMean(currentScene.leader) : null, 1)} />
                          <MetricCell label="冷却数" value={formatNumber(currentScene.cooldownCount)} />
                        </div>
                      </div>

                      <div className="rounded-[26px] border border-dashed border-slate-200 bg-white/60 p-5 text-sm leading-7 text-slate-600">
                        {describeSceneState(currentScene)}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="size-4 text-indigo-500" />
                      Arm 详情
                    </CardTitle>
                    <CardDescription>查看当前 scene 下每个 arm 的成功率、后验均值、平均延迟和成本。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {currentScene.arms.map((arm) => (
                        <ArmCard key={arm.id} arm={arm} />
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

function ArmCard({ arm }: { arm: LocalBanditArmState }) {
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
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{arm.strategy}</div>
          <div className="mt-2 truncate text-lg font-semibold tracking-[-0.03em] text-slate-900">{armLabel}</div>
          <div className="mt-1 text-xs text-slate-500">reward metric: {rewardMetric}</div>
        </div>

        <Badge variant="outline" className={coolingDown ? "text-amber-700" : arm.total_trials > 0 ? "text-emerald-700" : "text-slate-500"}>
          {coolingDown ? "cooling" : arm.total_trials > 0 ? "live" : "idle"}
        </Badge>
      </div>

      <div className="mt-5 space-y-3">
        <ProgressMetric label="成功率" value={successRate} />
        <ProgressMetric label="后验均值" value={posteriorMean} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCell label="Trials" value={formatNumber(arm.total_trials)} />
        <MetricCell label="平均延迟" value={formatLatency(avgLatency)} />
        <MetricCell label="总成本" value={formatMoney(arm.total_cost)} />
        <MetricCell label="单次成本" value={formatMoney(computeCostPerTrial(arm))} />
        <MetricCell label="最近奖励" value={arm.last_reward.toFixed(3)} />
        <MetricCell label="冷却到" value={formatTimestamp(arm.cooldown_until)} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">alpha {arm.alpha.toFixed(1)} / beta {arm.beta.toFixed(1)}</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">version {arm.version}</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">updated {formatTimestamp(arm.updated_at)}</span>
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

function describeSceneState(summary: SceneSummary) {
  if (summary.activeArms === 0) return "当前 scene 还没有 traffic。"
  if (summary.cooldownCount > 0) return `有 ${summary.cooldownCount} 个 arm 正在冷却。`
  if (summary.totalTrials < 12) return `还在预热阶段，目前累计 ${summary.totalTrials} 次试验。`
  if (summary.dominantShare >= 0.58 && summary.leader?.arm_id) return `当前由 ${summary.leader.arm_id} 占据明显优势。`
  if (summary.meanEpsilon >= 0.15) return "系统还在积极探索更多 arm。"
  return "当前 scene 处于相对均衡的利用状态。"
}

function formatPercent(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--"
  return `${(value * 100).toFixed(digits)}%`
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--"
  return new Intl.NumberFormat("en-US").format(value)
}

function formatLatency(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "--"
  return `${Math.round(value)} ms`
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "--"
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "--"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}
