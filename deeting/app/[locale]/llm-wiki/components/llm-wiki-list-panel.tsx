"use client"

import * as React from "react"
import {
  Search,
  FileText,
  Zap,
  Wrench,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Upload,
  AlertTriangle,
  Clock,
  Sparkles,
  RefreshCw,
  Settings,
  BrainCircuit,
  Archive,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/common/glass-button"
import { Input } from "@/components/ui/shadcn/input"
import { Textarea } from "@/components/ui/shadcn/textarea"
import type {
  LocalLlmWikiCorpusSearchHit,
  LocalLlmWikiAutomationSuggestion,
  IngestLocalLlmWikiSelectionResult,
  LocalLlmWikiLintReport,
} from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

export type ListTab = "search" | "suggestions" | "maintenance"

interface ListPanelProps {
  t: Translation
  activeTab: ListTab
  setActiveTab: (tab: ListTab) => void
  // Search
  corpusQuery: string
  corpusHits: LocalLlmWikiCorpusSearchHit[]
  selectedCorpusHitId: string | null
  hasSearchedCorpus: boolean
  corpusSearchError: string | null
  isSearchingCorpus: boolean
  isSyncingCorpus: boolean
  setCorpusQuery: (v: string) => void
  setSelectedCorpusHitId: (id: string | null) => void
  searchCorpus: () => Promise<void>
  syncCorpus: () => Promise<void>
  // Suggestions
  suggestions: LocalLlmWikiAutomationSuggestion[]
  selectedSuggestionId: string | null
  setSelectedSuggestionId: (id: string | null) => void
  executingSuggestionId: string | null
  dismissingSuggestionId: string | null
  batchDismissingActionKind: string | null
  executeAutomationSuggestion: (suggestion: LocalLlmWikiAutomationSuggestion) => Promise<void>
  dismissAutomationSuggestion: (suggestionId: string) => Promise<void>
  dismissBatchAutomationSuggestions: (actionKind: string, suggestionIds: string[]) => Promise<void>
  // Maintenance
  ingestSelectionInput: string
  isIngestingSelection: boolean
  lastIngestResult: IngestLocalLlmWikiSelectionResult | null
  isRunningLint: boolean
  lastLintReport: LocalLlmWikiLintReport | null
  setIngestSelectionInput: (v: string) => void
  ingestSelection: () => Promise<void>
  runLint: () => Promise<void>
}

const TAB_ICONS = {
  search: FileText,
  suggestions: Zap,
  maintenance: Wrench,
} as const

export function ListPanel({
  t,
  activeTab,
  setActiveTab,
  corpusQuery,
  corpusHits,
  selectedCorpusHitId,
  hasSearchedCorpus,
  corpusSearchError,
  isSearchingCorpus,
  isSyncingCorpus,
  setCorpusQuery,
  setSelectedCorpusHitId,
  searchCorpus,
  syncCorpus,
  suggestions,
  selectedSuggestionId,
  setSelectedSuggestionId,
  executingSuggestionId,
  dismissingSuggestionId,
  batchDismissingActionKind,
  executeAutomationSuggestion,
  dismissAutomationSuggestion,
  dismissBatchAutomationSuggestions,
  ingestSelectionInput,
  isIngestingSelection,
  lastIngestResult,
  isRunningLint,
  lastLintReport,
  setIngestSelectionInput,
  ingestSelection,
  runLint,
}: ListPanelProps) {
  const tabs: { key: ListTab; label: string }[] = [
    { key: "search", label: t("corpus.title") },
    { key: "suggestions", label: t("automation.suggestions.title") },
    { key: "maintenance", label: t("maintenance.title") },
  ]

  return (
    <div className="flex h-full flex-col rounded-[var(--r-14)] border border-white/10 bg-[var(--card)]/60 backdrop-blur-xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)]">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--hairline)]/50">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab.key]
          const count = tab.key === "suggestions" ? suggestions.filter((s) => s.status === "pending").length : undefined
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all duration-200",
                activeTab === tab.key
                  ? "border-b-2 border-[var(--accent-strong)] text-[var(--accent-strong)] bg-[var(--accent-soft)]/30"
                  : "text-[var(--ink)] hover:text-[var(--foreground)] hover:bg-[var(--panel-bg)]/40"
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
              {count !== undefined && count > 0 && (
                <span className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--warn)] text-[9px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "search" && (
          <SearchTabContent
            t={t}
            corpusQuery={corpusQuery}
            corpusHits={corpusHits}
            selectedCorpusHitId={selectedCorpusHitId}
            hasSearchedCorpus={hasSearchedCorpus}
            corpusSearchError={corpusSearchError}
            isSearchingCorpus={isSearchingCorpus}
            isSyncingCorpus={isSyncingCorpus}
            setCorpusQuery={setCorpusQuery}
            setSelectedCorpusHitId={setSelectedCorpusHitId}
            searchCorpus={searchCorpus}
            syncCorpus={syncCorpus}
          />
        )}
        {activeTab === "suggestions" && (
          <SuggestionsTabContent
            t={t}
            suggestions={suggestions}
            selectedSuggestionId={selectedSuggestionId}
            setSelectedSuggestionId={setSelectedSuggestionId}
            executingSuggestionId={executingSuggestionId}
            dismissingSuggestionId={dismissingSuggestionId}
            batchDismissingActionKind={batchDismissingActionKind}
            executeAutomationSuggestion={executeAutomationSuggestion}
            dismissAutomationSuggestion={dismissAutomationSuggestion}
            dismissBatchAutomationSuggestions={dismissBatchAutomationSuggestions}
          />
        )}
        {activeTab === "maintenance" && (
          <MaintenanceTabContent
            t={t}
            ingestSelectionInput={ingestSelectionInput}
            isIngestingSelection={isIngestingSelection}
            lastIngestResult={lastIngestResult}
            isRunningLint={isRunningLint}
            lastLintReport={lastLintReport}
            setIngestSelectionInput={setIngestSelectionInput}
            ingestSelection={ingestSelection}
            runLint={runLint}
          />
        )}
      </div>
    </div>
  )
}

/* ─── Search Tab ────────────────────────────────────────────────────── */

function SearchTabContent({
  t,
  corpusQuery,
  corpusHits,
  selectedCorpusHitId,
  hasSearchedCorpus,
  corpusSearchError,
  isSearchingCorpus,
  isSyncingCorpus,
  setCorpusQuery,
  setSelectedCorpusHitId,
  searchCorpus,
  syncCorpus,
}: {
  t: Translation
  corpusQuery: string
  corpusHits: LocalLlmWikiCorpusSearchHit[]
  selectedCorpusHitId: string | null
  hasSearchedCorpus: boolean
  corpusSearchError: string | null
  isSearchingCorpus: boolean
  isSyncingCorpus: boolean
  setCorpusQuery: (v: string) => void
  setSelectedCorpusHitId: (id: string | null) => void
  searchCorpus: () => Promise<void>
  syncCorpus: () => Promise<void>
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="flex gap-2 border-b border-[var(--hairline)]/30 p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--ink)]" />
          <Input
            value={corpusQuery}
            onChange={(e) => setCorpusQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchCorpus()}
            placeholder={t("corpus.preview.placeholder")}
            className="h-8 rounded-[var(--r-6)] border-[var(--hairline)]/50 bg-[var(--panel-bg)]/40 pl-8 text-xs"
          />
        </div>
        <GlassButton size="sm" className="h-8 text-[11px]" onClick={searchCorpus} loading={isSearchingCorpus}>
          <Search className="size-3" />
        </GlassButton>
        <GlassButton size="sm" variant="secondary" className="h-8 text-[11px]" onClick={syncCorpus} loading={isSyncingCorpus}>
          {t("corpus.sync")}
        </GlassButton>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {!hasSearchedCorpus ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-[var(--panel-bg)] text-[var(--ink)]">
              <Search className="size-5" />
            </div>
            <p className="mt-3 text-xs text-[var(--ink)]">{t("corpus.preview.empty")}</p>
          </div>
        ) : corpusSearchError ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-[var(--danger)]">{corpusSearchError}</p>
          </div>
        ) : corpusHits.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-[var(--ink)]">{t("corpus.preview.noResults")}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--hairline)]/30">
            {corpusHits.map((hit) => (
              <button
                key={hit.assetId}
                onClick={() => setSelectedCorpusHitId(hit.assetId)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-all duration-150",
                  selectedCorpusHitId === hit.assetId
                    ? "bg-[var(--accent-soft)]/50 border-l-2 border-l-[var(--accent-strong)]"
                    : "hover:bg-[var(--panel-bg)]/40 border-l-2 border-l-transparent"
                )}
              >
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--panel-bg)] text-[var(--ink)]">
                  <FileText className="size-3" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn(
                      "truncate text-xs font-semibold",
                      selectedCorpusHitId === hit.assetId ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]"
                    )}>
                      {hit.title}
                    </p>
                    <span className="shrink-0 rounded-md bg-[var(--panel-bg)] px-1.5 py-0.5 text-[9px] text-[var(--ink)]">
                      {hit.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-[var(--ink)] line-clamp-1">{hit.summary}</p>
                  <div className="mt-1 flex items-center gap-2 text-[9px] text-[var(--ink)]">
                    <span className="rounded bg-[var(--accent-soft)]/60 px-1.5 py-0.5 text-[var(--accent-strong)]">
                      {hit.scope}
                    </span>
                  </div>
                </div>
                <ChevronRight className={cn(
                  "mt-1 size-3 shrink-0 transition-colors",
                  selectedCorpusHitId === hit.assetId ? "text-[var(--accent-strong)]" : "text-[var(--ink)]"
                )} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Suggestions Tab ───────────────────────────────────────────────── */

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

function getActionKindIcon(actionKind: string) {
  switch (actionKind) {
    case "reconcile_corpus": return RefreshCw
    case "create_maintainer_agent": return Settings
    case "inspect_corpus": return Search
    case "run_maintenance_review": return Wrench
    case "crystallize_session_summary": return Sparkles
    case "promote_to_memory": return BrainCircuit
    default: return Zap
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

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function onPressableKeyDown(event: React.KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    action()
  }
}

/* ─── Suggestions Tab ───────────────────────────────────────────────── */

function SuggestionsTabContent({
  t,
  suggestions,
  selectedSuggestionId,
  setSelectedSuggestionId,
  executingSuggestionId,
  dismissingSuggestionId,
  batchDismissingActionKind,
  executeAutomationSuggestion,
  dismissAutomationSuggestion,
  dismissBatchAutomationSuggestions,
}: {
  t: Translation
  suggestions: LocalLlmWikiAutomationSuggestion[]
  selectedSuggestionId: string | null
  setSelectedSuggestionId: (id: string | null) => void
  executingSuggestionId: string | null
  dismissingSuggestionId: string | null
  batchDismissingActionKind: string | null
  executeAutomationSuggestion: (suggestion: LocalLlmWikiAutomationSuggestion) => Promise<void>
  dismissAutomationSuggestion: (suggestionId: string) => Promise<void>
  dismissBatchAutomationSuggestions: (actionKind: string, suggestionIds: string[]) => Promise<void>
}) {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
  const [showResolved, setShowResolved] = React.useState(false)

  const toggleGroup = React.useCallback((actionKind: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(actionKind)) next.delete(actionKind)
      else next.add(actionKind)
      return next
    })
  }, [])

  const pendingSuggestions = React.useMemo(
    () => suggestions.filter((s) => s.status === "pending"),
    [suggestions]
  )

  const resolvedSuggestions = React.useMemo(
    () => suggestions.filter((s) => s.status !== "pending"),
    [suggestions]
  )

  const groupedPending = React.useMemo(() => {
    const map = new Map<string, LocalLlmWikiAutomationSuggestion[]>()
    for (const s of pendingSuggestions) {
      const list = map.get(s.actionKind) ?? []
      list.push(s)
      map.set(s.actionKind, list)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [pendingSuggestions])

  const isAnyProcessing = executingSuggestionId !== null || dismissingSuggestionId !== null || batchDismissingActionKind !== null

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
          <CheckCircle2 className="size-5" />
        </div>
        <p className="mt-3 text-xs font-medium text-[var(--foreground)]">{t("automation.suggestions.emptyTitle")}</p>
        <p className="mt-1 text-[11px] text-[var(--ink)]">{t("automation.suggestions.emptySubtitle")}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Pending suggestions grouped by actionKind */}
        {groupedPending.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
              <CheckCircle2 className="size-5" />
            </div>
            <p className="mt-3 text-xs font-medium text-[var(--foreground)]">{t("automation.suggestions.emptyTitle")}</p>
            <p className="mt-1 text-[11px] text-[var(--ink)]">{t("automation.suggestions.emptySubtitle")}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--hairline)]/30">
            {groupedPending.map(([actionKind, group]) => {
              const isCollapsed = collapsedGroups.has(actionKind)
              const ActionIcon = getActionKindIcon(actionKind)
              const actionLabel = getActionKindLabel(t, actionKind)
              const canBatchDismiss = group.length > 1
              return (
                <div key={actionKind} className="">
                  {/* Group header */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(actionKind)}
                    onKeyDown={(event) => onPressableKeyDown(event, () => toggleGroup(actionKind))}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--panel-bg)]/30 transition-colors"
                  >
                    <div className="flex size-5 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                      <ActionIcon className="size-3" />
                    </div>
                    <span className="flex-1 text-xs font-semibold text-[var(--foreground)]">{actionLabel}</span>
                    <span className="rounded-full bg-[var(--warn-soft)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--warn)]">
                      {group.length}
                    </span>
                    {canBatchDismiss && (
                      <GlassButton
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[9px]"
                        onClick={(e) => {
                          e.stopPropagation()
                          dismissBatchAutomationSuggestions(actionKind, group.map((s) => s.id))
                        }}
                        loading={batchDismissingActionKind === actionKind}
                        disabled={isAnyProcessing}
                      >
                        <XCircle className="size-2.5" />
                        {t("automation.suggestions.batchDismiss")}
                      </GlassButton>
                    )}
                    {isCollapsed ? <ChevronDown className="size-3 text-[var(--ink)]" /> : <ChevronUp className="size-3 text-[var(--ink)]" />}
                  </div>

                  {/* Group items */}
                  {!isCollapsed && (
                    <div className="divide-y divide-[var(--hairline)]/20">
                      {group.map((s) => {
                        const isActive = selectedSuggestionId === s.id
                        return (
                          <div
                            key={s.id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isActive}
                            onClick={() => setSelectedSuggestionId(s.id)}
                            onKeyDown={(event) => onPressableKeyDown(event, () => setSelectedSuggestionId(s.id))}
                            className={cn(
                              "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-all duration-150",
                              isActive
                                ? "bg-[var(--warn-soft)]/20 border-l-2 border-l-[var(--warn)]"
                                : "hover:bg-[var(--panel-bg)]/30 border-l-2 border-l-transparent"
                            )}
                          >
                            <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--warn-soft)]/60 text-[var(--warn)]">
                              <Zap className="size-2.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className={cn(
                                  "truncate text-xs font-semibold",
                                  isActive ? "text-[var(--warn)]" : "text-[var(--foreground)]"
                                )}>
                                  {resolveSuggestionTitle(t, s)}
                                </p>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="rounded bg-[var(--accent-soft)]/40 px-1.5 py-0.5 text-[9px] text-[var(--accent-strong)]">
                                  {getTriggerLabel(t, s.trigger)}
                                </span>
                                <span className="flex items-center gap-0.5 text-[9px] text-[var(--ink)]">
                                  <Clock className="size-2.5" />
                                  {formatRelativeTime(s.createdAt)}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] text-[var(--ink)] line-clamp-2">{resolveSuggestionDescription(t, s)}</p>
                              <div className="mt-2 flex gap-1.5">
                                <GlassButton
                                  size="sm"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={(e) => { e.stopPropagation(); executeAutomationSuggestion(s) }}
                                  loading={executingSuggestionId === s.id}
                                  disabled={isAnyProcessing}
                                >
                                  <CheckCircle2 className="size-2.5" />
                                  {t("automation.suggestions.execute")}
                                </GlassButton>
                                <GlassButton
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[10px]"
                                  onClick={(e) => { e.stopPropagation(); dismissAutomationSuggestion(s.id) }}
                                  loading={dismissingSuggestionId === s.id}
                                  disabled={isAnyProcessing}
                                >
                                  <XCircle className="size-2.5" />
                                  {t("automation.suggestions.dismiss")}
                                </GlassButton>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Resolved suggestions toggle */}
        {resolvedSuggestions.length > 0 && (
          <div className="border-t border-[var(--hairline)]/30">
            <button
              onClick={() => setShowResolved((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--panel-bg)]/30 transition-colors"
            >
              <Archive className="size-3.5 text-[var(--ink)]" />
              <span className="flex-1 text-xs font-medium text-[var(--ink)]">
                {t("automation.suggestions.resolvedTitle")} ({resolvedSuggestions.length})
              </span>
              {showResolved ? <ChevronUp className="size-3 text-[var(--ink)]" /> : <ChevronDown className="size-3 text-[var(--ink)]" />}
            </button>
            {showResolved && (
              <div className="divide-y divide-[var(--hairline)]/20">
                {resolvedSuggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSuggestionId(s.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-all duration-150 opacity-60",
                      selectedSuggestionId === s.id
                        ? "bg-[var(--panel-bg)]/40 border-l-2 border-l-[var(--ink)]"
                        : "hover:bg-[var(--panel-bg)]/20 border-l-2 border-l-transparent"
                    )}
                  >
                    <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--panel-bg)] text-[var(--ink)]">
                      <Zap className="size-2.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-[var(--foreground)]">{resolveSuggestionTitle(t, s)}</p>
                        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium", getStatusBadgeClass(s.status))}>
                          {getStatusLabel(t, s.status)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-[9px] text-[var(--ink)]">{getActionKindLabel(t, s.actionKind)}</span>
                        <span className="text-[9px] text-[var(--hairline)]">·</span>
                        <span className="text-[9px] text-[var(--ink)]">{getTriggerLabel(t, s.trigger)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Maintenance Tab ───────────────────────────────────────────────── */

function MaintenanceTabContent({
  t,
  ingestSelectionInput,
  isIngestingSelection,
  lastIngestResult,
  isRunningLint,
  lastLintReport,
  setIngestSelectionInput,
  ingestSelection,
  runLint,
}: {
  t: Translation
  ingestSelectionInput: string
  isIngestingSelection: boolean
  lastIngestResult: IngestLocalLlmWikiSelectionResult | null
  isRunningLint: boolean
  lastLintReport: LocalLlmWikiLintReport | null
  setIngestSelectionInput: (v: string) => void
  ingestSelection: () => Promise<void>
  runLint: () => Promise<void>
}) {
  const findings = lastLintReport?.findings ?? []

  return (
    <div className="overflow-y-auto p-4 space-y-4">
      {/* Ingest section */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{t("maintenance.ingest.title")}</p>
        <p className="text-[10px] text-[var(--ink)]">{t("maintenance.ingest.description")}</p>
        <Textarea
          value={ingestSelectionInput}
          onChange={(e) => setIngestSelectionInput(e.target.value)}
          placeholder={t("maintenance.ingest.placeholder")}
          className="min-h-[60px] rounded-[var(--r-6)] border-[var(--hairline)]/50 bg-[var(--panel-bg)]/40 text-[11px]"
        />
        <GlassButton size="sm" variant="secondary" className="h-7 text-[11px]" onClick={ingestSelection} loading={isIngestingSelection}>
          <Upload className="size-3" />
          {t("maintenance.ingest.action")}
        </GlassButton>
        {lastIngestResult && (
          <div className="flex flex-wrap gap-1.5">
            <Badge label={t("maintenance.ingest.stats.ingested", { count: lastIngestResult.ingestedPaths.length })} />
            <Badge label={t("maintenance.ingest.stats.sourcePages", { count: lastIngestResult.sourcePagesCreated.length })} />
            <Badge label={t("maintenance.ingest.stats.rawCopies", { count: lastIngestResult.rawFilesCopied.length })} />
          </div>
        )}
      </div>

      {/* Lint section */}
      <div className="space-y-2 border-t border-[var(--hairline)]/30 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--foreground)]">{t("maintenance.lint.title")}</p>
          <GlassButton size="sm" variant="outline" className="h-7 text-[11px]" onClick={runLint} loading={isRunningLint}>
            {t("maintenance.actions.runLint")}
          </GlassButton>
        </div>

        {lastLintReport ? (
          findings.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {findings.slice(0, 10).map((f) => (
                <div
                  key={f.id}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[11px]",
                    f.severity === "error" ? "bg-[var(--danger-soft)]/60 text-[var(--danger)]" :
                    f.severity === "warning" ? "bg-[var(--warn-soft)]/60 text-[var(--warn)]" :
                    "bg-[var(--info-soft)]/60 text-[var(--info)]"
                  )}
                >
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <div>
                    <p className="font-medium">{f.title}</p>
                    <p className="text-[10px] opacity-70">{f.category} · {f.confidence}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--ok-soft)]/40 px-3 py-2 text-xs text-[var(--ok)]">
              <CheckCircle2 className="size-3.5" />
              {t("maintenance.lint.empty")}
            </div>
          )
        ) : (
          <p className="text-[11px] text-[var(--ink)]">{t("maintenance.lint.notRun")}</p>
        )}
      </div>
    </div>
  )
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-[var(--panel-bg)]/60 px-2 py-0.5 text-[10px] text-[var(--ink)]">
      {label}
    </span>
  )
}
