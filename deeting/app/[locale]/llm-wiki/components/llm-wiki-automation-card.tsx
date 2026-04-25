"use client"

import * as React from "react"
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Play,
  Settings2,
  Sparkles,
  X,
  Zap,
} from "lucide-react"

import { Button } from "@/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/ui/shadcn/collapsible"
import { Switch } from "@/ui/shadcn/switch"
import type {
  LocalLlmWikiAutomationAuditEntry,
  LocalLlmWikiAutomationSettings,
  LocalLlmWikiAutomationSuggestion,
} from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

type SuggestionCopyKey =
  | "initialCorpusSync"
  | "createMaintainerAgent"
  | "refreshCorpus"
  | "maintenanceReview"
  | "sessionCrystallization"
  | "valuableAnswer"
  | "inspectAfterSync"
  | "reviewNewSources"
  | "memoryPromotion"

const suggestionCopyKeyBySignature: Record<string, SuggestionCopyKey> = {
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

const actionKindStyles: Record<
  string,
  { bar: string; badgeBg: string; badgeBorder: string; badgeText: string }
> = {
  reconcile_corpus: {
    bar: "bg-[var(--info)]",
    badgeBg: "bg-[var(--info-soft)]",
    badgeBorder: "border-[var(--info-border)]",
    badgeText: "text-[var(--info)]",
  },
  create_maintainer_agent: {
    bar: "bg-[var(--ok)]",
    badgeBg: "bg-[var(--ok-soft)]",
    badgeBorder: "border-[var(--ok-border)]",
    badgeText: "text-[var(--ok)]",
  },
  inspect_corpus: {
    bar: "bg-[var(--accent-strong)]",
    badgeBg: "bg-[var(--accent-soft)]",
    badgeBorder: "border-[var(--accent-border)]",
    badgeText: "text-[var(--accent-ink)]",
  },
  run_maintenance_review: {
    bar: "bg-[var(--warn)]",
    badgeBg: "bg-[var(--warn-soft)]",
    badgeBorder: "border-[var(--warn-border)]",
    badgeText: "text-[var(--warn)]",
  },
  crystallize_session_summary: {
    bar: "bg-[var(--accent-strong)]",
    badgeBg: "bg-[var(--accent-soft)]",
    badgeBorder: "border-[var(--accent-border)]",
    badgeText: "text-[var(--accent-ink)]",
  },
  promote_to_memory: {
    bar: "bg-[var(--ok)]",
    badgeBg: "bg-[var(--ok-soft)]",
    badgeBorder: "border-[var(--ok-border)]",
    badgeText: "text-[var(--ok)]",
  },
}

type AutomationAuditMetadata = Record<string, unknown> | null | undefined

export function LlmWikiAutomationCard({
  t,
  settings,
  suggestions,
  audit,
  isUpdatingSettings,
  executingSuggestionId,
  dismissingSuggestionId,
  onToggleSetting,
  onExecuteSuggestion,
  onDismissSuggestion,
}: {
  t: Translation
  settings: LocalLlmWikiAutomationSettings | null
  suggestions: LocalLlmWikiAutomationSuggestion[]
  audit: LocalLlmWikiAutomationAuditEntry[]
  isUpdatingSettings: boolean
  executingSuggestionId: string | null
  dismissingSuggestionId: string | null
  onToggleSetting: (
    key:
      | "autoSyncOnVaultBound"
      | "suggestMaintainerOnWorkspaceBootstrap"
      | "autoRefreshInspectorOnCorpusSync"
      | "createCrystallizationCandidatesOnSessionEnd"
      | "enableScheduleSuggestions"
      | "suggestOnValuableAnswer"
      | "autoDelegateNewSources"
      | "autoDelegateMaintenanceSchedule"
      | "promoteRepeatedStableConclusionsToMemory",
    value: boolean,
  ) => void
  onExecuteSuggestion: (suggestion: LocalLlmWikiAutomationSuggestion) => void
  onDismissSuggestion: (suggestionId: string) => void
}) {
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [batchProcessing, setBatchProcessing] = React.useState(false)
  const [batchDismissing, setBatchDismissing] = React.useState(false)

  const automationSettings = settings ?? null
  const pendingSuggestions = suggestions.filter((item) => item.status === "pending")
  const auditEntries = audit.slice(0, 6)

  const handleExecuteAll = React.useCallback(async () => {
    if (pendingSuggestions.length === 0) return
    setBatchProcessing(true)
    for (const suggestion of pendingSuggestions) {
      await onExecuteSuggestion(suggestion)
    }
    setBatchProcessing(false)
  }, [pendingSuggestions, onExecuteSuggestion])

  const handleDismissAll = React.useCallback(async () => {
    if (pendingSuggestions.length === 0) return
    setBatchDismissing(true)
    for (const suggestion of pendingSuggestions) {
      await onDismissSuggestion(suggestion.id)
    }
    setBatchDismissing(false)
  }, [pendingSuggestions, onDismissSuggestion])

  const toggles: {
    key: Parameters<typeof onToggleSetting>[0]
    title: string
    description: string
    tone: "safe" | "risky"
  }[] = [
    {
      key: "autoSyncOnVaultBound" as const,
      title: t("automation.settings.autoSyncOnVaultBound.title"),
      description: t("automation.settings.autoSyncOnVaultBound.description"),
      tone: "safe",
    },
    {
      key: "suggestMaintainerOnWorkspaceBootstrap" as const,
      title: t("automation.settings.suggestMaintainerOnWorkspaceBootstrap.title"),
      description: t("automation.settings.suggestMaintainerOnWorkspaceBootstrap.description"),
      tone: "safe",
    },
    {
      key: "autoRefreshInspectorOnCorpusSync" as const,
      title: t("automation.settings.autoRefreshInspectorOnCorpusSync.title"),
      description: t("automation.settings.autoRefreshInspectorOnCorpusSync.description"),
      tone: "safe",
    },
    {
      key: "createCrystallizationCandidatesOnSessionEnd" as const,
      title: t("automation.settings.createCrystallizationCandidatesOnSessionEnd.title"),
      description: t("automation.settings.createCrystallizationCandidatesOnSessionEnd.description"),
      tone: "safe",
    },
    {
      key: "enableScheduleSuggestions" as const,
      title: t("automation.settings.enableScheduleSuggestions.title"),
      description: t("automation.settings.enableScheduleSuggestions.description"),
      tone: "safe",
    },
    {
      key: "suggestOnValuableAnswer" as const,
      title: t("automation.settings.suggestOnValuableAnswer.title"),
      description: t("automation.settings.suggestOnValuableAnswer.description"),
      tone: "safe",
    },
    {
      key: "autoDelegateNewSources" as const,
      title: t("automation.settings.autoDelegateNewSources.title"),
      description: t("automation.settings.autoDelegateNewSources.description"),
      tone: "risky",
    },
    {
      key: "autoDelegateMaintenanceSchedule" as const,
      title: t("automation.settings.autoDelegateMaintenanceSchedule.title"),
      description: t("automation.settings.autoDelegateMaintenanceSchedule.description"),
      tone: "risky",
    },
    {
      key: "promoteRepeatedStableConclusionsToMemory" as const,
      title: t("automation.settings.promoteRepeatedStableConclusionsToMemory.title"),
      description: t("automation.settings.promoteRepeatedStableConclusionsToMemory.description"),
      tone: "risky",
    },
  ]

  return (
    <Card className="gap-0 overflow-hidden border-[var(--hairline)] bg-[var(--panel-bg)] py-0 shadow-sm">
      <CardHeader className="border-b border-[var(--hairline)] pb-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--warn)]">
            <Settings2 className="size-3.5" />
            {t("automation.eyebrow")}
          </div>
          <CardTitle className="text-base text-[var(--ink)]">
            {t("automation.title")}
          </CardTitle>
          <CardDescription className="text-sm text-[var(--ink-3)]">
            {t("automation.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 pt-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {pendingSuggestions.length > 0 ? (
            <div className="space-y-3">
              {/* Batch action bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-[var(--warn)]" />
                  <span className="text-sm font-medium text-[var(--ink)]">
                    {t("automation.suggestions.count", {
                      count: pendingSuggestions.length,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDismissAll}
                    disabled={batchDismissing || batchProcessing}
                    className="h-8 text-xs text-[var(--ink-3)] hover:text-[var(--ink-2)]"
                  >
                    {batchDismissing
                      ? t("automation.suggestions.dismissing")
                      : t("automation.suggestions.batchDismiss")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleExecuteAll}
                    disabled={batchProcessing || batchDismissing}
                    className="h-8 rounded-full bg-[var(--accent-strong)] px-4 text-xs text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[var(--accent-ink)] active:scale-[0.98]"
                  >
                    <Zap className="mr-1 size-3.5" />
                    {batchProcessing
                      ? t("automation.suggestions.batchExecuting")
                      : t("automation.suggestions.batchExecute")}
                  </Button>
                </div>
              </div>

              {/* Suggestion list */}
              <div className="space-y-2">
                {pendingSuggestions.map((suggestion) => {
                  const copy = getSuggestionCopy(suggestion, t)
                  const styles =
                    actionKindStyles[suggestion.actionKind] ??
                    actionKindStyles.reconcile_corpus
                  const isExecuting = executingSuggestionId === suggestion.id
                  const isDismissing = dismissingSuggestionId === suggestion.id

                  return (
                    <div
                      key={suggestion.id}
                      className="group relative flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--panel-raised)] p-3 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--hairline-strong)] hover:shadow-[0_4px_20px_-8px_rgba(15,17,28,0.12)]"
                    >
                      <div
                        className={`mt-1 h-8 w-[3px] shrink-0 rounded-full ${styles.bar}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[var(--ink)]">
                              {copy.title}
                            </div>
                            <div className="mt-0.5 text-xs leading-4 text-[var(--ink-3)]">
                              {copy.description}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border ${styles.badgeBorder} ${styles.badgeBg} px-2 py-0.5 text-[11px] font-medium ${styles.badgeText}`}
                          >
                            {t(`automation.actions.${suggestion.actionKind}`)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
                          <Button
                            size="sm"
                            onClick={() => onExecuteSuggestion(suggestion)}
                            disabled={isExecuting || isDismissing}
                            className="h-7 rounded-full bg-[var(--accent-strong)] px-3 text-xs text-white transition-all duration-200 hover:bg-[var(--accent-ink)] active:scale-[0.98]"
                          >
                            <Play className="mr-1 size-3" />
                            {isExecuting
                              ? t("automation.suggestions.executing")
                              : t("automation.suggestions.execute")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onDismissSuggestion(suggestion.id)}
                            disabled={isExecuting || isDismissing}
                            className="h-7 px-2 text-xs text-[var(--ink-3)] hover:text-[var(--ink-2)]"
                          >
                            <X className="mr-1 size-3" />
                            {isDismissing
                              ? t("automation.suggestions.dismissing")
                              : t("automation.suggestions.dismiss")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-6 py-10 text-center">
              <CheckCircle2 className="size-8 text-[var(--ok)] opacity-60" />
              <div className="mt-3 text-sm font-medium text-[var(--ink-2)]">
                {t("automation.suggestions.emptyTitle")}
              </div>
              <div className="mt-1 text-xs text-[var(--ink-3)]">
                {t("automation.suggestions.emptySubtitle")}
              </div>
            </div>
          )}

          {/* Settings Collapsible */}
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3 text-left transition-colors duration-200 hover:bg-[var(--hairline-subtle)]">
                <div className="flex items-center gap-2">
                  <Settings2 className="size-4 text-[var(--ink-3)]" />
                  <span className="text-sm font-medium text-[var(--ink-2)]">
                    {t("automation.settings.collapsibleTitle")}
                  </span>
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-ink)]">
                    {toggles.length}
                  </span>
                </div>
                <ChevronDown
                  className={`size-4 text-[var(--ink-3)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${settingsOpen ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 overflow-hidden transition-all data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              <div className="grid gap-2 sm:grid-cols-2">
                {toggles.map((toggle) => (
                  <AutomationToggleRow
                    key={toggle.key}
                    title={toggle.title}
                    description={toggle.description}
                    checked={Boolean(automationSettings?.[toggle.key])}
                    disabled={isUpdatingSettings}
                    tone={toggle.tone}
                    onCheckedChange={(value) => onToggleSetting(toggle.key, value)}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Audit panel */}
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">
              <Clock3 className="size-3.5 text-[var(--info)]" />
              {t("automation.audit.title")}
            </div>
            <div className="mt-3 space-y-2">
              {auditEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-3 text-sm text-[var(--ink-3)]">
                  {t("automation.audit.empty")}
                </div>
              ) : (
                auditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-[var(--hairline-subtle)] bg-[var(--panel-bg)] px-3 py-2.5 transition-colors duration-200 hover:border-[var(--hairline)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em] text-[var(--ink-3)]">
                        <AuditPill level={entry.level} t={t} />
                        <span>{t(`automation.triggers.${entry.trigger}`)}</span>
                      </div>
                      <div className="text-[11px] text-[var(--ink-4)]">
                        {entry.createdAt}
                      </div>
                    </div>
                    <div className="mt-1.5 text-sm leading-5 text-[var(--ink-2)]">
                      {getAuditMessage(entry, t)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ink-4)]">
                      {t(`automation.dispositions.${entry.disposition}`)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-soft)]/60 p-3 text-sm text-[var(--warn)]">
            <div className="flex items-start gap-2.5">
              <Bot className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-0.5">
                <div className="font-semibold">{t("automation.boundary.title")}</div>
                <div className="leading-5 opacity-85">
                  {t("automation.boundary.description")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AutomationToggleRow({
  title,
  description,
  checked,
  disabled,
  tone,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  tone: "safe" | "risky"
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div
      className={[
        "flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5 transition-colors duration-200",
        tone === "safe"
          ? "border-[var(--ok-border)]/40 bg-[var(--ok-soft)]/40"
          : "border-[var(--warn-border)]/40 bg-[var(--warn-soft)]/40",
      ].join(" ")}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-semibold text-[var(--ink)]">{title}</div>
        <div className="text-xs leading-4 text-[var(--ink-3)]">{description}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function AuditPill({
  level,
  t,
}: {
  level: string
  t: Translation
}) {
  const normalizedLevel =
    level === "info" || level === "warning" || level === "error" ? level : null

  const palette =
    level === "error"
      ? "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : level === "warning"
        ? "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]"
        : "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]"

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        palette,
      ].join(" ")}
    >
      <CheckCircle2 className="size-3" />
      {normalizedLevel ? t(`automation.levels.${normalizedLevel}`) : level}
    </span>
  )
}

function getSuggestionCopy(
  suggestion: LocalLlmWikiAutomationSuggestion,
  t: Translation,
): {
  title: string
  description: string
} {
  const signature = `${suggestion.trigger}:${suggestion.actionKind}`
  const copyKey = suggestionCopyKeyBySignature[signature]

  if (!copyKey) {
    return {
      title: suggestion.title,
      description: suggestion.description,
    }
  }

  return {
    title: t(`automation.suggestionCopy.${copyKey}.title`),
    description: t(`automation.suggestionCopy.${copyKey}.description`),
  }
}

function getAuditMessage(
  entry: LocalLlmWikiAutomationAuditEntry,
  t: Translation,
): string {
  const metadata = entry.metadata
  const signature = `${entry.trigger}:${entry.disposition}`

  switch (signature) {
    case "on_maintenance_schedule:settings_updated":
      return t("automation.auditCopy.settingsUpdated")
    case "on_vault_bound:auto_executed":
      return t("automation.auditCopy.vaultBoundAutoExecuted", {
        indexedFiles: getMetadataNumber(metadata, "indexedFiles") ?? 0,
        removedFiles: getMetadataNumber(metadata, "removedFiles") ?? 0,
      })
    case "on_vault_bound:auto_failed":
      return appendAuditDetail(
        t("automation.auditCopy.vaultBoundAutoFailed"),
        extractAuditDetail(entry.message),
      )
    case "on_workspace_bootstrapped:noop":
      return t("automation.auditCopy.workspaceBootstrapNoop")
    case "on_session_end:disabled":
      return t("automation.auditCopy.sessionEndDisabled")
    case "on_session_end:skipped":
      return t("automation.auditCopy.sessionEndSkipped")
    case "on_session_end:observed":
      return t("automation.auditCopy.sessionEndObserved")
    case "on_session_end:suggested":
      return t("automation.auditCopy.sessionEndSuggested")
    case "on_valuable_answer:disabled":
      return t("automation.auditCopy.valuableAnswerDisabled")
    case "on_valuable_answer:suggested":
      return t("automation.auditCopy.valuableAnswerSuggested")
    case "on_corpus_reconcile_completed:observed":
      return t("automation.auditCopy.corpusReconcileObserved", {
        indexedFiles: getMetadataNumber(metadata, "indexedFiles") ?? 0,
        removedFiles: getMetadataNumber(metadata, "removedFiles") ?? 0,
      })
    case "on_new_source:auto_executed":
      return t("automation.auditCopy.newSourceAutoExecuted")
    case "on_new_source:auto_failed":
      return appendAuditDetail(
        t("automation.auditCopy.newSourceAutoFailed"),
        extractAuditDetail(entry.message),
      )
    case "on_maintenance_schedule:auto_executed":
      return t("automation.auditCopy.maintenanceAutoExecuted")
    case "on_maintenance_schedule:auto_failed":
      return appendAuditDetail(
        t("automation.auditCopy.maintenanceAutoFailed"),
        extractAuditDetail(entry.message),
      )
    case "on_maintenance_schedule:scheduled":
      return t("automation.auditCopy.maintenanceScheduled")
    case "on_repeated_stable_conclusion:auto_executed":
      return t("automation.auditCopy.stableConclusionAutoExecuted")
    default:
      return getGenericAuditMessage(entry, t)
  }
}

function getGenericAuditMessage(
  entry: LocalLlmWikiAutomationAuditEntry,
  t: Translation,
): string {
  const metadata = entry.metadata

  if (entry.disposition === "suggestion_dismissed") {
    return t("automation.auditCopy.suggestionDismissed")
  }

  if (entry.disposition === "acknowledged") {
    return t("automation.auditCopy.suggestionAcknowledged")
  }

  if (entry.disposition === "execution_failed") {
    return appendAuditDetail(
      t("automation.auditCopy.executionFailed"),
      extractAuditDetail(entry.message),
    )
  }

  if (entry.disposition === "auto_failed") {
    return appendAuditDetail(
      t("automation.auditCopy.autoFailed"),
      extractAuditDetail(entry.message),
    )
  }

  if (entry.disposition === "executed") {
    if (
      getMetadataNumber(metadata, "indexedFiles") !== null ||
      getMetadataNumber(metadata, "removedFiles") !== null
    ) {
      return t("automation.auditCopy.suggestionExecutedSync", {
        indexedFiles: getMetadataNumber(metadata, "indexedFiles") ?? 0,
        removedFiles: getMetadataNumber(metadata, "removedFiles") ?? 0,
      })
    }

    const agentName = getMetadataString(metadata, "agentName")
    if (agentName) {
      return t("automation.auditCopy.suggestionExecutedCreateAgent", {
        name: agentName,
      })
    }

    if (getMetadataString(metadata, "memoryAction")) {
      return t("automation.auditCopy.suggestionExecutedMemory")
    }

    if (getMetadataString(metadata, "workflowRunId")) {
      return t("automation.auditCopy.suggestionExecutedWorkflow")
    }

    return t("automation.auditCopy.suggestionExecutedGeneric")
  }

  return entry.message
}

function getMetadataNumber(
  metadata: AutomationAuditMetadata,
  key: string,
): number | null {
  const value = metadata?.[key]
  return typeof value === "number" ? value : null
}

function getMetadataString(
  metadata: AutomationAuditMetadata,
  key: string,
): string | null {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function extractAuditDetail(message: string): string | null {
  const separatorIndex = message.indexOf(":")
  if (separatorIndex === -1) {
    return null
  }

  const detail = message.slice(separatorIndex + 1).trim()
  return detail || null
}

function appendAuditDetail(base: string, detail: string | null): string {
  if (!detail) {
    return base
  }

  return `${base} ${detail}`
}
