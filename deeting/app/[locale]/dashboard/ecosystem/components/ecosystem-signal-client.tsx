"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  DatabaseZap,
  EyeOff,
  GitBranch,
  LoaderCircle,
  Orbit,
  RadioTower,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Container } from "@/components/ui/common/container"
import {
  acceptExternalExperienceCandidate,
  adoptExternalExperienceCandidate,
  listExternalExperienceCandidates,
  listExternalSourceRecords,
  listExternalSources,
  reviewExternalExperienceCandidate,
  syncExternalSource,
  translateExternalRecordsOnce,
  type ExternalExperienceCandidate,
  type ExternalRawRecord,
  type ExternalSourceRecord,
} from "@/lib/api/external-sources"
import { cn } from "@/lib/utils"
import { Badge } from "@/ui/shadcn/badge"
import { Button } from "@/ui/shadcn/button"
import { ExternalEcosystemSettingsCard } from "./external-ecosystem-settings-card"

const RECORDS_PER_SOURCE = 4
const CANDIDATE_LIMIT = 48

type SourceRecords = Record<string, ExternalRawRecord[]>
type SignalTone = "ok" | "warn" | "info" | "muted" | "danger"
type ReviewLane = "decision" | "saved" | "adopted"

function humanizeToken(value: string | null | undefined) {
  if (!value) return "-"
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDate(value: string | number | null | undefined, locale: string) {
  if (!value) return "-"
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function candidateNeedsDecision(candidate: ExternalExperienceCandidate) {
  return (
    candidate.review_status !== "rejected" &&
    candidate.review_status !== "accepted" &&
    !candidate.accepted_ref
  )
}

function candidateCanAdopt(candidate: ExternalExperienceCandidate) {
  return Boolean(candidate.accepted_ref || candidate.review_status === "accepted")
}

function sourceTone(status: ExternalSourceRecord["status"]): SignalTone {
  if (status === "ready") return "ok"
  if (status === "syncing") return "info"
  if (status === "error") return "danger"
  if (status === "disabled") return "muted"
  return "warn"
}

function toneClasses(tone: SignalTone) {
  if (tone === "ok") return "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-200"
  if (tone === "warn") return "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-200"
  if (tone === "danger") return "border-rose-500/25 bg-rose-500/8 text-rose-700 dark:text-rose-200"
  if (tone === "info") return "border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-200"
  return "border-border/50 bg-muted/20 text-muted-foreground"
}

function replaceCandidate(
  items: ExternalExperienceCandidate[],
  next: ExternalExperienceCandidate,
) {
  return items.map((item) => (item.id === next.id ? next : item))
}

function isLikelyRawPayload(value: string) {
  const text = value.trim()
  return text.startsWith("{") || text.startsWith("[") || /"[\w-]+"\s*:/.test(text)
}

function extractPayloadFacts(payload: string, limit = 4) {
  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return []
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined)
      .slice(0, limit)
      .map(([key, value]) => {
        if (Array.isArray(value)) return `${humanizeToken(key)} ${value.length}`
        if (typeof value === "object") return humanizeToken(key)
        return `${humanizeToken(key)} ${String(value).slice(0, 32)}`
      })
  } catch {
    return []
  }
}

function getCandidateSummary(candidate: ExternalExperienceCandidate, fallback: string) {
  const summary = candidate.summary.trim()
  if (!summary || isLikelyRawPayload(summary)) return fallback
  return summary
}

function getCandidateState(candidate: ExternalExperienceCandidate): ReviewLane {
  if (candidate.adoption_status === "adopted") return "adopted"
  if (candidate.accepted_ref || candidate.review_status === "accepted") return "saved"
  return "decision"
}

export function EcosystemSignalClient() {
  const t = useTranslations("dashboard.ecosystem")
  const commonT = useTranslations("common")
  const locale = useLocale()
  const isTauriRuntime = process.env.NEXT_PUBLIC_IS_TAURI === "true"
  const [sources, setSources] = useState<ExternalSourceRecord[]>([])
  const [candidates, setCandidates] = useState<ExternalExperienceCandidate[]>([])
  const [recordsBySource, setRecordsBySource] = useState<SourceRecords>({})
  const [isLoading, setIsLoading] = useState(false)
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null)
  const [runningCandidateId, setRunningCandidateId] = useState<string | null>(null)
  const [activeLane, setActiveLane] = useState<ReviewLane>("decision")

  const loadSignals = useCallback(async () => {
    if (!isTauriRuntime) return
    setIsLoading(true)
    try {
      const nextSources = await listExternalSources()
      const [nextCandidates, recordPairs] = await Promise.all([
        listExternalExperienceCandidates({ limit: CANDIDATE_LIMIT }),
        Promise.all(
          nextSources.map(async (source) => {
            const records = await listExternalSourceRecords(source.id, RECORDS_PER_SOURCE)
            return [source.id, records] as const
          }),
        ),
      ])
      setSources(nextSources)
      setCandidates(nextCandidates)
      setRecordsBySource(Object.fromEntries(recordPairs))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"))
    } finally {
      setIsLoading(false)
    }
  }, [isTauriRuntime, t])

  useEffect(() => {
    loadSignals().catch(() => {})
  }, [loadSignals])

  const sourceNameById = useMemo(() => {
    return new Map(sources.map((source) => [source.id, source.display_name]))
  }, [sources])

  const decisionCandidates = useMemo(
    () => candidates.filter(candidateNeedsDecision),
    [candidates],
  )
  const acceptedCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.accepted_ref || candidate.review_status === "accepted"),
    [candidates],
  )
  const adoptedCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.adoption_status === "adopted"),
    [candidates],
  )
  const visibleCandidates = useMemo(() => {
    if (activeLane === "saved") return acceptedCandidates
    if (activeLane === "adopted") return adoptedCandidates
    return decisionCandidates
  }, [acceptedCandidates, activeLane, adoptedCandidates, decisionCandidates])
  const recentRecords = useMemo(() => {
    return Object.entries(recordsBySource)
      .flatMap(([sourceId, records]) =>
        records.map((record) => ({
          ...record,
          sourceName: sourceNameById.get(sourceId) ?? t("source.unknown"),
        })),
      )
      .sort((a, b) => b.observed_at_unix_ms - a.observed_at_unix_ms)
      .slice(0, 8)
  }, [recordsBySource, sourceNameById, t])

  const enabledSourceCount = sources.filter((source) => source.is_enabled).length
  const readySourceCount = sources.filter((source) => source.status === "ready").length
  const attentionSourceCount = sources.filter((source) =>
    source.status === "draft" || source.status === "error",
  ).length

  async function handleSourceSync(source: ExternalSourceRecord) {
    setRunningSourceId(source.id)
    try {
      await syncExternalSource(source.id)
      await translateExternalRecordsOnce(20)
      await loadSignals()
      toast.success(t("toast.synced", { name: source.display_name }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.syncFailed"))
    } finally {
      setRunningSourceId(null)
    }
  }

  async function handleIgnore(candidate: ExternalExperienceCandidate) {
    setRunningCandidateId(candidate.id)
    try {
      const next = await reviewExternalExperienceCandidate(candidate.id, "rejected")
      setCandidates((current) => replaceCandidate(current, next))
      toast.success(t("toast.ignored"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.actionFailed"))
    } finally {
      setRunningCandidateId(null)
    }
  }

  async function handleSaveToWiki(candidate: ExternalExperienceCandidate) {
    setRunningCandidateId(candidate.id)
    try {
      const result = await acceptExternalExperienceCandidate(candidate.id, "llm_wiki")
      setCandidates((current) => replaceCandidate(current, result.candidate))
      toast.success(t("toast.savedToWiki"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.actionFailed"))
    } finally {
      setRunningCandidateId(null)
    }
  }

  async function handleAdopt(candidate: ExternalExperienceCandidate) {
    setRunningCandidateId(candidate.id)
    try {
      const result = await adoptExternalExperienceCandidate(candidate.id, "memory")
      setCandidates((current) => replaceCandidate(current, result.candidate))
      toast.success(t("toast.adopted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.actionFailed"))
    } finally {
      setRunningCandidateId(null)
    }
  }

  if (!isTauriRuntime) {
    return (
      <Container size="wide" className="py-8">
        <section className="rounded-lg border border-dashed border-border/60 bg-card/60 p-8">
          <p className="text-sm font-semibold text-foreground">{t("desktopOnly.title")}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("desktopOnly.description")}
          </p>
        </section>
      </Container>
    )
  }

  return (
    <Container size="wide" className="space-y-6 py-8">
      <section className="overflow-hidden rounded-lg border border-border/45 bg-[var(--panel-bg)] shadow-[var(--elev-floating)]">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-md border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-200">
                <Orbit className="mr-1 h-3.5 w-3.5" />
                {t("eyebrow")}
              </Badge>
              <Badge variant="outline" className="rounded-md border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-200">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                {t("guardrail")}
              </Badge>
            </div>
            <div className="mt-6 max-w-3xl">
              <h1 className="text-2xl font-semibold leading-tight text-foreground md:text-4xl">
                {t("title")}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                {t("description")}
              </p>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button type="button" onClick={loadSignals} disabled={isLoading}>
                {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t("actions.refresh")}
              </Button>
              <Button asChild variant="outline">
                <a href="#ecosystem-sources">
                  <Settings2 className="h-4 w-4" />
                  {t("actions.configure")}
                </a>
              </Button>
            </div>
          </div>

          <div className="border-t border-border/40 bg-muted/25 p-5 lg:border-l lg:border-t-0">
            <div className="grid h-full gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <RadarMetric icon={<RadioTower className="h-4 w-4" />} label={t("metrics.sources")} value={enabledSourceCount} hint={t("metrics.sourcesHint", { count: sources.length })} tone="info" />
              <RadarMetric icon={<Sparkles className="h-4 w-4" />} label={t("metrics.needsDecision")} value={decisionCandidates.length} hint={t("metrics.needsDecisionHint")} tone={decisionCandidates.length > 0 ? "warn" : "ok"} />
              <RadarMetric icon={<BookOpenCheck className="h-4 w-4" />} label={t("metrics.savedKnowledge")} value={acceptedCandidates.length} hint={t("metrics.savedKnowledgeHint")} tone="muted" />
              <RadarMetric icon={<BrainCircuit className="h-4 w-4" />} label={t("metrics.agentReady")} value={adoptedCandidates.length} hint={t("metrics.agentReadyHint")} tone="ok" />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className="min-w-0 space-y-4">
          <section className="rounded-lg border border-border/45 bg-card/70">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/35 px-5 py-5">
              <SectionHeader
                icon={<Route className="h-4 w-4" />}
                title={t("suggestions.title")}
                description={t("suggestions.description")}
              />
              <div className="flex rounded-lg border border-border/45 bg-background/70 p-1">
                <LaneButton active={activeLane === "decision"} count={decisionCandidates.length} label={t("lanes.decision")} onClick={() => setActiveLane("decision")} />
                <LaneButton active={activeLane === "saved"} count={acceptedCandidates.length} label={t("lanes.saved")} onClick={() => setActiveLane("saved")} />
                <LaneButton active={activeLane === "adopted"} count={adoptedCandidates.length} label={t("lanes.adopted")} onClick={() => setActiveLane("adopted")} />
              </div>
            </div>

            <div className="p-4 md:p-5">
              {isLoading && candidates.length === 0 ? (
                <SignalLoadingState label={t("loading")} />
              ) : visibleCandidates.length === 0 ? (
                <SignalEmptyState
                  title={activeLane === "decision" ? t("empty.title") : t("empty.archiveTitle")}
                  description={activeLane === "decision" ? t("empty.description") : t("empty.archiveDescription")}
                />
              ) : (
                <div className="grid gap-4">
                  {visibleCandidates.slice(0, 8).map((candidate) => (
                    <SignalCandidateCard
                      key={candidate.id}
                      candidate={candidate}
                      sourceName={sourceNameById.get(candidate.source_id) ?? t("source.unknown")}
                      isRunning={runningCandidateId === candidate.id}
                      onIgnore={() => handleIgnore(candidate)}
                      onSaveToWiki={() => handleSaveToWiki(candidate)}
                      onAdopt={() => handleAdopt(candidate)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border/45 bg-card/70 p-5">
            <SectionHeader
              icon={<DatabaseZap className="h-4 w-4" />}
              title={t("sources.title")}
              description={t("sources.description")}
              compact
            />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <SourceStat label={t("sources.ready")} value={readySourceCount} tone="ok" />
              <SourceStat label={t("sources.attention")} value={attentionSourceCount} tone={attentionSourceCount > 0 ? "warn" : "muted"} />
              <SourceStat label={t("sources.total")} value={sources.length} tone="muted" />
            </div>
            <div className="mt-4 space-y-3">
              {sources.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                  {t("sources.empty")}
                </p>
              ) : (
                sources.map((source) => (
                  <SourceHealthCard
                    key={source.id}
                    source={source}
                    isRunning={runningSourceId === source.id}
                    onSync={() => handleSourceSync(source)}
                  />
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/45 bg-card/70 p-5">
            <SectionHeader
              icon={<Activity className="h-4 w-4" />}
              title={t("flow.title")}
              description={t("flow.description")}
              compact
            />
            <div className="mt-4 space-y-2">
              {recentRecords.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                  {t("flow.empty")}
                </p>
              ) : (
                recentRecords.map((record) => (
                  <SignalFlowItem key={record.id} record={record} locale={locale} />
                ))
              )}
            </div>
            <Button asChild variant="ghost" size="sm" className="mt-4 w-full justify-between">
              <a href="#ecosystem-sources">
                {t("flow.advancedLogs")}
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </section>
        </aside>
      </div>

      <section id="ecosystem-sources" className="scroll-mt-6">
        <ExternalEcosystemSettingsCard
          isTauriRuntime={isTauriRuntime}
          onSourcesChanged={loadSignals}
        />
      </section>

      <p className="text-xs text-muted-foreground">
        {commonT("brand")} · {t("footer")}
      </p>
    </Container>
  )
}

function RadarMetric({
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
  tone: SignalTone
}) {
  return (
    <div className={cn("rounded-lg border p-4", toneClasses(tone))}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium opacity-80">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-3xl font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-2 line-clamp-2 text-xs leading-5 opacity-75">{hint}</p>
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  description,
  compact = false,
}: {
  icon: ReactNode
  title: string
  description: string
  compact?: boolean
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3", compact && "gap-2.5")}>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/75 text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function LaneButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className={cn("rounded-sm px-1.5 tabular-nums", active ? "bg-background/18" : "bg-muted")}>
        {count}
      </span>
    </button>
  )
}

function SignalLoadingState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-6 text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

function SignalEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-200">
        <CheckCircle2 className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}

function SourceStat({ label, value, tone }: { label: string; value: number; tone: SignalTone }) {
  return (
    <div className={cn("rounded-md border px-3 py-2", toneClasses(tone))}>
      <p className="text-[11px] font-medium opacity-75">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function SourceHealthCard({
  source,
  isRunning,
  onSync,
}: {
  source: ExternalSourceRecord
  isRunning: boolean
  onSync: () => void
}) {
  const t = useTranslations("dashboard.ecosystem")
  const locale = useLocale()
  const tone = sourceTone(source.status)
  return (
    <div className="rounded-md border border-border/45 bg-background/65 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{source.display_name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`connector.${source.connector_type}`)} · {source.last_synced_at ? formatDate(source.last_synced_at, locale) : t("sources.neverSynced")}
          </p>
        </div>
        <Badge variant="outline" className={cn("shrink-0 rounded-md border text-[11px]", toneClasses(tone))}>
          {t(`status.${source.status}`)}
        </Badge>
      </div>
      {source.last_error ? (
        <p className="mt-3 line-clamp-2 rounded-md border border-rose-500/20 bg-rose-500/8 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-200">
          {source.last_error}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {source.is_enabled ? t("sources.enabled") : t("sources.disabled")}
        </p>
        {source.connector_type === "manual_import" ? null : (
          <Button type="button" variant="outline" size="xs" onClick={onSync} disabled={isRunning}>
            {isRunning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("actions.syncNow")}
          </Button>
        )}
      </div>
    </div>
  )
}

function SignalCandidateCard({
  candidate,
  sourceName,
  isRunning,
  onIgnore,
  onSaveToWiki,
  onAdopt,
}: {
  candidate: ExternalExperienceCandidate
  sourceName: string
  isRunning: boolean
  onIgnore: () => void
  onSaveToWiki: () => void
  onAdopt: () => void
}) {
  const t = useTranslations("dashboard.ecosystem")
  const locale = useLocale()
  const confidence = Math.round(candidate.confidence * 100)
  const canAdopt = candidateCanAdopt(candidate)
  const isAdopted = candidate.adoption_status === "adopted"
  const fallbackSummary = t("suggestions.rawSummaryFallback", {
    kind: humanizeToken(candidate.candidate_kind),
  })
  const summary = getCandidateSummary(candidate, fallbackSummary)
  const facts = extractPayloadFacts(candidate.canonical_payload_json)

  return (
    <article className="overflow-hidden rounded-lg border border-border/50 bg-background/75 shadow-sm transition-colors hover:bg-background/90">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_210px]">
        <div className="min-w-0 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-200">
              {humanizeToken(candidate.candidate_kind)}
            </Badge>
            <Badge variant="outline" className="rounded-md">
              {t("suggestions.confidence", { value: confidence })}
            </Badge>
            <Badge variant="outline" className="rounded-md">
              {humanizeToken(candidate.validation_status)}
            </Badge>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-snug text-foreground md:text-lg">
            {candidate.title}
          </h3>
          <p className="mt-2 max-w-4xl break-words text-sm leading-6 text-muted-foreground">
            {summary}
          </p>
          {facts.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {facts.map((fact) => (
                <span key={fact} className="rounded-md border border-border/45 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                  {fact}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="border-t border-border/35 bg-muted/20 p-4 lg:border-l lg:border-t-0">
          <div className="space-y-3 text-xs text-muted-foreground">
            <MetaRow label={t("candidate.source")} value={sourceName} />
            <MetaRow label={t("candidate.created")} value={formatDate(candidate.created_at, locale)} />
            <MetaRow label={t("candidate.state")} value={t(`candidate.stateValue.${getCandidateState(candidate)}`)} />
          </div>
        </div>
      </div>

      <div className="border-t border-border/35 px-5 py-4">
        <div className="grid gap-2 md:grid-cols-3">
          <TrustStage
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            label={t("stages.provisional")}
            active
          />
          <TrustStage
            icon={<BookOpenCheck className="h-3.5 w-3.5" />}
            label={candidate.accepted_ref ? t("stages.saved") : t("stages.canSave")}
            active={Boolean(candidate.accepted_ref)}
          />
          <TrustStage
            icon={<BrainCircuit className="h-3.5 w-3.5" />}
            label={isAdopted ? t("stages.adopted") : t("stages.agentCandidate")}
            active={isAdopted}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={onSaveToWiki} disabled={isRunning || Boolean(candidate.accepted_ref) || candidate.review_status === "rejected"}>
            {isRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BookOpenCheck className="h-4 w-4" />}
            {candidate.accepted_ref ? t("actions.saved") : t("actions.saveToWiki")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onAdopt} disabled={isRunning || !canAdopt || isAdopted}>
            <BrainCircuit className="h-4 w-4" />
            {isAdopted ? t("actions.adopted") : t("actions.adoptForAgent")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onIgnore} disabled={isRunning || candidate.review_status === "rejected"}>
            <EyeOff className="h-4 w-4" />
            {t("actions.ignore")}
          </Button>
          {!canAdopt ? (
            <p className="text-xs text-muted-foreground">{t("suggestions.adoptHint")}</p>
          ) : null}
        </div>

        {candidate.adoption_error ? (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {candidate.adoption_error}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground/70">{label}</p>
      <p className="mt-0.5 truncate font-medium text-foreground">{value}</p>
    </div>
  )
}

function TrustStage({
  icon,
  label,
  active,
}: {
  icon: ReactNode
  label: string
  active: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
        active
          ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-200"
          : "border-border/50 bg-muted/20 text-muted-foreground",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </div>
  )
}

function SignalFlowItem({
  record,
  locale,
}: {
  record: ExternalRawRecord & { sourceName: string }
  locale: string
}) {
  return (
    <div className="rounded-md border border-border/45 bg-background/65 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/30 text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {record.source_asset_id}
            </p>
            <Badge variant="outline" className="shrink-0 rounded-md text-[11px]">
              {humanizeToken(record.translation_status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {record.sourceName} · {formatDate(record.observed_at_unix_ms, locale)}
          </p>
        </div>
      </div>
    </div>
  )
}
