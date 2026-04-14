"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
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

export function TaskLearningClient() {
  const t = useTranslations("task-learning")
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
        !["silent", "unknown"].includes(item.user_response_signal)
    ).length
    return {
      total: runs.length,
      revised,
      signaled,
      priors: priors.length,
    }
  }, [priors.length, runs])

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["totalRuns", stats.total],
          ["revisedRuns", stats.revised],
          ["signaledRuns", stats.signaled],
          ["activePriors", stats.priors],
        ].map(([key, value]) => (
          <div
            key={key}
            className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm"
          >
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              {t(`stats.${key}`)}
            </div>
            <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={sessionFilter}
            onChange={(event) => setSessionFilter(event.target.value)}
            placeholder={t("filters.sessionPlaceholder")}
            className="md:max-w-sm"
          />
          <select
            value={signalFilter}
            onChange={(event) => setSignalFilter(event.target.value)}
            className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-[var(--foreground)]"
          >
            <option value="all">{t("filters.signal.all")}</option>
            <option value="accepted">{t("filters.signal.accepted")}</option>
            <option value="corrected">{t("filters.signal.corrected")}</option>
            <option value="rejected">{t("filters.signal.rejected")}</option>
            <option value="silent">{t("filters.signal.silent")}</option>
          </select>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => void loadRuns()}>
              {t("actions.refresh")}
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {t("runs.title")}
            </h2>
            <span className="text-xs text-[var(--muted)]">{runs.length}</span>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-[var(--muted)]">
              {t("runs.empty")}
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
                      "w-full rounded-2xl border p-4 text-left transition-colors",
                      active
                        ? "border-sky-400/60 bg-sky-500/10"
                        : "border-white/10 bg-black/10 hover:bg-white/5",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-medium text-[var(--foreground)]">
                        {run.fingerprint_key.slice(0, 16)}
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        {run.delta_state}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                      <span>{run.decision_point ?? "—"}</span>
                      <span>{run.final_status ?? "—"}</span>
                      <span>{run.user_response_signal ?? "silent"}</span>
                      <span>{t("runs.revisions", { count: run.revision_count })}</span>
                    </div>
                    <div className="mt-2 text-xs text-[var(--muted)]">
                      {formatTime(run.last_revision_at_unix_ms ?? run.created_at_unix_ms)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {t("detail.title")}
            </h2>
            {isPending ? (
              <span className="text-xs text-[var(--muted)]">{t("detail.loading")}</span>
            ) : null}
          </div>

          {!detail ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-[var(--muted)]">
              {t("detail.empty")}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                    {t("detail.status")}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-[var(--foreground)]">
                    <div>{detail.delta_state}</div>
                    <div>{formatTime(detail.last_revision_at_unix_ms ?? detail.created_at_unix_ms)}</div>
                    <div>{t("runs.revisions", { count: detail.revision_count })}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/15 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                    {t("detail.signal")}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-[var(--foreground)]">
                    <div>{String((detail.outcome as Record<string, unknown>)?.user_response_signal ?? "silent")}</div>
                    <div>{String((detail.outcome as Record<string, unknown>)?.verification_result ?? "—")}</div>
                    <div>{String((detail.outcome as Record<string, unknown>)?.judgment_mode ?? "heuristic")}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("detail.notePlaceholder")}
                  rows={3}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => applyRevision("accepted")}
                  >
                    {t("actions.markAccepted")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => applyRevision("corrected")}
                  >
                    {t("actions.markCorrected")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => applyRevision("rejected")}
                  >
                    {t("actions.markRejected")}
                  </Button>
                  <Button disabled={isPending} onClick={replaySelectedRun}>
                    {t("actions.replay")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-medium text-[var(--foreground)]">
                    {t("detail.current")}
                  </h3>
                  <pre className="max-h-[18rem] overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-slate-200">
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
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium text-[var(--foreground)]">
                    {t("detail.revisions")}
                  </h3>
                  <div className="max-h-[18rem] space-y-3 overflow-auto pr-1">
                    {detail.revisions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-[var(--muted)]">
                        {t("detail.noRevisions")}
                      </div>
                    ) : (
                      detail.revisions.map((revision) => (
                        <div
                          key={revision.id}
                          className="rounded-xl border border-white/10 bg-black/20 p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-[var(--foreground)]">
                              {revision.trigger_source}
                            </div>
                            <div className="text-xs text-[var(--muted)]">
                              {formatTime(revision.created_at_unix_ms)}
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-[var(--muted)]">
                            {revision.user_response_signal} · {revision.delta_state}
                          </div>
                          {revision.note ? (
                            <div className="mt-2 text-sm text-[var(--foreground)]">
                              {revision.note}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {t("priors.title")}
          </h2>
          <span className="text-xs text-[var(--muted)]">{priors.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-[var(--muted)]">
              <tr>
                <th className="pb-2 pr-4">{t("priors.columns.fingerprint")}</th>
                <th className="pb-2 pr-4">{t("priors.columns.decision")}</th>
                <th className="pb-2 pr-4">{t("priors.columns.action")}</th>
                <th className="pb-2 pr-4">{t("priors.columns.weight")}</th>
                <th className="pb-2 pr-4">{t("priors.columns.evidence")}</th>
                <th className="pb-2 pr-4">{t("priors.columns.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {priors.map((prior) => (
                <tr key={`${prior.fingerprint_key}:${prior.decision_point}:${prior.action_key}`}>
                  <td className="border-t border-white/10 py-2 pr-4 font-mono text-xs">
                    {prior.fingerprint_key.slice(0, 12)}
                  </td>
                  <td className="border-t border-white/10 py-2 pr-4">{prior.decision_point}</td>
                  <td className="border-t border-white/10 py-2 pr-4">{prior.action_key}</td>
                  <td className="border-t border-white/10 py-2 pr-4">
                    {prior.weight.toFixed(3)} / {prior.confidence.toFixed(2)}
                  </td>
                  <td className="border-t border-white/10 py-2 pr-4">
                    {prior.evidence_count} · {prior.maturity}
                  </td>
                  <td className="border-t border-white/10 py-2 pr-4 text-xs text-[var(--muted)]">
                    {formatTime(prior.updated_at_unix_ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
