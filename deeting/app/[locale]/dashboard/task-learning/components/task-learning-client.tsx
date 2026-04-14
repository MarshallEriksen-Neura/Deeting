"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Code2,
  Eye,
  GraduationCap,
  LoaderCircle,
  MessageSquareHeart,
  RefreshCw,
  RotateCcw,
  Route,
  Shield,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import {
  getTaskLearningRun,
  listTaskLearningRuns,
  listTaskPolicyPriors,
  replayTaskLearningRun,
  reviseTaskLearningRun,
  type TaskLearningRunDetail,
  type TaskLearningRunListItem,
} from "@/lib/api/task-learning"

type Translation = (key: string, values?: Record<string, string | number>) => string

function formatTime(unixMs?: number | null) {
  if (!unixMs) return "—"
  return new Date(unixMs).toLocaleString()
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function signalIcon(signal: string | null | undefined) {
  switch (signal) {
    case "accepted":
      return <CheckCircle2 className="size-4 text-emerald-600" />
    case "corrected":
      return <Wrench className="size-4 text-amber-600" />
    case "rejected":
      return <XCircle className="size-4 text-rose-500" />
    default:
      return <Eye className="size-4 text-slate-400" />
  }
}

function signalPalette(signal: string | null | undefined) {
  switch (signal) {
    case "accepted":
      return {
        bg: "bg-emerald-50/80",
        border: "border-emerald-200/80",
        text: "text-emerald-700",
        dot: "bg-emerald-500",
      }
    case "corrected":
      return {
        bg: "bg-amber-50/80",
        border: "border-amber-200/80",
        text: "text-amber-700",
        dot: "bg-amber-500",
      }
    case "rejected":
      return {
        bg: "bg-rose-50/80",
        border: "border-rose-200/80",
        text: "text-rose-700",
        dot: "bg-rose-500",
      }
    default:
      return {
        bg: "bg-slate-50/80",
        border: "border-slate-200/80",
        text: "text-slate-600",
        dot: "bg-slate-400",
      }
  }
}

export function TaskLearningClient() {
  const t = useTranslations("task-learning") as unknown as Translation
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
  const [reviewStep, setReviewStep] = useState(0)

  const loadRuns = async (preferredRunId?: string | null) => {
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

      const nextRunId =
        preferredRunId ??
        selectedRunId ??
        (runResponse.items.length > 0 ? runResponse.items[0].run_id : null)
      setSelectedRunId(nextRunId)
      if (nextRunId) {
        const nextDetail = await getTaskLearningRun(nextRunId)
        setDetail(nextDetail)
      } else {
        setDetail(null)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("feedback.loadFailed")
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectRun = (runId: string) => {
    setReviewStep(0)
    setShowSnapshot(false)
    startTransition(() => {
      void getTaskLearningRun(runId)
        .then((next) => {
          setSelectedRunId(runId)
          setDetail(next)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("feedback.loadFailed"))
        })
    })
  }

  const applyRevision = (signal: "accepted" | "corrected" | "rejected") => {
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
          toast.success(t("feedback.revised", { signal }))
          return loadRuns(selectedRunId)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("feedback.actionFailed"))
        })
    })
  }

  const replaySelectedRun = () => {
    if (!selectedRunId) return
    startTransition(() => {
      void replayTaskLearningRun({
        run_id: selectedRunId,
        note: note.trim() || null,
      })
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

  const stats = useMemo(() => {
    const revised = runs.filter((item) => item.revision_count > 0).length
    const signaled = runs.filter(
      (item) =>
        item.user_response_signal &&
        !["silent", "unknown"].includes(item.user_response_signal),
    ).length
    return {
      total: runs.length,
      revised,
      signaled,
      priors: priors.length,
    }
  }, [priors.length, runs])

  const currentSignal = detail
    ? String(
        (detail.outcome as Record<string, unknown>)?.user_response_signal ?? "silent",
      )
    : null

  return (
    <div className="space-y-6">
      {/* ── Hero Section ── */}
      <GlassCard
        blur="xl"
        theme="surface"
        hover="none"
        className="overflow-hidden border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(245,248,255,0.72)_48%,rgba(240,250,255,0.62)_100%)] shadow-[0_30px_90px_-42px_rgba(16,24,40,0.42)]"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-10 top-0 h-32 w-32 rounded-full bg-sky-400/18 blur-3xl" />
          <div className="absolute right-4 top-8 h-36 w-36 rounded-full bg-indigo-300/16 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-white/70" />
        </div>

        <div className="relative grid gap-8 p-7 lg:grid-cols-[1.3fr_0.9fr] lg:p-8">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 shadow-sm backdrop-blur-xl">
              <GraduationCap className="size-3.5 text-sky-500" />
              {t("hero.eyebrow")}
            </div>

            <div className="space-y-3">
              <h1 className="max-w-3xl font-serif text-3xl leading-tight tracking-[-0.04em] text-slate-900 md:text-4xl">
                {t("hero.title")}
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                {t("hero.description")}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {[
                { icon: Eye, label: t("hero.steps.review") },
                { icon: MessageSquareHeart, label: t("hero.steps.feedback") },
                { icon: Brain, label: t("hero.steps.learn") },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/72 px-3.5 py-2 text-xs font-medium text-slate-600 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl"
                >
                  <Icon className="size-3.5 text-sky-500" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
            {[
              {
                label: t("stats.totalRuns"),
                value: stats.total,
                hint: t("stats.totalRunsHint"),
              },
              {
                label: t("stats.revisedRuns"),
                value: stats.revised,
                hint: t("stats.revisedRunsHint"),
              },
              {
                label: t("stats.signaledRuns"),
                value: stats.signaled,
                hint: t("stats.signaledRunsHint"),
              },
              {
                label: t("stats.activePriors"),
                value: stats.priors,
                hint: t("stats.activePriorsHint"),
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-[1.5rem] border border-white/60 bg-white/74 p-4 shadow-[0_14px_36px_-24px_rgba(15,23,42,0.3)] backdrop-blur-xl"
              >
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
      </GlassCard>

      {/* ── Filter Bar ── */}
      <GlassCard blur="lg" theme="surface" hover="none" padding="sm" className="border-white/15 bg-white/80">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={sessionFilter}
            onChange={(event) => setSessionFilter(event.target.value)}
            placeholder={t("filters.sessionPlaceholder")}
            className="border-white/60 bg-white/50 md:max-w-sm"
          />
          <select
            value={signalFilter}
            onChange={(event) => setSignalFilter(event.target.value)}
            className="h-10 rounded-xl border border-white/60 bg-white/50 px-3 text-sm text-slate-700"
          >
            <option value="all">{t("filters.signal.all")}</option>
            <option value="accepted">{t("filters.signal.accepted")}</option>
            <option value="corrected">{t("filters.signal.corrected")}</option>
            <option value="rejected">{t("filters.signal.rejected")}</option>
            <option value="silent">{t("filters.signal.silent")}</option>
          </select>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadRuns()}
              className="rounded-full border border-white/60 bg-white/70 px-4 text-slate-600 shadow-sm"
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              {t("actions.refresh")}
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* ── Main Two-Column Area ── */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
        {/* ── Left: Task List ── */}
        <GlassCard
          blur="lg"
          theme="surface"
          hover="none"
          className="overflow-hidden border-white/15 bg-white/80"
        >
          <GlassCardHeader className="border-b border-white/60 p-5 pb-4">
            <div className="flex items-center justify-between">
              <GlassCardTitle className="flex items-center gap-2 text-slate-900">
                <BookOpen className="size-4 text-sky-500" />
                {t("runs.title")}
              </GlassCardTitle>
              <span className="text-xs text-slate-400">{runs.length}</span>
            </div>
            <GlassCardDescription className="text-slate-500">
              {t("runs.description")}
            </GlassCardDescription>
          </GlassCardHeader>

          <GlassCardContent className="p-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-20 w-full rounded-2xl" />
              </div>
            ) : runs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                {t("runs.empty")}
              </div>
            ) : (
              <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
                {runs.map((run) => {
                  const active = run.run_id === selectedRunId
                  const palette = signalPalette(run.user_response_signal)

                  return (
                    <button
                      key={run.run_id}
                      type="button"
                      onClick={() => selectRun(run.run_id)}
                      className={[
                        "w-full rounded-2xl border p-4 text-left transition-all duration-200",
                        active
                          ? "border-sky-300/80 bg-sky-50/60 shadow-[0_12px_32px_-16px_rgba(14,165,233,0.2)]"
                          : "border-white/60 bg-white/60 hover:border-sky-200/60 hover:bg-sky-50/30",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          {signalIcon(run.user_response_signal)}
                          <div>
                            <div className="text-sm font-medium text-slate-800">
                              {t("runs.taskLabel", {
                                id: run.fingerprint_key.slice(0, 8),
                              })}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {formatTime(
                                run.last_revision_at_unix_ms ?? run.created_at_unix_ms,
                              )}
                            </div>
                          </div>
                        </div>
                        <span
                          className={[
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                            palette.border,
                            palette.bg,
                            palette.text,
                          ].join(" ")}
                        >
                          <span className={["inline-block size-1.5 rounded-full", palette.dot].join(" ")} />
                          {t(`runs.signals.${run.user_response_signal ?? "silent"}`)}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-0.5">
                          {run.decision_point ?? t("runs.noDecision")}
                        </span>
                        {run.revision_count > 0 && (
                          <span className="text-slate-400">
                            {t("runs.revisions", { count: run.revision_count })}
                          </span>
                        )}
                      </div>

                      {active && (
                        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-sky-600">
                          {t("runs.viewing")}
                          <ChevronRight className="size-3" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </GlassCardContent>
        </GlassCard>

        {/* ── Right: Inspector / Review Panel ── */}
        <GlassCard
          blur="lg"
          theme="surface"
          hover="none"
          className="overflow-hidden border-white/15 bg-white/80"
        >
          <GlassCardHeader className="border-b border-white/60 p-5 pb-4">
            <div className="flex items-center justify-between">
              <GlassCardTitle className="flex items-center gap-2 text-slate-900">
                <Sparkles className="size-4 text-indigo-500" />
                {t("detail.title")}
              </GlassCardTitle>
              {isPending && (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <LoaderCircle className="size-3 animate-spin" />
                  {t("detail.loading")}
                </span>
              )}
            </div>
            <GlassCardDescription className="text-slate-500">
              {t("detail.description")}
            </GlassCardDescription>
          </GlassCardHeader>

          <GlassCardContent className="p-5">
            {!detail ? (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50/70">
                  <Eye className="size-6 text-slate-400" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-700">
                    {t("detail.emptyTitle")}
                  </div>
                  <div className="max-w-xs text-xs text-slate-500">
                    {t("detail.empty")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* ── Guided Review Steps ── */}
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((step) => (
                    <button
                      key={step}
                      type="button"
                      onClick={() => setReviewStep(step)}
                      className={[
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                        reviewStep === step
                          ? "border-sky-300/80 bg-sky-50/70 text-sky-700"
                          : "border-white/60 bg-white/50 text-slate-500 hover:bg-sky-50/40",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex size-4 items-center justify-center rounded-full text-[10px] font-bold",
                          reviewStep === step ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-500",
                        ].join(" ")}
                      >
                        {step + 1}
                      </span>
                      {t(`guide.step${step}`)}
                    </button>
                  ))}
                </div>

                {/* ── Step 0: Overview ── */}
                {reviewStep === 0 && (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 text-sm leading-7 text-slate-600">
                      {t("guide.step0Hint")}
                    </div>

                    {/* Status + Signal row */}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {t("detail.status")}
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <div className="flex items-center gap-2">
                            <DeltaStatePill state={detail.delta_state} t={t} />
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatTime(
                              detail.last_revision_at_unix_ms ?? detail.created_at_unix_ms,
                            )}
                          </div>
                          <div className="text-xs text-slate-500">
                            {t("runs.revisions", { count: detail.revision_count })}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {t("detail.signal")}
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2 text-sm text-slate-700">
                            {signalIcon(currentSignal)}
                            <span>{t(`runs.signals.${currentSignal ?? "silent"}`)}</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            {String(
                              (detail.outcome as Record<string, unknown>)
                                ?.verification_result ?? "—",
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Structured snapshot breakdown */}
                    <SnapshotBreakdown detail={detail} t={t} />

                    {/* Raw JSON toggle for advanced users */}
                    <button
                      type="button"
                      onClick={() => setShowSnapshot(!showSnapshot)}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-sky-600"
                    >
                      <Code2 className="size-3.5" />
                      <ChevronRight
                        className={[
                          "size-3 transition-transform",
                          showSnapshot ? "rotate-90" : "",
                        ].join(" ")}
                      />
                      {t("detail.toggleSnapshot")}
                    </button>

                    {showSnapshot && (
                      <pre className="max-h-[16rem] overflow-auto rounded-2xl border border-slate-200/80 bg-slate-900 p-4 text-xs leading-5 text-slate-200">
                        {prettyJson({
                          task_fingerprint: detail.task_fingerprint,
                          route_decision: detail.route_decision,
                          execution_policy: detail.execution_policy,
                          outcome: detail.outcome,
                          attribution: detail.attribution,
                          policy_delta: detail.policy_delta,
                          trace_feedback: detail.trace_feedback,
                        })}
                      </pre>
                    )}

                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReviewStep(1)}
                        className="rounded-full border border-sky-200 bg-sky-50/70 px-4 text-sky-700 hover:bg-sky-100/70"
                      >
                        {t("guide.nextStep")}
                        <ChevronRight className="ml-1 size-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Step 1: Give Feedback ── */}
                {reviewStep === 1 && (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-4 text-sm leading-7 text-indigo-900">
                      {t("guide.step1Hint")}
                    </div>

                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={t("detail.notePlaceholder")}
                      rows={3}
                      className="rounded-xl border-white/60 bg-white/50"
                    />

                    <div className="grid gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => applyRevision("accepted")}
                        className="group flex flex-col items-center gap-2.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-5 transition-all hover:border-emerald-300 hover:bg-emerald-50/80 hover:shadow-[0_12px_28px_-12px_rgba(16,185,129,0.25)] disabled:opacity-50"
                      >
                        <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 transition-transform group-hover:scale-110">
                          <ThumbsUp className="size-5" />
                        </div>
                        <div className="text-sm font-medium text-emerald-800">
                          {t("actions.markAccepted")}
                        </div>
                        <div className="text-center text-[11px] leading-4 text-emerald-600/80">
                          {t("actions.acceptedHint")}
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => applyRevision("corrected")}
                        className="group flex flex-col items-center gap-2.5 rounded-2xl border border-amber-200/80 bg-amber-50/50 p-5 transition-all hover:border-amber-300 hover:bg-amber-50/80 hover:shadow-[0_12px_28px_-12px_rgba(217,119,6,0.2)] disabled:opacity-50"
                      >
                        <div className="flex size-11 items-center justify-center rounded-xl bg-amber-100 text-amber-600 transition-transform group-hover:scale-110">
                          <Wrench className="size-5" />
                        </div>
                        <div className="text-sm font-medium text-amber-800">
                          {t("actions.markCorrected")}
                        </div>
                        <div className="text-center text-[11px] leading-4 text-amber-600/80">
                          {t("actions.correctedHint")}
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => applyRevision("rejected")}
                        className="group flex flex-col items-center gap-2.5 rounded-2xl border border-rose-200/80 bg-rose-50/50 p-5 transition-all hover:border-rose-300 hover:bg-rose-50/80 hover:shadow-[0_12px_28px_-12px_rgba(225,29,72,0.2)] disabled:opacity-50"
                      >
                        <div className="flex size-11 items-center justify-center rounded-xl bg-rose-100 text-rose-500 transition-transform group-hover:scale-110">
                          <ThumbsDown className="size-5" />
                        </div>
                        <div className="text-sm font-medium text-rose-800">
                          {t("actions.markRejected")}
                        </div>
                        <div className="text-center text-[11px] leading-4 text-rose-500/80">
                          {t("actions.rejectedHint")}
                        </div>
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReviewStep(0)}
                        className="rounded-full border border-white/60 bg-white/70 px-4 text-slate-600"
                      >
                        {t("guide.prevStep")}
                      </Button>

                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={replaySelectedRun}
                          className="rounded-full border border-slate-200 bg-white/70 px-4 text-slate-600"
                        >
                          <RotateCcw className="mr-1.5 size-3.5" />
                          {t("actions.replay")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReviewStep(2)}
                          className="rounded-full border border-sky-200 bg-sky-50/70 px-4 text-sky-700 hover:bg-sky-100/70"
                        >
                          {t("guide.nextStep")}
                          <ChevronRight className="ml-1 size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Step 2: History ── */}
                {reviewStep === 2 && (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4 text-sm leading-7 text-emerald-900">
                      {t("guide.step2Hint")}
                    </div>

                    <div className="max-h-[22rem] space-y-3 overflow-auto pr-1">
                      {detail.revisions.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                          {t("detail.noRevisions")}
                        </div>
                      ) : (
                        detail.revisions.map((revision) => {
                          const pal = signalPalette(revision.user_response_signal)
                          return (
                            <div
                              key={revision.id}
                              className="rounded-2xl border border-white/60 bg-white/60 p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  {signalIcon(revision.user_response_signal)}
                                  <span
                                    className={[
                                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
                                      pal.border,
                                      pal.bg,
                                      pal.text,
                                    ].join(" ")}
                                  >
                                    {t(`runs.signals.${revision.user_response_signal}`)}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-400">
                                  {formatTime(revision.created_at_unix_ms)}
                                </div>
                              </div>
                              <div className="mt-2 text-xs text-slate-500">
                                {t("detail.revisionSource", {
                                  source: revision.trigger_source,
                                })}
                              </div>
                              {revision.note && (
                                <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-700">
                                  {revision.note}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>

                    <div className="flex justify-start">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReviewStep(1)}
                        className="rounded-full border border-white/60 bg-white/70 px-4 text-slate-600"
                      >
                        {t("guide.prevStep")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </GlassCardContent>
        </GlassCard>
      </div>

      {/* ── Priors / What AI Learned ── */}
      <GlassCard
        blur="lg"
        theme="surface"
        hover="none"
        className="overflow-hidden border-white/15 bg-white/80"
      >
        <GlassCardHeader className="border-b border-white/60 p-5 pb-4">
          <div className="flex items-center justify-between">
            <GlassCardTitle className="flex items-center gap-2 text-slate-900">
              <TrendingUp className="size-4 text-emerald-500" />
              {t("priors.title")}
            </GlassCardTitle>
            <span className="text-xs text-slate-400">{priors.length}</span>
          </div>
          <GlassCardDescription className="text-slate-500">
            {t("priors.description")}
          </GlassCardDescription>
        </GlassCardHeader>

        <GlassCardContent className="p-5">
          {priors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              {t("priors.empty")}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {priors.map((prior) => {
                const confidencePercent = Math.round(prior.confidence * 100)
                const maturityPalette =
                  prior.maturity === "mature"
                    ? "border-emerald-200/80 bg-emerald-50/50"
                    : prior.maturity === "developing"
                      ? "border-amber-200/80 bg-amber-50/50"
                      : "border-slate-200/80 bg-slate-50/50"

                return (
                  <div
                    key={`${prior.fingerprint_key}:${prior.decision_point}:${prior.action_key}`}
                    className={[
                      "rounded-2xl border p-4 transition-all hover:shadow-[0_12px_28px_-14px_rgba(15,23,42,0.15)]",
                      maturityPalette,
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800">
                        {prior.decision_point}
                      </div>
                      <MaturityBadge maturity={prior.maturity} t={t} />
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      {t("priors.actionLabel", { action: prior.action_key })}
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">
                          {t("priors.confidence")}
                        </span>
                        <span className="font-medium text-slate-700">
                          {confidencePercent}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/60">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400 transition-all"
                          style={{ width: `${confidencePercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>
                        {t("priors.evidenceCount", { count: prior.evidence_count })}
                      </span>
                      <span>{formatTime(prior.updated_at_unix_ms)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </GlassCardContent>
      </GlassCard>
    </div>
  )
}

function SnapshotBreakdown({
  detail,
  t,
}: {
  detail: TaskLearningRunDetail
  t: Translation
}) {
  const fp = detail.task_fingerprint as Record<string, unknown> | null
  const rd = detail.route_decision as Record<string, unknown> | null
  const ep = detail.execution_policy as Record<string, unknown> | null

  const goalShape = String(fp?.goal_shape ?? "—")
  const outputShape = String(fp?.output_shape ?? "—")
  const riskClass = String(fp?.risk_class ?? "—")
  const route = String((rd as Record<string, unknown>)?.route ?? "—")
  const reasons = Array.isArray((rd as Record<string, unknown>)?.reasons)
    ? ((rd as Record<string, unknown>).reasons as string[])
    : []

  const allowedTools = Array.isArray((ep as Record<string, unknown>)?.allowed_tool_names)
    ? ((ep as Record<string, unknown>).allowed_tool_names as string[])
    : []

  const capSnap = (ep as Record<string, unknown>)?.capability_snapshot as Record<string, unknown> | null
  const caps = Array.isArray(capSnap?.capabilities)
    ? (capSnap!.capabilities as Array<Record<string, unknown>>)
    : []
  const toolNames = caps.map((c) => String(c.name ?? "")).filter(Boolean)

  const riskPalette =
    riskClass === "low"
      ? "border-emerald-200/80 bg-emerald-50/60 text-emerald-700"
      : riskClass === "high"
        ? "border-rose-200/80 bg-rose-50/60 text-rose-700"
        : "border-amber-200/80 bg-amber-50/60 text-amber-700"

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {t("snapshot.title")}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {/* Task Nature */}
        <div className="rounded-2xl border border-sky-200/60 bg-sky-50/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-700">
            <Zap className="size-3.5" />
            {t("snapshot.taskNature")}
          </div>
          <div className="mt-3 space-y-2">
            <SnapshotRow label={t("snapshot.goal")} value={t(`snapshot.goals.${goalShape}`)} />
            <SnapshotRow label={t("snapshot.output")} value={t(`snapshot.outputs.${outputShape}`)} />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{t("snapshot.risk")}</span>
              <span
                className={[
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
                  riskPalette,
                ].join(" ")}
              >
                {t(`snapshot.risks.${riskClass}`)}
              </span>
            </div>
          </div>
        </div>

        {/* Route Decision */}
        <div className="rounded-2xl border border-indigo-200/60 bg-indigo-50/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
            <Route className="size-3.5" />
            {t("snapshot.routeDecision")}
          </div>
          <div className="mt-3 space-y-2">
            <SnapshotRow label={t("snapshot.route")} value={t(`snapshot.routes.${route}`)} />
            {reasons.length > 0 && (
              <div>
                <div className="text-xs text-slate-500">{t("snapshot.reasons")}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {reasons.map((r) => (
                    <span
                      key={r}
                      className="rounded-lg border border-indigo-200/60 bg-indigo-50/60 px-1.5 py-0.5 text-[10px] text-indigo-600"
                    >
                      {r.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tools Used */}
        <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <Shield className="size-3.5" />
            {t("snapshot.toolsUsed")}
          </div>
          <div className="mt-3 space-y-1.5">
            {(toolNames.length > 0 ? toolNames : allowedTools).map((name) => (
              <div
                key={name}
                className="flex items-center gap-1.5 text-xs text-slate-600"
              >
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {name.replace(/_/g, " ")}
              </div>
            ))}
            {toolNames.length === 0 && allowedTools.length === 0 && (
              <div className="text-xs text-slate-400">{t("snapshot.noTools")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-medium text-slate-700">{value}</span>
    </div>
  )
}

function DeltaStatePill({
  state,
  t,
}: {
  state: string
  t: Translation
}) {
  const palette =
    state === "applied"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : state === "provisional"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600"

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em]",
        palette,
      ].join(" ")}
    >
      {t(`deltaStates.${state}`)}
    </span>
  )
}

function MaturityBadge({
  maturity,
  t,
}: {
  maturity: string
  t: Translation
}) {
  const palette =
    maturity === "mature"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : maturity === "developing"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600"

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        palette,
      ].join(" ")}
    >
      {t(`priors.maturityLabels.${maturity}`)}
    </span>
  )
}
