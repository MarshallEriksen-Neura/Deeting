"use client"

import { Activity, FileInput, RefreshCw, ShieldAlert, Wrench } from "lucide-react"

import { Button } from "@/ui/shadcn/button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/ui/common/glass-card"
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
  const topFindings = lastLintReport?.findings.slice(0, 6) ?? []

  return (
    <GlassCard
      blur="lg"
      theme="surface"
      hover="none"
      className="border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.85),rgba(245,250,246,0.74))]"
    >
      <GlassCardHeader className="border-b border-white/60 pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">
            <Wrench className="size-3.5" />
            {t("maintenance.eyebrow")}
          </div>
          <GlassCardTitle className="text-slate-900">
            {t("maintenance.title")}
          </GlassCardTitle>
          <GlassCardDescription className="text-slate-500">
            {t("maintenance.description")}
          </GlassCardDescription>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-6 pt-6">
        <div className="grid gap-3 md:grid-cols-3">
          <ActionButton
            icon={RefreshCw}
            loading={isRefreshing}
            label={t("maintenance.actions.rescan")}
            onClick={onRefresh}
          />
          <ActionButton
            icon={RefreshCw}
            loading={isRebuildingIndex}
            label={t("maintenance.actions.rebuildIndex")}
            onClick={onRebuildIndex}
          />
          <ActionButton
            icon={ShieldAlert}
            loading={isRunningLint}
            label={t("maintenance.actions.runLint")}
            onClick={onRunLint}
          />
        </div>

        <div className="rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileInput className="size-4 text-emerald-600" />
            {t("maintenance.ingest.title")}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {t("maintenance.ingest.description")}
          </div>
          <Textarea
            value={ingestSelectionInput}
            onChange={(event) => onIngestSelectionInputChange(event.target.value)}
            className="mt-4 min-h-[120px] rounded-[1.25rem] border-white/70 bg-white/90"
            placeholder={t("maintenance.ingest.placeholder")}
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">{t("maintenance.ingest.hint")}</div>
            <Button
              onClick={onIngestSelection}
              disabled={isIngestingSelection}
              className="rounded-full bg-[linear-gradient(135deg,#065f46,#10b981)] px-5 text-white"
            >
              {isIngestingSelection ? (
                <RefreshCw className="mr-2 size-4 animate-spin" />
              ) : (
                <FileInput className="mr-2 size-4" />
              )}
              {t("maintenance.ingest.action")}
            </Button>
          </div>
          {lastIngestResult ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-950">
              <div className="font-semibold">{t("maintenance.ingest.lastRun")}</div>
              <div className="mt-2 grid gap-1 text-emerald-900/85">
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

        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldAlert className="size-4 text-amber-600" />
              {t("maintenance.lint.title")}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-500">
              {t("maintenance.lint.description")}
            </div>
            {lastLintReport ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
                  {t("maintenance.lint.summary", {
                    count: lastLintReport.findingCount,
                    generatedAt: lastLintReport.generatedAt,
                  })}
                </div>
                <div className="space-y-2">
                  {topFindings.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 text-sm text-slate-500">
                      {t("maintenance.lint.empty")}
                    </div>
                  ) : (
                    topFindings.map((finding) => (
                      <div key={finding.id} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{finding.title}</div>
                          <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                            {finding.severity} / {finding.confidence}
                          </span>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">{finding.detail}</div>
                        {finding.relativePath ? (
                          <div className="mt-2 text-xs text-slate-500">{finding.relativePath}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4 text-sm text-slate-500">
                {t("maintenance.lint.notRun")}
              </div>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-slate-200/70 bg-slate-950/[0.95] p-4 text-slate-100 shadow-[0_30px_70px_-40px_rgba(15,23,42,0.58)]">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="size-4 text-sky-300" />
              {t("maintenance.lifecycle.title")}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-400">
              {t("maintenance.lifecycle.description")}
            </div>
            <div className="mt-4 space-y-3">
              {recentLifecycleActions.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
                  {t("maintenance.lifecycle.empty")}
                </div>
              ) : (
                recentLifecycleActions.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        {entry.trigger}
                      </div>
                      <div className="text-[11px] text-slate-500">{entry.createdAt}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-100">{entry.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </GlassCardContent>
    </GlassCard>
  )
}

function ActionButton({
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
    <Button
      onClick={onClick}
      disabled={loading}
      className="h-11 rounded-full bg-[linear-gradient(135deg,#0f172a,#1d4ed8)] text-white"
    >
      <Icon className={["mr-2 size-4", loading ? "animate-spin" : ""].join(" ")} />
      {label}
    </Button>
  )
}
