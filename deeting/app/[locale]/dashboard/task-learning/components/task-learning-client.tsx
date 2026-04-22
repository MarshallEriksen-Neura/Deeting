"use client"

import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react"
import { useLocale, useTranslations } from "next-intl"
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

function formatTime(unixMs: number | null | undefined, locale: string) {
  if (!unixMs) return "-"
  return new Date(unixMs).toLocaleString(locale)
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function sanitizeTaskPreview(value?: string | null) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function compactTaskPreview(value?: string | null) {
  return sanitizeTaskPreview(value)?.replace(/\s+/g, " ") ?? null
}

function taskFingerprintLabel(
  fingerprintKey: string,
  t: ReturnType<typeof useTranslations>,
) {
  return t("runs.taskLabel", { id: fingerprintKey.slice(0, 8) })
}

function signalLabel(
  signal: string | null | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  if (signal === "accepted") return t("runs.signals.accepted")
  if (signal === "corrected") return t("runs.signals.corrected")
  if (signal === "rejected") return t("runs.signals.rejected")
  if (signal === "silent") return t("runs.signals.silent")
  return t("runs.signals.unknown")
}

function deltaStateLabel(
  value: string | null | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  if (value === "none") return t("deltaStates.none")
  if (value === "provisional") return t("deltaStates.provisional")
  if (value === "applied") return t("deltaStates.applied")
  if (value === "superseded") return t("deltaStates.superseded")
  if (value === "rejected") return t("deltaStates.rejected")
  return value ?? "-"
}

function maturityLabel(
  value: string | null | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  if (value === "mature") return t("priors.maturityLabels.mature")
  if (value === "developing") return t("priors.maturityLabels.developing")
  if (value === "nascent") return t("priors.maturityLabels.nascent")
  if (value === "emerging") return t("priors.maturityLabels.emerging")
  if (value === "provisional") return t("priors.maturityLabels.provisional")
  if (value === "confirmed") return t("priors.maturityLabels.confirmed")
  return value ?? "-"
}

export function TaskLearningClient() {
  const t = useTranslations("task-learning")
  const locale = useLocale()
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
      toast.error(error instanceof Error ? error.message : t("feedback.loadFailed"))
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
    startTransition(() => {
      void getTaskLearningRun(runId)
        .then((next) => {
          setSelectedRunId(runId)
          setDetail(next)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("feedback.actionFailed"))
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
          toast.success(
            t("feedback.revised", {
              signal: signalLabel(signal, t),
            }),
          )
          return loadRuns(selectedRunId)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("feedback.actionFailed"))
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
          toast.success(t("feedback.replayed"))
          return loadRuns(selectedRunId)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("feedback.actionFailed"))
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
                {t("hero.eyebrow")}
              </div>

              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.04em] text-slate-900 md:text-4xl">
                  {t("hero.title")}
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                  {t("hero.description")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {[
                  { icon: Eye, label: t("hero.steps.review") },
                  { icon: ThumbsUp, label: t("hero.steps.feedback") },
                  { icon: Brain, label: t("hero.steps.learn") },
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
                { label: t("stats.totalRuns"), value: stats.total, hint: t("stats.totalRunsHint") },
                { label: t("stats.revisedRuns"), value: stats.revised, hint: t("stats.revisedRunsHint") },
                { label: t("stats.signaledRuns"), value: stats.signaled, hint: t("stats.signaledRunsHint") },
                { label: t("stats.activePriors"), value: stats.priors, hint: t("stats.activePriorsHint") },
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
            <Input
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.target.value)}
              placeholder={t("filters.sessionPlaceholder")}
              className="md:max-w-sm"
            />
            <select value={signalFilter} onChange={(event) => setSignalFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-slate-700">
              <option value="all">{t("filters.signal.all")}</option>
              <option value="accepted">{t("filters.signal.accepted")}</option>
              <option value="corrected">{t("filters.signal.corrected")}</option>
              <option value="rejected">{t("filters.signal.rejected")}</option>
              <option value="silent">{t("filters.signal.silent")}</option>
            </select>
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={() => void loadRuns()}>
                <RefreshCw className="mr-1.5 size-3.5" />
                {t("actions.refresh")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <BookOpen className="size-4 text-sky-500" />
                {t("runs.title")}
              </CardTitle>
              <CardDescription>{t("runs.description")}</CardDescription>
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
                  {t("runs.empty")}
                </div>
              ) : (
                <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
                  {runs.map((run) => {
                    const active = run.run_id === selectedRunId
                    const taskTitle =
                      compactTaskPreview(run.task_preview) ??
                      taskFingerprintLabel(run.fingerprint_key, t)
                    const fingerprintLabel = taskFingerprintLabel(run.fingerprint_key, t)
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
                            <div className="text-sm font-medium leading-6 text-slate-800 [display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                              {taskTitle}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>
                                {formatTime(
                                  run.last_revision_at_unix_ms ?? run.created_at_unix_ms,
                                  locale,
                                )}
                              </span>
                              <span className="rounded-lg border bg-slate-50/60 px-2 py-0.5">{fingerprintLabel}</span>
                            </div>
                          </div>
                          <Badge variant="outline">
                            {signalLabel(run.user_response_signal, t)}
                          </Badge>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                          <span className="rounded-lg border bg-slate-50/60 px-2 py-0.5">
                            {run.decision_point ?? t("runs.noDecision")}
                          </span>
                          {run.revision_count > 0 ? (
                            <span>{t("runs.revisions", { count: run.revision_count })}</span>
                          ) : null}
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
                    {t("detail.title")}
                  </CardTitle>
                  <CardDescription>{t("detail.description")}</CardDescription>
                </div>
                {isPending ? (
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    <LoaderCircle className="size-3 animate-spin" />
                    {t("detail.loading")}
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
                    <div className="text-sm font-medium text-slate-700">{t("detail.emptyTitle")}</div>
                    <div className="max-w-xs text-xs text-slate-500">{t("detail.empty")}</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-2xl border bg-slate-50/40 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {t("snapshot.title")}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                      {sanitizeTaskPreview(detail.task_preview) ??
                        taskFingerprintLabel(detail.fingerprint_key, t)}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-lg border bg-white/70 px-2 py-0.5">
                        {taskFingerprintLabel(detail.fingerprint_key, t)}
                      </span>
                      {detail.trace_id ? (
                        <span>{t("detail.revisionSource", { source: detail.trace_id.slice(0, 8) })}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoBlock label={t("detail.status")} value={deltaStateLabel(detail.delta_state, t)} />
                    <InfoBlock label={t("detail.signal")} value={signalLabel(currentSignal, t)} />
                    <InfoBlock label={t("meta.created")} value={formatTime(detail.created_at_unix_ms, locale)} />
                    <InfoBlock
                      label={t("meta.updated")}
                      value={formatTime(detail.last_revision_at_unix_ms, locale)}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">{t("guide.step1")}</h3>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={replaySelectedRun} disabled={isPending}>
                          <RotateCcw className="mr-1.5 size-3.5" />
                          {t("actions.replay")}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={t("detail.notePlaceholder")}
                      rows={3}
                    />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <ActionCard
                        tone="emerald"
                        icon={<ThumbsUp className="size-5" />}
                        title={t("actions.markAccepted")}
                        hint={t("actions.acceptedHint")}
                        onClick={() => applyRevision("accepted")}
                        disabled={isPending}
                      />
                      <ActionCard
                        tone="amber"
                        icon={<Wrench className="size-5" />}
                        title={t("actions.markCorrected")}
                        hint={t("actions.correctedHint")}
                        onClick={() => applyRevision("corrected")}
                        disabled={isPending}
                      />
                      <ActionCard
                        tone="rose"
                        icon={<ThumbsDown className="size-5" />}
                        title={t("actions.markRejected")}
                        hint={t("actions.rejectedHint")}
                        onClick={() => applyRevision("rejected")}
                        disabled={isPending}
                      />
                    </div>
                  </div>

                  <details className="rounded-2xl border bg-slate-50/40">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
                      {t("detail.toggleSnapshot")}
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
                    <h3 className="text-sm font-semibold text-slate-900">{t("detail.revisions")}</h3>
                    {detail.revisions.length === 0 ? (
                      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                        {t("detail.noRevisions")}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {detail.revisions.map((revision) => (
                          <div key={revision.id} className="rounded-2xl border bg-white/60 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                {revision.user_response_signal === "accepted" ? <CheckCircle2 className="size-4 text-emerald-600" /> : revision.user_response_signal === "corrected" ? <Wrench className="size-4 text-amber-600" /> : <XCircle className="size-4 text-rose-500" />}
                                <Badge variant="outline">
                                  {signalLabel(revision.user_response_signal, t)}
                                </Badge>
                              </div>
                              <div className="text-xs text-slate-400">
                                {formatTime(revision.created_at_unix_ms, locale)}
                              </div>
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              {t("detail.revisionSource", { source: revision.trigger_source })}
                            </div>
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
              {t("priors.title")}
            </CardTitle>
            <CardDescription>{t("priors.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {priors.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                {t("priors.empty")}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {priors.map((prior) => (
                  <div key={`${prior.fingerprint_key}:${prior.decision_point}:${prior.action_key}`} className="rounded-2xl border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800">{prior.decision_point}</div>
                      <Badge variant="outline">{maturityLabel(prior.maturity, t)}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {t("priors.actionLabel", { action: prior.action_key })}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">{t("priors.confidence")}</span>
                        <span className="font-medium text-slate-700">{Math.round(prior.confidence * 100)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/60">
                        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400" style={{ width: `${Math.round(prior.confidence * 100)}%` }} />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>{t("priors.evidenceCount", { count: prior.evidence_count })}</span>
                      <span>{formatTime(prior.updated_at_unix_ms, locale)}</span>
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

