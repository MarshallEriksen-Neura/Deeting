"use client"

import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react"
import {
  BookOpen,
  Brain,
  CheckCircle2,
  Eye,
  GraduationCap,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/shadcn/button"
import { Input } from "@/components/ui/shadcn/input"
import { Textarea } from "@/components/ui/shadcn/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/shadcn/card"
import { Badge } from "@/components/ui/shadcn/badge"
import { Container } from "@/components/ui/common/container"
import {
  getTaskLearningRun,
  listTaskLearningRuns,
  listTaskPolicyPriors,
  replayTaskLearningRun,
  reviseTaskLearningRun,
  type TaskLearningRunDetail,
  type TaskLearningRunListItem,
} from "@/lib/api/task-learning"

function formatTime(unixMs?: number | null) {
  if (!unixMs) return "-"
  return new Date(unixMs).toLocaleString("zh-CN")
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function TaskLearningClient() {
  const [runs, setRuns] = useState<TaskLearningRunListItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TaskLearningRunDetail | null>(null)
  const [priors, setPriors] = useState<
    Array<{
      fingerprint_key: string
      decision_point: string
      action_key: string
      weight: number
      confidence: number
      evidence_count: number
      maturity: string
      updated_at_unix_ms: number
    }>
  >([])
  const [sessionFilter, setSessionFilter] = useState("")
  const [signalFilter, setSignalFilter] = useState("all")
  const [note, setNote] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [showSnapshot, setShowSnapshot] = useState(false)

  async function loadRuns(preferredRunId?: string | null) {
    setIsLoading(true)
    try {
      const [runResponse, priorResponse] = await Promise.all([
        listTaskLearningRuns({
          limit: 60,
          session_id: sessionFilter.trim() || null,
          user_response_signal: signalFilter === "all" ? null : signalFilter,
        }),
        listTaskPolicyPriors({ limit: 40 }),
      ])

      setRuns(runResponse.items)
      setPriors(priorResponse.items)

      const nextRunId = preferredRunId ?? selectedRunId ?? runResponse.items[0]?.run_id ?? null
      setSelectedRunId(nextRunId)
      if (nextRunId) {
        const nextDetail = await getTaskLearningRun(nextRunId)
        setDetail(nextDetail)
      } else {
        setDetail(null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载任务学习数据失败")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    const revised = runs.filter((item) => item.revision_count > 0).length
    const signaled = runs.filter(
      (item) => item.user_response_signal && !["silent", "unknown"].includes(item.user_response_signal),
    ).length
    return {
      total: runs.length,
      revised,
      signaled,
      priors: priors.length,
    }
  }, [priors.length, runs])

  const currentSignal = detail
    ? String((detail.outcome as Record<string, unknown>)?.user_response_signal ?? "silent")
    : null

  function selectRun(runId: string) {
    setShowSnapshot(false)
    startTransition(() => {
      void getTaskLearningRun(runId)
        .then((next) => {
          setSelectedRunId(runId)
          setDetail(next)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : "加载详情失败")
        })
    })
  }

  function applyRevision(signal: "accepted" | "corrected" | "rejected") {
    if (!selectedRunId) return
    startTransition(() => {
      void reviseTaskLearningRun({
        run_id: selectedRunId,
        user_response_signal: signal,
        note: note.trim() || null,
        trigger_source: "dashboard_manual_revision",
      })
        .then((next) => {
          setDetail(next)
          setNote("")
          toast.success(`已标记为 ${signal}`)
          return loadRuns(selectedRunId)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : "修订失败")
        })
    })
  }

  function replaySelectedRun() {
    if (!selectedRunId) return
    startTransition(() => {
      void replayTaskLearningRun({ run_id: selectedRunId, note: note.trim() || null })
        .then((next) => {
          setDetail(next)
          setNote("")
          toast.success("已触发重放")
          return loadRuns(selectedRunId)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : "重放失败")
        })
    })
  }

  return (
    <Container as="main" gutter="md" size="full" className="py-6 md:py-8 !mx-0 !max-w-none">
      <div className="space-y-6">
        <Card className="overflow-hidden border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(245,248,255,0.72)_48%,rgba(240,250,255,0.62)_100%)]">
          <div className="grid gap-8 p-7 lg:grid-cols-[1.3fr_0.9fr] lg:p-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                <GraduationCap className="size-3.5 text-sky-500" />
                桌面端任务学习
              </div>

              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.04em] text-slate-900 md:text-4xl">
                  观察模型如何学会下一次更好地处理任务
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                  这里展示桌面端本地任务学习运行、人工修订和策略先验，不引入云端监控或管理页。
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {[
                  { icon: Eye, label: "查看运行" },
                  { icon: ThumbsUp, label: "给出反馈" },
                  { icon: Brain, label: "形成先验" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="inline-flex items-center gap-2 rounded-full border bg-white/72 px-3.5 py-2 text-xs font-medium text-slate-600">
                    <Icon className="size-3.5 text-sky-500" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
              {[
                { label: "总运行数", value: stats.total, hint: "当前列表中的学习运行" },
                { label: "已修订", value: stats.revised, hint: "至少被人工改写一次" },
                { label: "已打信号", value: stats.signaled, hint: "明确给了 accepted/corrected/rejected" },
                { label: "活跃先验", value: stats.priors, hint: "当前可见的策略先验条目" },
              ].map((metric) => (
                <div key={metric.label} className="rounded-[1.5rem] border bg-white/74 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {metric.label}
                  </div>
                  <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-900">
                    {metric.value}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{metric.hint}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <Input value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} placeholder="按 session_id 过滤" className="md:max-w-sm" />
            <select value={signalFilter} onChange={(event) => setSignalFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-slate-700">
              <option value="all">全部信号</option>
              <option value="accepted">accepted</option>
              <option value="corrected">corrected</option>
              <option value="rejected">rejected</option>
              <option value="silent">silent</option>
            </select>
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={() => void loadRuns()}>
                <RefreshCw className="mr-1.5 size-3.5" />
                刷新
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <BookOpen className="size-4 text-sky-500" />
                运行列表
              </CardTitle>
              <CardDescription>按任务指纹、反馈信号和最近修订时间查看本地学习运行。</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <div className="h-20 animate-pulse rounded-2xl bg-muted" />
                  <div className="h-20 animate-pulse rounded-2xl bg-muted" />
                  <div className="h-20 animate-pulse rounded-2xl bg-muted" />
                </div>
              ) : runs.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                  没有找到符合条件的学习运行。
                </div>
              ) : (
                <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
                  {runs.map((run) => {
                    const active = run.run_id === selectedRunId
                    return (
                      <button
                        key={run.run_id}
                        type="button"
                        onClick={() => selectRun(run.run_id)}
                        className={[
                          "w-full rounded-2xl border p-4 text-left transition-all duration-200",
                          active ? "border-sky-300/80 bg-sky-50/60" : "border-white/60 bg-white/60 hover:border-sky-200/60 hover:bg-sky-50/30",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-slate-800">任务 {run.fingerprint_key.slice(0, 8)}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{formatTime(run.last_revision_at_unix_ms ?? run.created_at_unix_ms)}</div>
                          </div>
                          <Badge variant="outline">{run.user_response_signal ?? "silent"}</Badge>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                          <span className="rounded-lg border bg-slate-50/60 px-2 py-0.5">{run.decision_point ?? "无 decision point"}</span>
                          {run.revision_count > 0 ? <span>修订 {run.revision_count} 次</span> : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-slate-900">
                    <Brain className="size-4 text-indigo-500" />
                    运行详情
                  </CardTitle>
                  <CardDescription>查看指纹、路由、执行策略、结果与修订历史。</CardDescription>
                </div>
                {isPending ? (
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    <LoaderCircle className="size-3 animate-spin" />
                    加载中
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {!detail ? (
                <div className="flex flex-col items-center gap-4 py-16 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl border bg-slate-50/70">
                    <Eye className="size-6 text-slate-400" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-slate-700">还没有选中运行</div>
                    <div className="max-w-xs text-xs text-slate-500">从左侧列表中选一条运行，查看任务学习的完整链路。</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoBlock label="当前状态" value={detail.delta_state} />
                    <InfoBlock label="当前信号" value={currentSignal ?? "silent"} />
                    <InfoBlock label="创建时间" value={formatTime(detail.created_at_unix_ms)} />
                    <InfoBlock label="最近修订" value={formatTime(detail.last_revision_at_unix_ms)} />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">人工反馈</h3>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={replaySelectedRun} disabled={isPending}>
                          <RotateCcw className="mr-1.5 size-3.5" />
                          重放
                        </Button>
                      </div>
                    </div>
                    <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充你为什么接受、修正或拒绝这次运行。" rows={3} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <ActionCard tone="emerald" icon={<ThumbsUp className="size-5" />} title="accepted" hint="这次处理方式正确，可强化" onClick={() => applyRevision("accepted")} disabled={isPending} />
                      <ActionCard tone="amber" icon={<Wrench className="size-5" />} title="corrected" hint="方向可用，但需要修改" onClick={() => applyRevision("corrected")} disabled={isPending} />
                      <ActionCard tone="rose" icon={<ThumbsDown className="size-5" />} title="rejected" hint="这次策略不该继续沿用" onClick={() => applyRevision("rejected")} disabled={isPending} />
                    </div>
                  </div>

                  <details className="rounded-2xl border bg-slate-50/40">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
                      原始快照与策略数据
                    </summary>
                    <div className="border-t px-4 py-4 text-xs">
                      <pre className="max-h-[22rem] overflow-auto rounded-xl bg-slate-900 p-4 text-slate-200">{prettyJson({
                        task_fingerprint: detail.task_fingerprint,
                        route_decision: detail.route_decision,
                        execution_policy: detail.execution_policy,
                        outcome: detail.outcome,
                        attribution: detail.attribution,
                        policy_delta: detail.policy_delta,
                        trace_feedback: detail.trace_feedback,
                      })}</pre>
                    </div>
                  </details>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">修订历史</h3>
                    {detail.revisions.length === 0 ? (
                      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">还没有修订历史。</div>
                    ) : (
                      <div className="space-y-3">
                        {detail.revisions.map((revision) => (
                          <div key={revision.id} className="rounded-2xl border bg-white/60 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                {revision.user_response_signal === "accepted" ? <CheckCircle2 className="size-4 text-emerald-600" /> : revision.user_response_signal === "corrected" ? <Wrench className="size-4 text-amber-600" /> : <XCircle className="size-4 text-rose-500" />}
                                <Badge variant="outline">{revision.user_response_signal}</Badge>
                              </div>
                              <div className="text-xs text-slate-400">{formatTime(revision.created_at_unix_ms)}</div>
                            </div>
                            <div className="mt-2 text-xs text-slate-500">来源：{revision.trigger_source}</div>
                            {revision.note ? <div className="mt-2 rounded-xl border bg-slate-50/50 p-3 text-sm text-slate-700">{revision.note}</div> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900">
              <Brain className="size-4 text-emerald-500" />
              策略先验
            </CardTitle>
            <CardDescription>当前桌面端任务学习已经形成的动作偏好与置信度。</CardDescription>
          </CardHeader>
          <CardContent>
            {priors.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">还没有形成可展示的先验。</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {priors.map((prior) => (
                  <div key={`${prior.fingerprint_key}:${prior.decision_point}:${prior.action_key}`} className="rounded-2xl border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800">{prior.decision_point}</div>
                      <Badge variant="outline">{prior.maturity}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">动作：{prior.action_key}</div>
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">置信度</span>
                        <span className="font-medium text-slate-700">{Math.round(prior.confidence * 100)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/60">
                        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400" style={{ width: `${Math.round(prior.confidence * 100)}%` }} />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>证据 {prior.evidence_count} 条</span>
                      <span>{formatTime(prior.updated_at_unix_ms)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Container>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-slate-50/40 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-medium text-slate-800">{value}</div>
    </div>
  )
}

function ActionCard({
  tone,
  icon,
  title,
  hint,
  onClick,
  disabled,
}: {
  tone: "emerald" | "amber" | "rose"
  icon: ReactNode
  title: string
  hint: string
  onClick: () => void
  disabled?: boolean
}) {
  const toneClass = tone === "emerald"
    ? "border-emerald-200/80 bg-emerald-50/50 text-emerald-800"
    : tone === "amber"
      ? "border-amber-200/80 bg-amber-50/50 text-amber-800"
      : "border-rose-200/80 bg-rose-50/50 text-rose-800"

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`flex flex-col items-center gap-2.5 rounded-2xl border p-5 transition-all disabled:opacity-50 ${toneClass}`}>
      <div>{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-center text-[11px] leading-4 opacity-80">{hint}</div>
    </button>
  )
}

