"use client"

import * as React from "react"
import {
  Activity,
  ChevronDown,
  FileInput,
  RefreshCw,
  ShieldAlert,
  Wrench,
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
import { Textarea } from "@/ui/shadcn/textarea"
import type {
  IngestLocalLlmWikiSelectionResult,
  LocalLlmWikiAutomationAuditEntry,
  LocalLlmWikiLintReport,
} from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function LlmWikiMaintenanceCard({
  t,
  ingestSelectionInput,
  onIngestSelectionInputChange,
  onRefresh,
  onRebuildIndex,
  onIngestSelection,
  onRunLint,
  isRefreshing,
  isRebuildingIndex,
  isIngestingSelection,
  isRunningLint,
  lastIngestResult,
  lastLintReport,
  recentLifecycleActions,
}: {
  t: Translation
  ingestSelectionInput: string
  onIngestSelectionInputChange: (value: string) => void
  onRefresh: () => void
  onRebuildIndex: () => void
  onIngestSelection: () => void
  onRunLint: () => void
  isRefreshing: boolean
  isRebuildingIndex: boolean
  isIngestingSelection: boolean
  isRunningLint: boolean
  lastIngestResult: IngestLocalLlmWikiSelectionResult | null
  lastLintReport: LocalLlmWikiLintReport | null
  recentLifecycleActions: LocalLlmWikiAutomationAuditEntry[]
}) {
  const [ingestOpen, setIngestOpen] = React.useState(false)
  const topFindings = lastLintReport?.findings.slice(0, 6) ?? []

  return (
    <Card className="gap-0 overflow-hidden border-[var(--hairline)] bg-[var(--panel-bg)] py-0 shadow-sm">
      <CardHeader className="border-b border-[var(--hairline)] pb-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ok)]">
            <Wrench className="size-3.5" />
            {t("maintenance.eyebrow")}
          </div>
          <CardTitle className="text-base text-[var(--ink)]">
            {t("maintenance.title")}
          </CardTitle>
          <CardDescription className="text-sm text-[var(--ink-3)]">
            {t("maintenance.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Tool bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-2">
          <ToolButton
            icon={RefreshCw}
            loading={isRefreshing}
            label={t("maintenance.actions.rescan")}
            onClick={onRefresh}
          />
          <div className="hidden h-4 w-px bg-[var(--hairline)] sm:block" />
          <ToolButton
            icon={RefreshCw}
            loading={isRebuildingIndex}
            label={t("maintenance.actions.rebuildIndex")}
            onClick={onRebuildIndex}
          />
          <div className="hidden h-4 w-px bg-[var(--hairline)] sm:block" />
          <ToolButton
            icon={ShieldAlert}
            loading={isRunningLint}
            label={t("maintenance.actions.runLint")}
            onClick={onRunLint}
          />
        </div>

        {/* Ingest Collapsible */}
        <Collapsible open={ingestOpen} onOpenChange={setIngestOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4 py-3 text-left transition-colors duration-200 hover:bg-[var(--hairline-subtle)]">
              <div className="flex items-center gap-2">
                <FileInput className="size-4 text-[var(--ink-3)]" />
                <span className="text-sm font-medium text-[var(--ink-2)]">
                  {t("maintenance.ingest.collapsibleTitle")}
                </span>
              </div>
              <ChevronDown
                className={`size-4 text-[var(--ink-3)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${ingestOpen ? "rotate-180" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 overflow-hidden transition-all">
            <div className="rounded-xl border border-[var(--hairline)] bg-[var(--panel-raised)] p-3">
              <div className="text-xs leading-4 text-[var(--ink-3)]">
                {t("maintenance.ingest.description")}
              </div>
              <Textarea
                value={ingestSelectionInput}
                onChange={(event) =>
                  onIngestSelectionInputChange(event.target.value)
                }
                className="mt-2 min-h-[80px] rounded-lg border-[var(--hairline)] bg-[var(--panel-bg)] text-sm"
                placeholder={t("maintenance.ingest.placeholder")}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--ink-4)]">
                  {t("maintenance.ingest.hint")}
                </div>
                <Button
                  onClick={onIngestSelection}
                  disabled={isIngestingSelection}
                  className="h-8 rounded-full bg-[var(--accent-strong)] px-4 text-xs text-white transition-all duration-200 hover:bg-[var(--accent-ink)] active:scale-[0.98]"
                >
                  {isIngestingSelection ? (
                    <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <FileInput className="mr-1.5 size-3.5" />
                  )}
                  {t("maintenance.ingest.action")}
                </Button>
              </div>
              {lastIngestResult ? (
                <div className="mt-3 rounded-lg border border-[var(--ok-border)] bg-[var(--ok-soft)]/50 px-3 py-2 text-sm text-[var(--ok)]">
                  <div className="font-semibold">
                    {t("maintenance.ingest.lastRun")}
                  </div>
                  <div className="mt-1 grid gap-0.5 text-xs opacity-90">
                    <div>
                      {t("maintenance.ingest.stats.ingested", {
                        count: lastIngestResult.ingestedPaths.length,
                      })}
                    </div>
                    <div>
                      {t("maintenance.ingest.stats.sourcePages", {
                        count: lastIngestResult.sourcePagesCreated.length,
                      })}
                    </div>
                    <div>
                      {t("maintenance.ingest.stats.rawCopies", {
                        count: lastIngestResult.rawFilesCopied.length,
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Lint + Lifecycle */}
        <div className="grid gap-3 xl:grid-cols-2">
          {/* Lint */}
          <div className="rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <ShieldAlert className="size-4 text-[var(--warn)]" />
              {t("maintenance.lint.title")}
            </div>
            <div className="mt-1 text-xs leading-4 text-[var(--ink-3)]">
              {t("maintenance.lint.description")}
            </div>
            {lastLintReport ? (
              <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-soft)]/50 px-3 py-2 text-sm text-[var(--warn)]">
                  {t("maintenance.lint.summary", {
                    count: lastLintReport.findingCount,
                    generatedAt: lastLintReport.generatedAt,
                  })}
                </div>
                <div className="space-y-2">
                  {topFindings.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-3 text-sm text-[var(--ink-3)]">
                      {t("maintenance.lint.empty")}
                    </div>
                  ) : (
                    topFindings.map((finding) => (
                      <div
                        key={finding.id}
                        className="rounded-lg border border-[var(--hairline-subtle)] bg-[var(--panel-bg)] px-3 py-2.5 transition-colors duration-200 hover:border-[var(--hairline)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-[var(--ink)]">
                            {finding.title}
                          </div>
                          <span className="shrink-0 rounded-full border border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--warn)]">
                            {finding.severity} / {finding.confidence}
                          </span>
                        </div>
                        <div className="mt-1 text-xs leading-4 text-[var(--ink-3)]">
                          {finding.detail}
                        </div>
                        {finding.relativePath ? (
                          <div className="mt-1 text-[11px] text-[var(--ink-4)]">
                            {finding.relativePath}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-3 text-sm text-[var(--ink-3)]">
                {t("maintenance.lint.notRun")}
              </div>
            )}
          </div>

          {/* Lifecycle */}
          <div className="rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <Activity className="size-4 text-[var(--info)]" />
              {t("maintenance.lifecycle.title")}
            </div>
            <div className="mt-1 text-xs leading-4 text-[var(--ink-3)]">
              {t("maintenance.lifecycle.description")}
            </div>
            <div className="mt-3 space-y-2">
              {recentLifecycleActions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-3 py-3 text-sm text-[var(--ink-3)]">
                  {t("maintenance.lifecycle.empty")}
                </div>
              ) : (
                recentLifecycleActions.map((entry) => (
                  <div
                    key={entry.id}
                    className="relative rounded-lg border border-[var(--hairline-subtle)] bg-[var(--panel-bg)] px-3 py-2.5 pl-4 transition-colors duration-200 hover:border-[var(--hairline)]"
                  >
                    <div className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full bg-[var(--hairline-strong)]" />
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--ink-3)]">
                        {entry.trigger}
                      </div>
                      <div className="text-[11px] text-[var(--ink-4)]">
                        {entry.createdAt}
                      </div>
                    </div>
                    <div className="mt-1 text-xs leading-4 text-[var(--ink-2)]">
                      {entry.message}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ToolButton({
  icon: Icon,
  loading,
  label,
  onClick,
}: {
  icon: typeof RefreshCw
  loading: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink-2)] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[var(--hairline-subtle)] disabled:opacity-50 active:scale-[0.98] sm:flex-initial"
    >
      <Icon
        className={`size-4 ${loading ? "animate-spin text-[var(--accent-strong)]" : "text-[var(--ink-3)]"}`}
      />
      <span className="hidden sm:inline">{label}</span>
      {loading && <span className="sm:hidden">...</span>}
    </button>
  )
}
