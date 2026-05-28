"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Container } from "@/components/ui/common/container"
import { GlassButton } from "@/components/ui/common/glass-button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/common/glass-card"
import { Input } from "@/components/ui/shadcn/input"
import { Textarea } from "@/components/ui/shadcn/textarea"
import {
  getTaskLearningRun,
  listEvolutionSignals,
  listTaskLearningRuns,
  listTaskPolicyPriors,
  replayTaskLearningRun,
  reviseTaskLearningRun,
  type EvolutionSignalItem,
  type TaskLearningRunDetail,
  type TaskLearningRunListItem,
} from "@/lib/api/task-learning"
import { cn } from "@/lib/utils"

type ReviewSignal = "accepted" | "corrected" | "rejected"
type PriorTab = "all" | "confirmed" | "provisional" | "low"
type Tone = "accent" | "info" | "ok" | "warn" | "danger" | "muted"

type TaskPolicyPrior = {
  fingerprint_key: string
  decision_point: string
  action_key: string
  weight: number
  confidence: number
  evidence_count: number
  maturity: string
  updated_at_unix_ms: number
}

type TrendPoint = {
  label: string
  value: number
}

type TimelineStep = {
  key: string
  title: string
  description: string
  time: string
  tone: Exclude<Tone, "muted">
}

const PAGE_SIZE = 6
const EVOLUTION_SIGNAL_LIMIT = 12

function formatDateTime(unixMs: number | null | undefined, locale: string) {
  if (!unixMs) return "-"
  return new Date(unixMs).toLocaleString(locale)
}

function formatClock(unixMs: number | null | undefined, locale: string) {
  if (!unixMs) return "--"
  return new Date(unixMs).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function getString(value: Record<string, unknown>, key: string) {
  const next = value[key]
  return typeof next === "string" && next.trim().length > 0 ? next.trim() : null
}

function getNumber(value: Record<string, unknown>, key: string) {
  const next = value[key]
  return typeof next === "number" && Number.isFinite(next) ? next : null
}

function getStringArray(value: Record<string, unknown>, key: string) {
  const next = value[key]
  if (!Array.isArray(next)) return []
  return next.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function payloadText(value: unknown, key: string) {
  return getString(asRecord(value), key)
}

function payloadTextArray(value: unknown, key: string) {
  return getStringArray(asRecord(value), key)
}

function signalLinkedIds(signal: EvolutionSignalItem) {
  return [
    signal.session_id ? `session:${signal.session_id.slice(0, 8)}` : null,
    signal.trace_id ? `trace:${signal.trace_id.slice(0, 8)}` : null,
    signal.run_id ? `run:${signal.run_id.slice(0, 8)}` : null,
    signal.fingerprint_key ? `fp:${signal.fingerprint_key.slice(0, 8)}` : null,
  ].filter((value): value is string => Boolean(value))
}

function humanizeToken(value: string | null | undefined) {
  if (!value) return "-"
  const normalized = value.trim()
  if (!normalized) return "-"
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
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
  if (signal === "neutral") return t("evolution.classifications.neutral")
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
  return humanizeToken(value)
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
  return humanizeToken(value)
}

function signalTone(signal: string | null | undefined): Tone {
  if (signal === "accepted") return "ok"
  if (signal === "corrected") return "warn"
  if (signal === "rejected") return "danger"
  if (signal === "silent") return "muted"
  return "accent"
}

function deltaTone(value: string | null | undefined): Tone {
  if (value === "applied") return "ok"
  if (value === "provisional") return "warn"
  if (value === "rejected") return "danger"
  if (value === "superseded") return "info"
  return "accent"
}

function maturityTone(value: string | null | undefined): Tone {
  if (value === "mature" || value === "confirmed") return "ok"
  if (value === "provisional") return "warn"
  if (value === "nascent") return "muted"
  return "accent"
}

function toneClasses(tone: Tone) {
  if (tone === "ok") {
    return "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"
  }
  if (tone === "warn") {
    return "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]"
  }
  if (tone === "danger") {
    return "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]"
  }
  if (tone === "info") {
    return "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]"
  }
  if (tone === "muted") {
    return "border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-[var(--ink-3)]"
  }
  return "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
}

function buildTrendPoints(timestamps: number[], locale: string) {
  const today = new Date()
  const days = Array.from({ length: 10 }, (_, index) => {
    const point = new Date(today)
    point.setHours(0, 0, 0, 0)
    point.setDate(today.getDate() - (9 - index))
    return point
  })

  return days.map((day) => {
    const nextDay = new Date(day)
    nextDay.setDate(day.getDate() + 1)
    const value = timestamps.filter((timestamp) => timestamp >= day.getTime() && timestamp < nextDay.getTime()).length
    return {
      label: day.toLocaleDateString(locale, { month: "numeric", day: "numeric" }),
      value,
    }
  })
}

function buildSparklinePoints(points: TrendPoint[]) {
  if (points.length === 0) return ""
  const max = Math.max(...points.map((point) => point.value), 1)
  return points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
      const y = 36 - (point.value / max) * 24 - 6
      return `${x},${y}`
    })
    .join(" ")
}

function isReviewSignal(value: string | null | undefined): value is ReviewSignal {
  return value === "accepted" || value === "corrected" || value === "rejected"
}

function buildTaskFingerprintSummary(detail: TaskLearningRunDetail) {
  const fingerprint = asRecord(detail.task_fingerprint)
  return [
    getString(fingerprint, "goal_shape"),
    getString(fingerprint, "output_shape"),
    getString(fingerprint, "risk_class"),
  ]
    .filter(Boolean)
    .map((value) => humanizeToken(value))
    .join(" / ")
}

function buildPhaseSummary(detail: TaskLearningRunDetail) {
  const executionPolicy = asRecord(detail.execution_policy)
  const phaseStepType = getString(executionPolicy, "initial_phase_step")
  const plane = getString(executionPolicy, "plane")
  const allowWorkerDelegation = executionPolicy.allow_worker_delegation === true
    ? "delegated_phase_enabled"
    : null
  const preferWorkflowRuntime = executionPolicy.prefer_workflow_runtime === true
    ? "workflow_runtime_preferred"
    : null
  return [
    humanizeToken(phaseStepType),
    humanizeToken(plane),
    humanizeToken(allowWorkerDelegation),
    humanizeToken(preferWorkflowRuntime),
  ].filter((item) => item !== "-").join(" · ")
}

function buildExecutionSummary(detail: TaskLearningRunDetail, t: ReturnType<typeof useTranslations>) {
  const outcome = asRecord(detail.outcome)
  const finalStatus = humanizeToken(getString(outcome, "final_status"))
  const verification = humanizeToken(getString(outcome, "verification_result"))
  const toolCalls = getNumber(outcome, "tool_call_count") ?? 0
  return [
    finalStatus,
    verification,
    `${toolCalls} ${t("detail.metricUnits.toolCalls")}`,
  ].join(" · ")
}

function buildLearningSummary(detail: TaskLearningRunDetail, t: ReturnType<typeof useTranslations>) {
  const policyDelta = asRecord(detail.policy_delta)
  const decisionPoint = getString(policyDelta, "decision_point")
  const actionKey = getString(policyDelta, "action_key")
  const direction = getString(policyDelta, "direction")

  return [
    deltaStateLabel(detail.delta_state, t),
    humanizeToken(decisionPoint),
    humanizeToken(actionKey),
    humanizeToken(direction),
  ]
    .filter((value) => value !== "-")
    .join(" · ")
}

function buildTimeline(
  detail: TaskLearningRunDetail,
  t: ReturnType<typeof useTranslations>,
  locale: string,
): TimelineStep[] {
  const createdTime = formatClock(detail.created_at_unix_ms, locale)
  const updatedTime = formatClock(detail.last_revision_at_unix_ms ?? detail.created_at_unix_ms, locale)

  return [
    {
      key: "profile",
      title: t("timeline.profile"),
      description: `${t("timeline.profileDesc")} ${buildTaskFingerprintSummary(detail) || t("timeline.fallback")}`,
      time: createdTime,
      tone: "accent",
    },
    {
      key: "phase",
      title: t("timeline.phase"),
      description: `${t("timeline.phaseDesc")} ${buildPhaseSummary(detail) || t("timeline.fallback")}`,
      time: createdTime,
      tone: "info",
    },
    {
      key: "execution",
      title: t("timeline.execution"),
      description: `${t("timeline.executionDesc")} ${buildExecutionSummary(detail, t)}`,
      time: createdTime,
      tone: "ok",
    },
    {
      key: "learning",
      title: t("timeline.learning"),
      description: `${t("timeline.learningDesc")} ${buildLearningSummary(detail, t)}`,
      time: updatedTime,
      tone: deltaTone(detail.delta_state) === "muted" ? "accent" : (deltaTone(detail.delta_state) as Exclude<Tone, "muted">),
    },
  ]
}

function buildExportFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `task-learning-${stamp}.json`
}

function buildDetailMetrics(detail: TaskLearningRunDetail, t: ReturnType<typeof useTranslations>) {
  const outcome = asRecord(detail.outcome)
  const executionPolicy = asRecord(detail.execution_policy)
  const policyDelta = asRecord(detail.policy_delta)

  const confidence = getNumber(outcome, "confidence")
  const toolCalls = getNumber(outcome, "tool_call_count")
  const phaseStepType = getString(executionPolicy, "initial_phase_step") ?? getString(executionPolicy, "plane")
  const verification = getString(outcome, "verification_result")
  const decisionPoint = getString(policyDelta, "decision_point") ?? detail.revisions[0]?.trigger_source ?? null

  return [
    { label: t("detail.metrics.phase"), value: humanizeToken(phaseStepType) },
    { label: t("detail.metrics.verification"), value: humanizeToken(verification) },
    {
      label: t("detail.metrics.confidence"),
      value: confidence !== null ? `${Math.round(confidence * 100)}%` : "-",
    },
    {
      label: t("detail.metrics.toolCalls"),
      value: toolCalls !== null ? `${toolCalls}` : "0",
    },
    {
      label: t("detail.metrics.decision"),
      value: humanizeToken(decisionPoint),
    },
  ]
}

function exportSnapshot(
  runs: TaskLearningRunListItem[],
  detail: TaskLearningRunDetail | null,
  priors: TaskPolicyPrior[],
  evolutionSignals: EvolutionSignalItem[],
  searchQuery: string,
  signalFilter: string,
) {
  return {
    exported_at: new Date().toISOString(),
    filters: {
      search_query: searchQuery,
      signal_filter: signalFilter,
    },
    runs,
    selected_detail: detail,
    evolution_signals: evolutionSignals,
    priors,
  }
}

export function TaskLearningClient() {
  const t = useTranslations("task-learning")
  const locale = useLocale()
  const exportLinkRef = useRef<HTMLAnchorElement | null>(null)
  const [runs, setRuns] = useState<TaskLearningRunListItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TaskLearningRunDetail | null>(null)
  const [priors, setPriors] = useState<TaskPolicyPrior[]>([])
  const [evolutionSignals, setEvolutionSignals] = useState<EvolutionSignalItem[]>([])
  const [evolutionSignalTotal, setEvolutionSignalTotal] = useState(0)
  const [evolutionSourceFilter, setEvolutionSourceFilter] = useState("next_user_message")
  const [evolutionClassificationFilter, setEvolutionClassificationFilter] = useState("all")
  const [evolutionStatusFilter, setEvolutionStatusFilter] = useState("all")
  const [evolutionLinkKind, setEvolutionLinkKind] = useState("trace_id")
  const [evolutionLinkFilter, setEvolutionLinkFilter] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [signalFilter, setSignalFilter] = useState("all")
  const [currentPage, setCurrentPage] = useState(1)
  const [note, setNote] = useState("")
  const [draftSignal, setDraftSignal] = useState<ReviewSignal | null>(null)
  const [activePriorTab, setActivePriorTab] = useState<PriorTab>("all")
  const [exportHref, setExportHref] = useState<string | null>(null)
  const [exportName, setExportName] = useState(buildExportFilename())
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  async function loadRuns(preferredRunId?: string | null) {
    setIsLoading(true)
    try {
      const [runResponse, priorResponse] = await Promise.all([
        listTaskLearningRuns({ limit: 60 }),
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

  async function loadEvolutionSignals() {
    try {
      const link = evolutionLinkFilter.trim()
      const response = await listEvolutionSignals({
        limit: EVOLUTION_SIGNAL_LIMIT,
        source: evolutionSourceFilter === "all" ? null : evolutionSourceFilter,
        classification: evolutionClassificationFilter === "all" ? null : evolutionClassificationFilter,
        status: evolutionStatusFilter === "all" ? null : evolutionStatusFilter,
        session_id: evolutionLinkKind === "session_id" ? link || null : null,
        trace_id: evolutionLinkKind === "trace_id" ? link || null : null,
        run_id: evolutionLinkKind === "run_id" ? link || null : null,
        fingerprint_key: evolutionLinkKind === "fingerprint_key" ? link || null : null,
      })
      setEvolutionSignals(response.items)
      setEvolutionSignalTotal(response.total)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("feedback.evolutionLoadFailed"))
    }
  }

  useEffect(() => {
    void loadRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadEvolutionSignals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evolutionSourceFilter, evolutionClassificationFilter, evolutionStatusFilter, evolutionLinkKind])

  useEffect(() => {
    return () => {
      if (exportHref) {
        URL.revokeObjectURL(exportHref)
      }
    }
  }, [exportHref])

  const filteredRuns = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return runs.filter((run) => {
      if (signalFilter !== "all" && (run.user_response_signal ?? "silent") !== signalFilter) {
        return false
      }

      if (!normalizedQuery) return true

      const haystack = [
        run.task_preview,
        run.session_id,
        run.fingerprint_key,
        run.decision_point,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [runs, searchQuery, signalFilter])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, signalFilter])

  useEffect(() => {
    if (filteredRuns.length === 0) {
      setSelectedRunId(null)
      setDetail(null)
      return
    }

    if (selectedRunId && filteredRuns.some((run) => run.run_id === selectedRunId)) {
      return
    }

    const fallbackRunId = filteredRuns[0]?.run_id
    if (!fallbackRunId) return

    setSelectedRunId(fallbackRunId)
    void getTaskLearningRun(fallbackRunId)
      .then((nextDetail) => {
        setDetail(nextDetail)
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : t("feedback.actionFailed"))
      })
  }, [filteredRuns, selectedRunId, t])

  useEffect(() => {
    const currentSignal = detail
      ? String(asRecord(detail.outcome).user_response_signal ?? detail.last_signal ?? "silent")
      : null
    setDraftSignal(isReviewSignal(currentSignal) ? currentSignal : null)
    setNote("")
  }, [detail])

  const pageCount = Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE))
  const paginatedRuns = filteredRuns.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const stats = useMemo(() => {
    const reviewed = runs.filter((run) => isReviewSignal(run.user_response_signal)).length
    const pending = runs.length - reviewed
    return {
      total: runs.length,
      pending,
      reviewed,
      learned: priors.length,
    }
  }, [priors.length, runs])

  const trendPoints = useMemo(
    () => buildTrendPoints(priors.map((prior) => prior.updated_at_unix_ms), locale),
    [locale, priors],
  )

  const trendDelta = useMemo(() => {
    const today = trendPoints.at(-1)?.value ?? 0
    const yesterday = trendPoints.at(-2)?.value ?? 0
    return today - yesterday
  }, [trendPoints])

  const sparklinePoints = useMemo(() => buildSparklinePoints(trendPoints), [trendPoints])

  const priorBuckets = useMemo(() => {
    const confirmed = priors.filter((prior) => prior.maturity === "confirmed" || prior.maturity === "mature")
    const low = priors.filter((prior) => prior.confidence < 0.35 || prior.evidence_count <= 2)
    const provisional = priors.filter((prior) => !confirmed.includes(prior))

    return {
      all: priors,
      confirmed,
      provisional,
      low,
    }
  }, [priors])

  const visiblePriors = priorBuckets[activePriorTab]

  const timeline = useMemo(() => {
    if (!detail) return []
    return buildTimeline(detail, t, locale)
  }, [detail, locale, t])

  const metrics = useMemo(() => {
    if (!detail) return []
    return buildDetailMetrics(detail, t)
  }, [detail, t])

  function selectRun(runId: string) {
    setSelectedRunId(runId)
    startTransition(() => {
      void getTaskLearningRun(runId)
        .then((nextDetail) => {
          setDetail(nextDetail)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("feedback.actionFailed"))
        })
    })
  }

  function submitFeedback() {
    if (!selectedRunId || !draftSignal) {
      toast.error(t("detail.submitHint"))
      return
    }

    startTransition(() => {
      void reviseTaskLearningRun({
        run_id: selectedRunId,
        user_response_signal: draftSignal,
        note: note.trim() || null,
        trigger_source: "dashboard_manual_revision",
      })
        .then((nextDetail) => {
          setDetail(nextDetail)
          toast.success(
            t("feedback.revised", {
              signal: signalLabel(draftSignal, t),
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
        .then((nextDetail) => {
          setDetail(nextDetail)
          toast.success(t("feedback.replayed"))
          return loadRuns(selectedRunId)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("feedback.actionFailed"))
        })
    })
  }

  function handleExport() {
    const blob = new Blob(
      [
        JSON.stringify(
          exportSnapshot(runs, detail, priors, evolutionSignals, searchQuery, signalFilter),
          null,
          2,
        ),
      ],
      { type: "application/json" },
    )

    if (exportHref) {
      URL.revokeObjectURL(exportHref)
    }

    const nextHref = URL.createObjectURL(blob)
    setExportHref(nextHref)
    setExportName(buildExportFilename())
    requestAnimationFrame(() => {
      exportLinkRef.current?.click()
    })
  }

  const selectedTitle = detail
    ? sanitizeTaskPreview(detail.task_preview) ?? taskFingerprintLabel(detail.fingerprint_key, t)
    : null

  const currentSignal = detail
    ? String(asRecord(detail.outcome).user_response_signal ?? detail.last_signal ?? "silent")
    : null

  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="!mx-0 !max-w-none py-5 md:py-6"
    >
      <a
        ref={exportLinkRef}
        className="hidden"
        download={exportName}
        href={exportHref ?? undefined}
      />

      <div className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 items-center justify-center rounded-[var(--r-14)] border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <BookOpen className="size-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-[32px] font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {t("title")}
              </h1>
              <p className="max-w-[720px] text-sm leading-6 text-[var(--ink-2)]">
                {t("description")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <GlassButton
              variant="secondary"
              size="sm"
              onClick={() => {
                void loadRuns(selectedRunId)
                void loadEvolutionSignals()
              }}
            >
              <RefreshCw className="size-4" />
              {t("actions.refreshRecords")}
            </GlassButton>
            <GlassButton variant="secondary" size="sm" onClick={handleExport}>
              <Download className="size-4" />
              {t("actions.exportRecords")}
            </GlassButton>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.85fr)]">
          <MetricSurface
            icon={<Sparkles className="size-4" />}
            tone="info"
            label={t("stats.totalRuns")}
            value={stats.total}
            hint={t("stats.totalRunsHint")}
          />
          <MetricSurface
            icon={<Clock3 className="size-4" />}
            tone="warn"
            label={t("stats.pendingRuns")}
            value={stats.pending}
            hint={t("stats.pendingRunsHint")}
          />
          <MetricSurface
            icon={<CheckCircle2 className="size-4" />}
            tone="ok"
            label={t("stats.reviewedRuns")}
            value={stats.reviewed}
            hint={t("stats.reviewedRunsHint")}
          />
          <MetricSurface
            icon={<Brain className="size-4" />}
            tone="warn"
            label={t("stats.activePriors")}
            value={stats.learned}
            hint={t("stats.activePriorsHint")}
          />

          <GlassCard
            blur="sm"
            theme="surface"
            hover="none"
            padding="none"
            className="border-[var(--hairline)] bg-[var(--panel-bg)]/94"
          >
            <GlassCardContent className="flex h-full min-h-[106px] items-center justify-between gap-6 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--ink)]">
                  {t("stats.todayTrend")}
                </div>
                <div className="mt-1 text-xs text-[var(--ink-3)]">
                  {t("stats.todayTrendHint")}
                </div>
                <div className="mt-4 h-12 w-full">
                  <svg viewBox="0 0 100 36" className="h-full w-full overflow-visible" preserveAspectRatio="none">
                    <path
                      d="M0 30 H100"
                      className="stroke-[var(--hairline)]"
                      fill="none"
                      strokeWidth="0.8"
                      strokeDasharray="2 3"
                    />
                    <polyline
                      points={sparklinePoints}
                      fill="none"
                      stroke="var(--accent-strong)"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xl font-semibold tracking-[-0.03em] text-[var(--ink)]">
                  {trendDelta >= 0 ? "+" : ""}
                  {trendDelta}
                </div>
                <div className="mt-1 text-xs leading-5 text-[var(--ink-3)]">
                  {t("stats.todayTrendDelta")}
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>
        </div>

        <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.28fr)]">
          <GlassCard
            blur="sm"
            theme="surface"
            hover="none"
            padding="none"
            className="border-[var(--hairline)] bg-[var(--panel-bg)]/96"
          >
            <GlassCardHeader className="gap-4 border-b border-[var(--hairline)] px-5 py-4">
              <div className="space-y-1">
                <GlassCardTitle className="text-[22px] tracking-[-0.04em] text-[var(--ink)]">
                  {t("runs.title")}
                </GlassCardTitle>
                <GlassCardDescription className="text-[13px] text-[var(--ink-3)]">
                  {t("runs.description")}
                </GlassCardDescription>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-4)]" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("filters.searchPlaceholder")}
                    className="h-10 rounded-[var(--r-10)] border-[var(--hairline)] bg-[var(--panel-bg)] pl-9 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                  />
                </div>

                <select
                  value={signalFilter}
                  onChange={(event) => setSignalFilter(event.target.value)}
                  className="h-10 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3.5 text-[13px] text-[var(--ink)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent-border)] focus:[box-shadow:var(--focus-ring)]"
                >
                  <option value="all">{t("filters.signal.all")}</option>
                  <option value="accepted">{t("filters.signal.accepted")}</option>
                  <option value="corrected">{t("filters.signal.corrected")}</option>
                  <option value="rejected">{t("filters.signal.rejected")}</option>
                  <option value="silent">{t("filters.signal.silent")}</option>
                </select>
              </div>
            </GlassCardHeader>

            <GlassCardContent className="px-4 py-4">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: PAGE_SIZE }).map((_, index) => (
                    <div
                      key={`run-skeleton-${index}`}
                      className="h-[86px] animate-pulse rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]"
                    />
                  ))}
                </div>
              ) : paginatedRuns.length === 0 ? (
                <EmptyPanel
                  icon={<FileSearch className="size-5" />}
                  title={t("runs.emptyTitle")}
                  description={t("runs.empty")}
                />
              ) : (
                <div className="space-y-2.5">
                  {paginatedRuns.map((run) => {
                    const active = run.run_id === selectedRunId
                    const title = compactTaskPreview(run.task_preview) ?? taskFingerprintLabel(run.fingerprint_key, t)

                    return (
                      <button
                        key={run.run_id}
                        type="button"
                        onClick={() => selectRun(run.run_id)}
                        className={cn(
                          "w-full rounded-[var(--r-14)] border px-4 py-3 text-left transition-all duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
                          active
                            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
                            : "border-[var(--hairline)] bg-[var(--panel-bg)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={cn(
                                  "size-2.5 rounded-full",
                                  signalTone(run.user_response_signal) === "ok" && "bg-[var(--ok)]",
                                  signalTone(run.user_response_signal) === "warn" && "bg-[var(--warn)]",
                                  signalTone(run.user_response_signal) === "danger" && "bg-[var(--danger)]",
                                  signalTone(run.user_response_signal) === "accent" && "bg-[var(--accent-strong)]",
                                  signalTone(run.user_response_signal) === "muted" && "bg-[var(--ink-4)]",
                                )}
                              />
                              <div className="truncate text-[15px] font-semibold text-[var(--ink)]">
                                {title}
                              </div>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-3)]">
                              <StatusPill
                                tone="muted"
                                label={run.decision_point ? humanizeToken(run.decision_point) : t("runs.noDecision")}
                              />
                              <span>{taskFingerprintLabel(run.fingerprint_key, t)}</span>
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <StatusPill
                              tone={signalTone(run.user_response_signal)}
                              label={signalLabel(run.user_response_signal, t)}
                            />
                            <div className="mt-2 text-xs text-[var(--ink-3)]">
                              {formatClock(run.last_revision_at_unix_ms ?? run.created_at_unix_ms, locale)}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </GlassCardContent>

            <div className="flex items-center justify-center gap-2 border-t border-[var(--hairline)] px-4 py-3">
              <GlassButton
                variant="ghost"
                size="icon-sm"
                disabled={currentPage <= 1 || paginatedRuns.length === 0}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                <ChevronLeft className="size-4" />
              </GlassButton>
              {Array.from({ length: pageCount }).slice(0, 6).map((_, index) => {
                const page = index + 1
                return (
                  <button
                    key={`page-${page}`}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-[var(--r-8)] border text-xs font-medium transition-colors",
                      page === currentPage
                        ? "border-[var(--accent-border)] bg-[var(--accent-strong)] text-white"
                        : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)] hover:border-[var(--accent-border)] hover:text-[var(--accent-ink)]",
                    )}
                  >
                    {page}
                  </button>
                )
              })}
              <GlassButton
                variant="ghost"
                size="icon-sm"
                disabled={currentPage >= pageCount || paginatedRuns.length === 0}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
              >
                <ChevronRight className="size-4" />
              </GlassButton>
            </div>
          </GlassCard>

          <GlassCard
            blur="sm"
            theme="surface"
            hover="none"
            padding="none"
            className="border-[var(--hairline)] bg-[var(--panel-bg)]/96"
          >
            <GlassCardHeader className="gap-4 border-b border-[var(--hairline)] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-[var(--ink)]">
                    {t("detail.summaryTitle")}
                  </div>
                  <div className="max-w-[720px] text-[28px] font-semibold leading-tight tracking-[-0.05em] text-[var(--ink)]">
                    {selectedTitle ?? t("detail.emptyTitle")}
                  </div>
                  {detail ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-3)]">
                      <span>{t("detail.runId", { id: detail.run_id.slice(0, 8) })}</span>
                      <span>{formatDateTime(detail.created_at_unix_ms, locale)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  {detail ? (
                    <StatusPill tone={signalTone(currentSignal)} label={signalLabel(currentSignal, t)} />
                  ) : null}
                  <GlassButton
                    variant="secondary"
                    size="sm"
                    onClick={replaySelectedRun}
                    disabled={!detail || isPending}
                  >
                    {isPending ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    {t("actions.replay")}
                  </GlassButton>
                </div>
              </div>
            </GlassCardHeader>

            <GlassCardContent className="space-y-4 px-5 py-4">
              {!detail ? (
                <EmptyPanel
                  icon={<BookOpen className="size-5" />}
                  title={t("detail.emptyTitle")}
                  description={t("detail.empty")}
                />
              ) : (
                <>
                  <div className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/64 p-4">
                    <div className="mb-3 text-sm font-semibold text-[var(--accent-ink)]">
                      {t("detail.processTitle")}
                    </div>
                    <div className="space-y-3">
                      {timeline.map((step) => (
                        <div key={step.key} className="flex items-start gap-3">
                          <div
                            className={cn(
                              "mt-1 flex size-5 items-center justify-center rounded-full border",
                              toneClasses(step.tone),
                            )}
                          >
                            <CheckCircle2 className="size-3" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm font-semibold text-[var(--ink)]">
                                {step.title}
                              </div>
                              <div className="shrink-0 text-xs text-[var(--ink-3)]">
                                {step.time}
                              </div>
                            </div>
                            <div className="mt-1 text-sm leading-6 text-[var(--ink-2)]">
                              {step.description}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {metrics.map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-[var(--r-12)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-4 py-3"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-4)]">
                          {metric.label}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-[var(--ink)]">
                          {metric.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-[var(--accent-ink)]">
                      {t("detail.feedbackTitle")}
                    </div>
                    <div className="text-sm text-[var(--ink-2)]">
                      {t("detail.feedbackHint")}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <FeedbackOptionCard
                        selected={draftSignal === "accepted"}
                        tone="ok"
                        icon={<ThumbsUp className="size-5" />}
                        title={t("actions.markAccepted")}
                        hint={t("actions.acceptedHint")}
                        onClick={() => setDraftSignal("accepted")}
                      />
                      <FeedbackOptionCard
                        selected={draftSignal === "corrected"}
                        tone="warn"
                        icon={<Wrench className="size-5" />}
                        title={t("actions.markCorrected")}
                        hint={t("actions.correctedHint")}
                        onClick={() => setDraftSignal("corrected")}
                      />
                      <FeedbackOptionCard
                        selected={draftSignal === "rejected"}
                        tone="danger"
                        icon={<ThumbsDown className="size-5" />}
                        title={t("actions.markRejected")}
                        hint={t("actions.rejectedHint")}
                        onClick={() => setDraftSignal("rejected")}
                      />
                    </div>

                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={t("detail.notePlaceholder")}
                      rows={3}
                      className="min-h-[92px] rounded-[var(--r-12)] border-[var(--hairline)] bg-[var(--panel-bg)]"
                    />

                    <div className="flex justify-end">
                      <GlassButton
                        variant="default"
                        size="sm"
                        disabled={isPending || !draftSignal}
                        onClick={submitFeedback}
                      >
                        {isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {t("actions.submitFeedback")}
                      </GlassButton>
                    </div>
                  </div>

                  <details className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)]">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--ink)]">
                      {t("detail.snapshotTitle")}
                    </summary>
                    <div className="border-t border-[var(--hairline)] px-4 py-4">
                      <pre className="max-h-[300px] overflow-auto rounded-[var(--r-12)] bg-[#111827] p-4 text-xs leading-6 text-white/85">
                        {prettyJson({
                          task_fingerprint: detail.task_fingerprint,
                          execution_policy: detail.execution_policy,
                          outcome: detail.outcome,
                          attribution: detail.attribution,
                          policy_delta: detail.policy_delta,
                          trace_feedback: detail.trace_feedback,
                        })}
                      </pre>
                    </div>
                  </details>

                  <details className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)]">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--ink)]">
                      {t("detail.revisionHistoryTitle")}
                    </summary>
                    <div className="space-y-3 border-t border-[var(--hairline)] px-4 py-4">
                      {detail.revisions.length === 0 ? (
                        <div className="rounded-[var(--r-12)] border border-dashed border-[var(--hairline)] px-4 py-6 text-center text-sm text-[var(--ink-3)]">
                          {t("detail.noRevisions")}
                        </div>
                      ) : (
                        detail.revisions.map((revision) => (
                          <div
                            key={revision.id}
                            className="rounded-[var(--r-12)] border border-[var(--hairline)] bg-[var(--panel-bg-inset)]/56 px-4 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                {revision.user_response_signal === "accepted" ? (
                                  <CheckCircle2 className="size-4 text-[var(--ok)]" />
                                ) : revision.user_response_signal === "corrected" ? (
                                  <Wrench className="size-4 text-[var(--warn)]" />
                                ) : (
                                  <XCircle className="size-4 text-[var(--danger)]" />
                                )}
                                <StatusPill
                                  tone={signalTone(revision.user_response_signal)}
                                  label={signalLabel(revision.user_response_signal, t)}
                                />
                              </div>
                              <div className="text-xs text-[var(--ink-3)]">
                                {formatDateTime(revision.created_at_unix_ms, locale)}
                              </div>
                            </div>
                            <div className="mt-2 text-xs text-[var(--ink-3)]">
                              {t("detail.revisionSource", { source: revision.trigger_source })}
                            </div>
                            {revision.note ? (
                              <div className="mt-3 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--ink-2)]">
                                {revision.note}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                </>
              )}
            </GlassCardContent>
          </GlassCard>
        </div>

        <GlassCard
          blur="sm"
          theme="surface"
          hover="none"
          padding="none"
          className="border-[var(--hairline)] bg-[var(--panel-bg)]/96"
        >
          <GlassCardHeader className="gap-4 border-b border-[var(--hairline)] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <GlassCardTitle className="text-[22px] tracking-[-0.04em] text-[var(--ink)]">
                  {t("evolution.title")}
                </GlassCardTitle>
                <GlassCardDescription className="max-w-[720px] text-[13px] leading-6 text-[var(--ink-3)]">
                  {t("evolution.description")}
                </GlassCardDescription>
              </div>
              <StatusPill tone="info" label={t("evolution.summary", { count: evolutionSignalTotal })} />
            </div>

            <div className="grid gap-3 xl:grid-cols-[160px_150px_130px_130px_minmax(0,1fr)_auto]">
              <select
                value={evolutionSourceFilter}
                onChange={(event) => setEvolutionSourceFilter(event.target.value)}
                className="h-10 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3.5 text-[13px] text-[var(--ink)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent-border)] focus:[box-shadow:var(--focus-ring)]"
              >
                <option value="all">{t("evolution.filters.source.all")}</option>
                <option value="next_user_message">{t("evolution.sources.next_user_message")}</option>
                <option value="explicit_trace_feedback">{t("evolution.sources.explicit_trace_feedback")}</option>
                <option value="deeting_think">{t("evolution.sources.deeting_think")}</option>
                <option value="manual_task_learning_revision">{t("evolution.sources.manual_task_learning_revision")}</option>
                <option value="monitor_observation">{t("evolution.sources.monitor_observation")}</option>
                <option value="monitor_feedback">{t("evolution.sources.monitor_feedback")}</option>
              </select>
              <select
                value={evolutionClassificationFilter}
                onChange={(event) => setEvolutionClassificationFilter(event.target.value)}
                className="h-10 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3.5 text-[13px] text-[var(--ink)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent-border)] focus:[box-shadow:var(--focus-ring)]"
              >
                <option value="all">{t("evolution.filters.classification.all")}</option>
                <option value="accepted">{t("runs.signals.accepted")}</option>
                <option value="corrected">{t("runs.signals.corrected")}</option>
                <option value="rejected">{t("runs.signals.rejected")}</option>
                <option value="neutral">{t("evolution.classifications.neutral")}</option>
                <option value="unknown">{t("runs.signals.unknown")}</option>
              </select>
              <select
                value={evolutionStatusFilter}
                onChange={(event) => setEvolutionStatusFilter(event.target.value)}
                className="h-10 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3.5 text-[13px] text-[var(--ink)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent-border)] focus:[box-shadow:var(--focus-ring)]"
              >
                <option value="all">{t("evolution.filters.status.all")}</option>
                <option value="observed">{t("evolution.statuses.observed")}</option>
                <option value="classified">{t("evolution.statuses.classified")}</option>
                <option value="correlated">{t("evolution.statuses.correlated")}</option>
                <option value="applied">{t("evolution.statuses.applied")}</option>
                <option value="ignored">{t("evolution.statuses.ignored")}</option>
              </select>
              <select
                value={evolutionLinkKind}
                onChange={(event) => setEvolutionLinkKind(event.target.value)}
                className="h-10 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-3.5 text-[13px] text-[var(--ink)] outline-none transition-[border-color,box-shadow] focus:border-[var(--accent-border)] focus:[box-shadow:var(--focus-ring)]"
              >
                <option value="trace_id">{t("evolution.filters.link.trace")}</option>
                <option value="session_id">{t("evolution.filters.link.session")}</option>
                <option value="run_id">{t("evolution.filters.link.run")}</option>
                <option value="fingerprint_key">{t("evolution.filters.link.fingerprint")}</option>
              </select>
              <Input
                value={evolutionLinkFilter}
                onChange={(event) => setEvolutionLinkFilter(event.target.value)}
                placeholder={t("evolution.filters.linkPlaceholder")}
                className="h-10 rounded-[var(--r-10)] border-[var(--hairline)] bg-[var(--panel-bg)] text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
              />
              <GlassButton variant="secondary" size="sm" onClick={() => void loadEvolutionSignals()}>
                <RefreshCw className="size-4" />
                {t("actions.refresh")}
              </GlassButton>
            </div>
          </GlassCardHeader>

          <GlassCardContent className="px-4 py-4">
            {evolutionSignals.length === 0 ? (
              <EmptyPanel
                icon={<FileSearch className="size-5" />}
                title={t("evolution.emptyTitle")}
                description={t("evolution.empty")}
              />
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {evolutionSignals.map((signal) => {
                  const payload = signal.payload_json
                  const userMessage = payloadText(payload, "user_message")
                  const matchedRules = payloadTextArray(payload, "matched_rules")
                  const classificationMethod = payloadText(payload, "classification_method")
                  return (
                    <div
                      key={signal.id}
                      className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={signalTone(signal.classification)} label={signalLabel(signal.classification, t)} />
                            <StatusPill tone="muted" label={humanizeToken(signal.status)} />
                            <span className="text-xs text-[var(--ink-3)]">
                              {t("evolution.confidence", { value: Math.round(signal.confidence * 100) })}
                            </span>
                          </div>
                          <div className="text-xs text-[var(--ink-3)]">
                            {t("evolution.sourceLabel", { source: humanizeToken(signal.source) })}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-[var(--ink-3)]">
                          {formatDateTime(signal.created_at_unix_ms, locale)}
                        </div>
                      </div>

                      {userMessage ? (
                        <div className="mt-3 rounded-[var(--r-10)] border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-3 py-2 text-sm leading-6 text-[var(--ink)]">
                          {userMessage}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-3)]">
                        {signalLinkedIds(signal).map((id) => (
                          <span key={id} className="rounded-full border border-[var(--hairline)] px-2 py-1">
                            {id}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 grid gap-2 text-xs text-[var(--ink-3)] md:grid-cols-2">
                        <div>
                          <span className="font-medium text-[var(--ink-2)]">{t("evolution.method")}: </span>
                          {classificationMethod ?? "-"}
                        </div>
                        <div>
                          <span className="font-medium text-[var(--ink-2)]">{t("evolution.matchedRules")}: </span>
                          {matchedRules.length > 0 ? matchedRules.join(", ") : "-"}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </GlassCardContent>
        </GlassCard>

        <GlassCard
          blur="sm"
          theme="surface"
          hover="none"
          padding="none"
          className="border-[var(--hairline)] bg-[var(--panel-bg)]/96"
        >
          <GlassCardHeader className="gap-4 border-b border-[var(--hairline)] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <GlassCardTitle className="text-[28px] tracking-[-0.05em] text-[var(--ink)]">
                  {t("priors.title")}
                </GlassCardTitle>
                <GlassCardDescription className="max-w-[720px] text-[13px] leading-6 text-[var(--ink-3)]">
                  {t("priors.description")}
                </GlassCardDescription>
              </div>
              <StatusPill tone="accent" label={t("priors.summary", { count: priors.length })} />
            </div>

            <div className="flex flex-wrap gap-2">
              <FilterPill
                active={activePriorTab === "all"}
                label={t("priors.tabs.all")}
                count={priorBuckets.all.length}
                onClick={() => setActivePriorTab("all")}
              />
              <FilterPill
                active={activePriorTab === "provisional"}
                label={t("priors.tabs.provisional")}
                count={priorBuckets.provisional.length}
                onClick={() => setActivePriorTab("provisional")}
              />
              <FilterPill
                active={activePriorTab === "confirmed"}
                label={t("priors.tabs.confirmed")}
                count={priorBuckets.confirmed.length}
                onClick={() => setActivePriorTab("confirmed")}
              />
              <FilterPill
                active={activePriorTab === "low"}
                label={t("priors.tabs.low")}
                count={priorBuckets.low.length}
                onClick={() => setActivePriorTab("low")}
              />
            </div>
          </GlassCardHeader>

          <GlassCardContent className="px-4 py-4">
            {visiblePriors.length === 0 ? (
              <EmptyPanel
                icon={<Brain className="size-5" />}
                title={t("priors.emptyTitle")}
                description={t("priors.empty")}
              />
            ) : (
              <div className="grid gap-3 xl:grid-cols-5 lg:grid-cols-3 md:grid-cols-2">
                {visiblePriors.map((prior) => (
                  <div
                    key={`${prior.fingerprint_key}:${prior.decision_point}:${prior.action_key}`}
                    className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--panel-bg)] px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold text-[var(--ink)]">
                          {humanizeToken(prior.decision_point)}
                        </div>
                        <div className="mt-1 text-xs text-[var(--ink-3)]">
                          {t("priors.actionLabel", { action: prior.action_key })}
                        </div>
                      </div>
                      <StatusPill
                        tone={maturityTone(prior.maturity)}
                        label={maturityLabel(prior.maturity, t)}
                      />
                    </div>

                    <div className="mt-4 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-[var(--ink-3)]">
                        <span>{t("priors.confidence")}</span>
                        <span className="font-medium text-[var(--ink)]">
                          {Math.round(prior.confidence * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-bg-inset)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent-strong)]"
                          style={{ width: `${Math.round(prior.confidence * 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-xs text-[var(--ink-3)]">
                      <span>{t("priors.evidenceCount", { count: prior.evidence_count })}</span>
                      <span>{formatDateTime(prior.updated_at_unix_ms, locale)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCardContent>
        </GlassCard>
      </div>
    </Container>
  )
}

function MetricSurface({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number
  hint: string
  tone: Exclude<Tone, "muted">
}) {
  return (
    <GlassCard
      blur="sm"
      theme="surface"
      hover="none"
      padding="none"
      className="border-[var(--hairline)] bg-[var(--panel-bg)]/94"
    >
      <GlassCardContent className="flex min-h-[106px] flex-col justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-full border",
              toneClasses(tone),
            )}
          >
            {icon}
          </div>
          <div className="text-sm font-medium text-[var(--ink-2)]">{label}</div>
        </div>

        <div className="mt-4">
          <div className="text-[40px] font-semibold leading-none tracking-[-0.06em] text-[var(--ink)]">
            {value}
          </div>
          <div className="mt-2 text-xs text-[var(--ink-3)]">{hint}</div>
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        toneClasses(tone),
      )}
    >
      {label}
    </span>
  )
}

function FeedbackOptionCard({
  selected,
  tone,
  icon,
  title,
  hint,
  onClick,
}: {
  selected: boolean
  tone: Exclude<Tone, "accent" | "info" | "muted">
  icon: ReactNode
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[126px] flex-col items-center justify-center gap-2 rounded-[var(--r-14)] border px-4 py-4 text-center transition-all duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
        toneClasses(tone),
        selected
          ? "scale-[1.01] shadow-[0_16px_30px_-26px_rgba(15,17,28,0.48)]"
          : "opacity-88 hover:opacity-100",
      )}
    >
      <div>{icon}</div>
      <div className="text-base font-semibold">{title}</div>
      <div className="text-[12px] leading-5 opacity-80">{hint}</div>
    </button>
  )
}

function FilterPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
          : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)] hover:border-[var(--accent-border)] hover:text-[var(--accent-ink)]",
      )}
    >
      <span>{label}</span>
      <span className="opacity-80">({count})</span>
    </button>
  )
}

function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-[var(--r-14)] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)]/52 px-6 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)]">
        {icon}
      </div>
      <div className="space-y-1">
        <div className="text-sm font-semibold text-[var(--ink)]">{title}</div>
        <div className="max-w-md text-sm leading-6 text-[var(--ink-3)]">{description}</div>
      </div>
    </div>
  )
}
