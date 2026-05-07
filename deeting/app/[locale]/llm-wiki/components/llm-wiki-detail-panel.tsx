"use client"

import {
  FileText,
  Zap,
  CheckCircle2,
  XCircle,
  Settings,
  Clock,
  RefreshCw,
  Wrench,
  Sparkles,
  Search,
  BrainCircuit,
  MessageSquareText,
  DatabaseZap,
  AlertTriangle,
  FolderOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/common/glass-button"
import type {
  LocalLlmWikiCorpusSearchHit,
  LocalLlmWikiAutomationSuggestion,
  LocalLlmWikiState,
  IngestLocalLlmWikiSelectionResult,
  LocalLlmWikiLintReport,
} from "@/lib/api/llm-wiki"
import type { ListTab } from "./llm-wiki-list-panel"

type Translation = (key: string, values?: Record<string, string | number>) => string

interface DetailPanelProps {
  t: Translation
  activeTab: ListTab
  // Search hit detail
  selectedCorpusHit: LocalLlmWikiCorpusSearchHit | null
  // Suggestion detail
  selectedSuggestion: LocalLlmWikiAutomationSuggestion | null
  executingSuggestionId: string | null
  dismissingSuggestionId: string | null
  batchDismissingActionKind: string | null
  executeAutomationSuggestion: (suggestion: LocalLlmWikiAutomationSuggestion) => Promise<void>
  dismissAutomationSuggestion: (suggestionId: string) => Promise<void>
  // Maintenance
  state: LocalLlmWikiState | null
  lastIngestResult: IngestLocalLlmWikiSelectionResult | null
  lastLintReport: LocalLlmWikiLintReport | null
  onOpenSetup: () => void
}

export function DetailPanel({
  t,
  activeTab,
  selectedCorpusHit,
  selectedSuggestion,
  executingSuggestionId,
  dismissingSuggestionId,
  batchDismissingActionKind,
  executeAutomationSuggestion,
  dismissAutomationSuggestion,
  state,
  lastIngestResult,
  lastLintReport,
  onOpenSetup,
}: DetailPanelProps) {
  return (
    <div className="flex h-full flex-col rounded-[var(--r-14)] border border-white/10 bg-[var(--card)]/60 backdrop-blur-xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--hairline)]/50 px-5 py-3">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          {activeTab === "search" ? t("corpus.inspector.title") :
           activeTab === "suggestions" ? t("automation.suggestions.title") :
           t("maintenance.title")}
        </h3>
        {activeTab === "maintenance" && (
          <GlassButton size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onOpenSetup}>
            <Settings className="size-3" />
          </GlassButton>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === "search" && (
          <CorpusHitDetail t={t} hit={selectedCorpusHit} />
        )}
        {activeTab === "suggestions" && (
          <SuggestionDetail
            t={t}
            suggestion={selectedSuggestion}
            executingSuggestionId={executingSuggestionId}
            dismissingSuggestionId={dismissingSuggestionId}
            batchDismissingActionKind={batchDismissingActionKind}
            executeAutomationSuggestion={executeAutomationSuggestion}
            dismissAutomationSuggestion={dismissAutomationSuggestion}
          />
        )}
        {activeTab === "maintenance" && (
          <MaintenanceDetail
            t={t}
            state={state}
            lastIngestResult={lastIngestResult}
            lastLintReport={lastLintReport}
          />
        )}
      </div>
    </div>
  )
}

/* ─── Corpus Hit Detail ─────────────────────────────────────────────── */

function CorpusHitDetail({ t, hit }: { t: Translation; hit: LocalLlmWikiCorpusSearchHit | null }) {
  if (!hit) {
    return (
      <EmptyState
        icon={<FileText className="size-6" />}
        title={t("corpus.inspector.empty")}
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Title and scope */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-base font-bold text-[var(--foreground)]">{hit.title}</h4>
          <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent-strong)]">
            {hit.scope}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--ink)]">
          {hit.relativePath}
        </p>
      </div>

      {/* Steps / Timeline */}
      <div className="space-y-3">
        <TimelineItem
          icon={<CheckCircle2 className="size-3.5" />}
          color="text-[var(--ok)]"
          bgColor="bg-[var(--ok-soft)]"
          title={t("corpus.inspector.summary")}
          time=""
        />
        <div className="ml-6 rounded-[var(--r-10)] border border-[var(--hairline)]/50 bg-[var(--panel-bg)]/30 p-3">
          <p className="text-xs leading-relaxed text-[var(--foreground)]">{hit.summary}</p>
        </div>
      </div>

      {/* Scores */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{t("corpus.inspector.score")}</p>
        <div className="grid grid-cols-3 gap-2">
          <ScoreBar label="Lexical" value={hit.lexicalScore} max={1} color="var(--info)" />
          <ScoreBar label="Semantic" value={hit.semanticScore} max={1} color="var(--accent-strong)" />
          <ScoreBar label="Combined" value={hit.score} max={1} color="var(--ok)" />
        </div>
      </div>

      {/* Agent uses note */}
      <div className="rounded-[var(--r-10)] border border-[var(--accent-border)]/30 bg-[var(--accent-soft)]/20 p-3.5">
        <p className="text-[11px] font-medium text-[var(--accent-strong)]">{t("corpus.inspector.agentUses.title")}</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--ink)]">{t("corpus.inspector.agentUses.description")}</p>
      </div>
    </div>
  )
}

/* ─── Suggestion helpers ────────────────────────────────────────────── */

const SUGGESTION_COPY_MAP: Record<string, string> = {
  "on_vault_bound:reconcile_corpus": "initialCorpusSync",
  "on_workspace_bootstrapped:create_maintainer_agent": "createMaintainerAgent",
  "on_maintenance_schedule:reconcile_corpus": "refreshCorpus",
  "on_maintenance_schedule:run_maintenance_review": "maintenanceReview",
  "on_session_end:crystallize_session_summary": "sessionCrystallization",
  "on_valuable_answer:crystallize_session_summary": "valuableAnswer",
  "on_corpus_reconcile_completed:inspect_corpus": "inspectAfterSync",
  "on_new_source:run_maintenance_review": "reviewNewSources",
  "on_repeated_stable_conclusion:promote_to_memory": "memoryPromotion",
}

function resolveSuggestionTitle(t: Translation, suggestion: LocalLlmWikiAutomationSuggestion): string {
  const copyKey = SUGGESTION_COPY_MAP[`${suggestion.trigger}:${suggestion.actionKind}`]
  if (!copyKey) return suggestion.title
  const translated = t(`automation.suggestionCopy.${copyKey}.title`)
  return translated === `automation.suggestionCopy.${copyKey}.title` ? suggestion.title : translated
}

function resolveSuggestionDescription(t: Translation, suggestion: LocalLlmWikiAutomationSuggestion): string {
  const copyKey = SUGGESTION_COPY_MAP[`${suggestion.trigger}:${suggestion.actionKind}`]
  if (!copyKey) return suggestion.description
  const translated = t(`automation.suggestionCopy.${copyKey}.description`)
  return translated === `automation.suggestionCopy.${copyKey}.description` ? suggestion.description : translated
}

function renderActionKindIcon(actionKind: string, className: string) {
  switch (actionKind) {
    case "reconcile_corpus": return <RefreshCw className={className} />
    case "create_maintainer_agent": return <Settings className={className} />
    case "inspect_corpus": return <Search className={className} />
    case "run_maintenance_review": return <Wrench className={className} />
    case "crystallize_session_summary": return <Sparkles className={className} />
    case "promote_to_memory": return <BrainCircuit className={className} />
    default: return <Zap className={className} />
  }
}

function getActionKindLabel(t: Translation, actionKind: string): string {
  const key = `automation.actions.${actionKind}`
  const label = t(key)
  return label === key ? actionKind.replace(/_/g, " ") : label
}

function getTriggerLabel(t: Translation, trigger: string): string {
  const key = `automation.triggers.${trigger}`
  const label = t(key)
  return label === key ? trigger.replace(/_/g, " ") : label
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "pending": return "bg-[var(--warn-soft)] text-[var(--warn)]"
    case "completed": return "bg-[var(--ok-soft)] text-[var(--ok)]"
    case "superseded": return "bg-[var(--panel-bg)] text-[var(--ink)]"
    case "stale": return "bg-amber-500/15 text-amber-600"
    case "dismissed": return "bg-[var(--panel-bg)] text-[var(--ink)]"
    case "failed": return "bg-[var(--danger-soft)] text-[var(--danger)]"
    case "promoted": return "bg-[var(--ok-soft)] text-[var(--ok)]"
    case "expired": return "bg-[var(--panel-bg)] text-[var(--ink)]"
    default: return "bg-[var(--panel-bg)] text-[var(--ink)]"
  }
}

function getStatusLabel(t: Translation, status: string): string {
  const key = `automation.dispositions.${status}`
  const label = t(key)
  return label === key ? status : label
}

/* ─── Suggestion Detail ─────────────────────────────────────────────── */

function SuggestionDetail({
  t,
  suggestion,
  executingSuggestionId,
  dismissingSuggestionId,
  batchDismissingActionKind,
  executeAutomationSuggestion,
  dismissAutomationSuggestion,
}: {
  t: Translation
  suggestion: LocalLlmWikiAutomationSuggestion | null
  executingSuggestionId: string | null
  dismissingSuggestionId: string | null
  batchDismissingActionKind: string | null
  executeAutomationSuggestion: (suggestion: LocalLlmWikiAutomationSuggestion) => Promise<void>
  dismissAutomationSuggestion: (suggestionId: string) => Promise<void>
}) {
  if (!suggestion) {
    return (
      <EmptyState
        icon={<Zap className="size-6" />}
        title={t("automation.suggestions.empty")}
      />
    )
  }

  const isAnyProcessing = executingSuggestionId !== null || dismissingSuggestionId !== null || batchDismissingActionKind !== null

  // Extract useful metadata for display
  const metadata = suggestion.metadata as Record<string, unknown> | null | undefined
  const metaGoal = metadata?.goal as string | undefined
  const metaSessionId = metadata?.sessionId as string | undefined
  const metaMemoryContent = metadata?.memoryContent as string | undefined
  const metaRepeatCount = metadata?.repeatCount as number | undefined

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-base font-bold text-[var(--foreground)]">{resolveSuggestionTitle(t, suggestion)}</h4>
          <span className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold",
            getStatusBadgeClass(suggestion.status)
          )}>
            {getStatusLabel(t, suggestion.status)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-soft)]/40 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">
            {renderActionKindIcon(suggestion.actionKind, "size-3")}
            {getActionKindLabel(t, suggestion.actionKind)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--panel-bg)]/60 px-2 py-0.5 text-[10px] text-[var(--ink)]">
            <Clock className="size-3" />
            {getTriggerLabel(t, suggestion.trigger)}
          </span>
          {typeof metaRepeatCount === "number" && metaRepeatCount > 1 && (
            <span className="rounded-md bg-[var(--info-soft)]/40 px-2 py-0.5 text-[10px] text-[var(--info)]">
              {t("automation.suggestions.repeatCount", { count: metaRepeatCount })}
            </span>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        <TimelineItem
          icon={<Zap className="size-3.5" />}
          color="text-[var(--warn)]"
          bgColor="bg-[var(--warn-soft)]"
          title={getTriggerLabel(t, suggestion.trigger)}
          time={suggestion.createdAt}
        />
        <div className="ml-6 rounded-[var(--r-10)] border border-[var(--hairline)]/50 bg-[var(--panel-bg)]/30 p-3">
          <p className="text-xs leading-relaxed text-[var(--foreground)]">{resolveSuggestionDescription(t, suggestion)}</p>
        </div>
        <TimelineItem
          icon={renderActionKindIcon(suggestion.actionKind, "size-3.5")}
          color="text-[var(--accent-strong)]"
          bgColor="bg-[var(--accent-soft)]"
          title={getActionKindLabel(t, suggestion.actionKind)}
          time={suggestion.updatedAt}
        />
      </div>

      {/* Metadata preview */}
      {(metaGoal || metaMemoryContent) && (
        <div className="space-y-2 rounded-[var(--r-10)] border border-[var(--hairline)]/50 bg-[var(--panel-bg)]/20 p-3.5">
          <p className="text-[11px] font-semibold text-[var(--foreground)]">{t("automation.suggestions.metaTitle")}</p>
          {metaGoal && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-[var(--ink)]">{t("automation.suggestions.metaGoal")}</p>
              <p className="text-[11px] leading-relaxed text-[var(--foreground)]">{metaGoal}</p>
            </div>
          )}
          {metaMemoryContent && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-[var(--ink)]">{t("automation.suggestions.metaMemoryContent")}</p>
              <p className="text-[11px] leading-relaxed text-[var(--foreground)]">{metaMemoryContent}</p>
            </div>
          )}
          {metaSessionId && (
            <p className="text-[10px] text-[var(--ink)]">{t("automation.suggestions.metaSessionId", { id: metaSessionId.slice(0, 8) })}</p>
          )}
        </div>
      )}

      {/* Action buttons — styled like the design reference's feedback buttons */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <GlassButton
          variant="success"
          className="h-11"
          onClick={() => executeAutomationSuggestion(suggestion)}
          loading={executingSuggestionId === suggestion.id}
          disabled={isAnyProcessing}
        >
          <CheckCircle2 className="size-4" />
          {t("automation.suggestions.execute")}
        </GlassButton>
        <GlassButton
          variant="secondary"
          className="h-11"
          onClick={() => dismissAutomationSuggestion(suggestion.id)}
          loading={dismissingSuggestionId === suggestion.id}
          disabled={isAnyProcessing}
        >
          <XCircle className="size-4" />
          {t("automation.suggestions.dismiss")}
        </GlassButton>
      </div>
    </div>
  )
}

/* ─── Maintenance Detail ────────────────────────────────────────────── */

function MaintenanceDetail({
  t,
  state,
  lastIngestResult,
  lastLintReport,
}: {
  t: Translation
  state: LocalLlmWikiState | null
  lastIngestResult: IngestLocalLlmWikiSelectionResult | null
  lastLintReport: LocalLlmWikiLintReport | null
}) {
  const corpus = state?.corpusStatus
  const pendingSuggestions = state?.automation?.suggestions.filter((s) => s.status === "pending") ?? []
  const recentAudit = state?.automation?.audit.slice(0, 4) ?? []
  const lintFindingCount = lastLintReport?.findingCount ?? state?.lastLintReport?.findingCount ?? 0
  const lintGeneratedAt = lastLintReport?.generatedAt ?? state?.lastLintReport?.generatedAt ?? null
  const sourcePagesCreated = lastIngestResult?.sourcePagesCreated ?? []
  const rawFilesCopied = lastIngestResult?.rawFilesCopied ?? []
  const hasRecentArtifacts = sourcePagesCreated.length > 0 || rawFilesCopied.length > 0
  const queueCount = corpus?.queuedChangeCount ?? 0
  const pendingCount = corpus?.pendingNoteCount ?? 0
  const failedCount = corpus?.failedNoteCount ?? 0

  return (
    <div className="space-y-5">
      <div className="rounded-[var(--r-12)] border border-[var(--accent-border)]/30 bg-[var(--accent-soft)]/20 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r-10)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <Wrench className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--foreground)]">{t("maintenance.console.title")}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink)]">{t("maintenance.console.description")}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTile
          icon={<Clock className="size-3.5" />}
          label={t("maintenance.console.queue")}
          value={queueCount + pendingCount}
          tone={queueCount + pendingCount > 0 ? "warning" : "neutral"}
        />
        <MetricTile
          icon={<AlertTriangle className="size-3.5" />}
          label={t("maintenance.console.failed")}
          value={failedCount}
          tone={failedCount > 0 ? "danger" : "neutral"}
        />
        <MetricTile
          icon={<Zap className="size-3.5" />}
          label={t("maintenance.console.suggestions")}
          value={pendingSuggestions.length}
          tone={pendingSuggestions.length > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{t("maintenance.console.dailySources.title")}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <EntryPoint
            icon={<MessageSquareText className="size-3.5" />}
            title={t("maintenance.console.dailySources.chat.title")}
            description={t("maintenance.console.dailySources.chat.description")}
          />
          <EntryPoint
            icon={<DatabaseZap className="size-3.5" />}
            title={t("maintenance.console.dailySources.knowledge.title")}
            description={t("maintenance.console.dailySources.knowledge.description")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{t("maintenance.console.recentArtifacts.title")}</p>
        {hasRecentArtifacts ? (
          <div className="space-y-1.5">
            {sourcePagesCreated.slice(0, 4).map((path) => (
              <ArtifactRow key={path} icon={<FileText className="size-3" />} path={path} label={t("maintenance.console.recentArtifacts.sourcePage")} />
            ))}
            {rawFilesCopied.slice(0, 4).map((path) => (
              <ArtifactRow key={path} icon={<FolderOpen className="size-3" />} path={path} label={t("maintenance.console.recentArtifacts.rawCopy")} />
            ))}
          </div>
        ) : (
          <EmptyPanel text={t("maintenance.console.recentArtifacts.empty")} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatusPanel
          title={t("maintenance.console.lint.title")}
          description={
            lintGeneratedAt
              ? t("maintenance.console.lint.summary", { count: lintFindingCount, generatedAt: lintGeneratedAt })
              : t("maintenance.console.lint.empty")
          }
          tone={lintFindingCount > 0 ? "warning" : "neutral"}
        />
        <StatusPanel
          title={t("maintenance.console.audit.title")}
          description={recentAudit[0]?.message ?? t("maintenance.console.audit.empty")}
          tone={recentAudit.length > 0 ? "accent" : "neutral"}
        />
      </div>
    </div>
  )
}

/* ─── Shared Sub-components ─────────────────────────────────────────── */

function MetricTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: "neutral" | "warning" | "danger"
}) {
  return (
    <div className={cn(
      "rounded-[var(--r-10)] border px-3 py-2.5",
      tone === "warning" ? "border-[var(--warn)]/20 bg-[var(--warn-soft)]/30" :
      tone === "danger" ? "border-[var(--danger)]/20 bg-[var(--danger-soft)]/30" :
      "border-[var(--hairline)]/50 bg-[var(--panel-bg)]/20"
    )}>
      <div className="flex items-center gap-1.5 text-[var(--ink)]">
        {icon}
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-[var(--foreground)]">{value}</p>
    </div>
  )
}

function EntryPoint({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-[var(--r-10)] border border-[var(--hairline)]/50 bg-[var(--panel-bg)]/25 p-3">
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          {icon}
        </div>
        <p className="text-xs font-semibold text-[var(--foreground)]">{title}</p>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--ink)]">{description}</p>
    </div>
  )
}

function ArtifactRow({ icon, path, label }: { icon: React.ReactNode; path: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--hairline)]/40 bg-[var(--panel-bg)]/25 px-3 py-2">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-[var(--ink)]">{label}</p>
        <p className="truncate text-xs font-semibold text-[var(--foreground)]">{path}</p>
      </div>
    </div>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--r-10)] border border-dashed border-[var(--hairline)]/60 bg-[var(--panel-bg)]/15 px-3 py-4 text-center text-[11px] leading-relaxed text-[var(--ink)]">
      {text}
    </div>
  )
}

function StatusPanel({
  title,
  description,
  tone,
}: {
  title: string
  description: string
  tone: "neutral" | "warning" | "accent"
}) {
  return (
    <div className={cn(
      "rounded-[var(--r-10)] border p-3",
      tone === "warning" ? "border-[var(--warn)]/20 bg-[var(--warn-soft)]/25" :
      tone === "accent" ? "border-[var(--accent-border)]/30 bg-[var(--accent-soft)]/20" :
      "border-[var(--hairline)]/50 bg-[var(--panel-bg)]/20"
    )}>
      <p className="text-xs font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink)]">{description}</p>
    </div>
  )
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-[var(--panel-bg)] text-[var(--ink)]">
        {icon}
      </div>
      <p className="mt-4 max-w-[280px] text-xs leading-relaxed text-[var(--ink)]">{title}</p>
    </div>
  )
}

function TimelineItem({
  icon,
  color,
  bgColor,
  title,
  time,
}: {
  icon: React.ReactNode
  color: string
  bgColor: string
  title: string
  time: string
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn("flex size-5 items-center justify-center rounded-full", bgColor, color)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-[var(--foreground)]">{title}</span>
      </div>
      {time && <span className="text-[10px] text-[var(--ink)]">{time}</span>}
    </div>
  )
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--ink)]">{label}</span>
        <span className="text-[10px] font-semibold text-[var(--foreground)]">{value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-bg)] border border-[var(--hairline)]/30">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
