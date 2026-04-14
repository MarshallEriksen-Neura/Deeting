"use client"

import { Bot, CheckCircle2, Clock3, Play, Settings2, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Switch } from "@/components/ui/switch"
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
  "on_vault_bound:sync_corpus": "initialCorpusSync",
  "on_workspace_bootstrapped:create_maintainer_agent": "createMaintainerAgent",
  "on_maintenance_schedule:sync_corpus": "refreshCorpus",
  "on_maintenance_schedule:run_maintenance_review": "maintenanceReview",
  "on_session_end:crystallize_session_summary": "sessionCrystallization",
  "on_valuable_answer:crystallize_session_summary": "valuableAnswer",
  "on_corpus_sync_completed:inspect_corpus": "inspectAfterSync",
  "on_new_source:run_maintenance_review": "reviewNewSources",
  "on_repeated_stable_conclusion:promote_to_memory": "memoryPromotion",
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
  const automationSettings = settings ?? null
  const pendingSuggestions = suggestions.filter((item) => item.status === "pending")
  const auditEntries = audit.slice(0, 6)

  const toggles: { key: Parameters<typeof onToggleSetting>[0]; title: string; description: string; tone: "safe" | "risky" }[] = [
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
    <GlassCard
      blur="lg"
      theme="surface"
      hover="none"
      className="border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(247,250,255,0.74))]"
    >
      <GlassCardHeader className="border-b border-white/60 pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">
            <Settings2 className="size-3.5" />
            {t("automation.eyebrow")}
          </div>
          <GlassCardTitle className="text-slate-900">
            {t("automation.title")}
          </GlassCardTitle>
          <GlassCardDescription className="text-slate-500">
            {t("automation.description")}
          </GlassCardDescription>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="grid gap-6 pt-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {t("automation.settings.title")}
            </div>
            <div className="mt-4 grid gap-3">
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
          </div>

          <div className="rounded-[1.75rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)]">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Sparkles className="size-3.5 text-amber-500" />
              {t("automation.suggestions.title")}
            </div>
            <div className="mt-4 space-y-3">
              {pendingSuggestions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4 text-sm text-slate-500">
                  {t("automation.suggestions.empty")}
                </div>
              ) : (
                pendingSuggestions.map((suggestion) => {
                  const copy = getSuggestionCopy(suggestion, t)

                  return (
                    <div
                      key={suggestion.id}
                      className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-900">
                            {copy.title}
                          </div>
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                            {t(`automation.triggers.${suggestion.trigger}`)}
                          </div>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                          {t(`automation.actions.${suggestion.actionKind}`)}
                        </span>
                      </div>
                      <div className="mt-3 text-sm leading-6 text-slate-600">
                        {copy.description}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => onExecuteSuggestion(suggestion)}
                          disabled={executingSuggestionId === suggestion.id}
                          className="rounded-full bg-[linear-gradient(135deg,#0f172a,#2563eb)] px-4 text-white"
                        >
                          <Play className="mr-2 size-3.5" />
                          {executingSuggestionId === suggestion.id
                            ? t("automation.suggestions.executing")
                            : t("automation.suggestions.execute")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDismissSuggestion(suggestion.id)}
                          disabled={dismissingSuggestionId === suggestion.id}
                          className="rounded-full border border-slate-200 bg-white px-4 text-slate-600"
                        >
                          <X className="mr-2 size-3.5" />
                          {t("automation.suggestions.dismiss")}
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-white/70 bg-slate-950/[0.94] p-4 text-slate-100 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.58)]">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Clock3 className="size-3.5 text-sky-400" />
              {t("automation.audit.title")}
            </div>
            <div className="mt-4 space-y-3">
              {auditEntries.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                  {t("automation.audit.empty")}
                </div>
              ) : (
                auditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                        <AuditPill level={entry.level} t={t} />
                        <span>{t(`automation.triggers.${entry.trigger}`)}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">{entry.createdAt}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-100">
                      {getAuditMessage(entry, t)}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {t(`automation.dispositions.${entry.disposition}`)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-amber-200/70 bg-amber-50/85 p-4 text-sm text-amber-950">
            <div className="flex items-start gap-3">
              <Bot className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <div className="font-semibold">{t("automation.boundary.title")}</div>
                <div className="leading-6 text-amber-900/85">
                  {t("automation.boundary.description")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </GlassCardContent>
    </GlassCard>
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
        "flex items-start justify-between gap-4 rounded-[1.25rem] border px-4 py-3",
        tone === "safe"
          ? "border-emerald-100 bg-emerald-50/50"
          : "border-amber-100 bg-amber-50/50",
      ].join(" ")}
    >
      <div className="space-y-1">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs leading-5 text-slate-500">{description}</div>
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
      ? "border-rose-300 bg-rose-400/10 text-rose-300"
      : level === "warning"
        ? "border-amber-300 bg-amber-400/10 text-amber-300"
        : "border-emerald-300 bg-emerald-400/10 text-emerald-300"

  return (
    <span className={["rounded-full border px-2 py-0.5 text-[10px] font-semibold", palette].join(" ")}>
      <CheckCircle2 className="mr-1 inline size-3" />
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
    case "on_corpus_sync_completed:observed":
      return t("automation.auditCopy.corpusSyncObserved", {
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
