"use client"

import { DatabaseZap, FileSearch, RefreshCw, Search, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Input } from "@/components/ui/input"
import type {
  LocalLlmWikiCorpusSearchHit,
  LocalLlmWikiState,
} from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function LlmWikiCorpusCard({
  t,
  state,
  corpusQuery,
  corpusHits,
  selectedCorpusHit,
  isSyncingCorpus,
  isSearchingCorpus,
  onCorpusQueryChange,
  onSelectCorpusHit,
  onSyncCorpus,
  onSearchCorpus,
}: {
  t: Translation
  state: LocalLlmWikiState | null
  corpusQuery: string
  corpusHits: LocalLlmWikiCorpusSearchHit[]
  selectedCorpusHit: LocalLlmWikiCorpusSearchHit | null
  isSyncingCorpus: boolean
  isSearchingCorpus: boolean
  onCorpusQueryChange: (value: string) => void
  onSelectCorpusHit: (assetId: string) => void
  onSyncCorpus: () => void
  onSearchCorpus: () => void
}) {
  const corpus = state?.corpusStatus

  return (
    <GlassCard
      blur="lg"
      theme="surface"
      hover="none"
      className="h-full border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(244,248,255,0.72))]"
    >
      <GlassCardHeader className="border-b border-white/60 pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-700">
            <DatabaseZap className="size-3.5" />
            {t("corpus.eyebrow")}
          </div>
          <GlassCardTitle className="text-slate-900">
            {t("corpus.title")}
          </GlassCardTitle>
          <GlassCardDescription className="text-slate-500">
            {t("corpus.description")}
          </GlassCardDescription>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-5 pt-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <CorpusMetric
            label={t("corpus.metrics.indexed")}
            value={corpus?.indexedNoteCount ?? "—"}
          />
          <CorpusMetric
            label={t("corpus.metrics.workspace")}
            value={corpus?.managedWorkspaceNoteCount ?? "—"}
          />
          <CorpusMetric
            label={t("corpus.metrics.legacy")}
            value={corpus?.legacyVaultNoteCount ?? "—"}
          />
        </div>

        <div className="rounded-[1.5rem] border border-white/70 bg-slate-50/85 p-4 text-sm text-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {t("corpus.lastSynced")}
          </div>
          <div className="mt-2 text-base font-semibold text-slate-900">
            {corpus?.lastSyncedAt ?? t("corpus.notSynced")}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {t("corpus.note")}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-3 rounded-[1.6rem] border border-slate-200/70 bg-white/84 p-4 shadow-[0_18px_45px_-32px_rgba(15,23,42,0.32)]">
            <div className="flex items-center gap-2">
              <Search className="size-4 text-slate-400" />
              <div className="text-sm font-semibold text-slate-900">
                {t("corpus.preview.title")}
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                value={corpusQuery}
                onChange={(event) => onCorpusQueryChange(event.target.value)}
                placeholder={t("corpus.preview.placeholder")}
                className="h-11 rounded-2xl border-white/70 bg-white/90"
              />
              <Button
                onClick={onSearchCorpus}
                disabled={isSearchingCorpus || !state?.binding}
                className="h-11 rounded-2xl bg-slate-950 px-4 text-white"
              >
                {isSearchingCorpus ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
              </Button>
            </div>

            <div className="space-y-2">
              {corpusHits.length === 0 ? (
                <EmptyPreviewState t={t} hasQuery={Boolean(corpusQuery.trim())} />
              ) : (
                corpusHits.map((hit) => {
                  const selected = selectedCorpusHit?.assetId === hit.assetId
                  return (
                    <button
                      key={hit.assetId}
                      onClick={() => onSelectCorpusHit(hit.assetId)}
                      className={[
                        "w-full rounded-2xl border px-3 py-3 text-left transition",
                        selected
                          ? "border-indigo-300 bg-indigo-50/90 shadow-[0_18px_30px_-24px_rgba(79,70,229,0.45)]"
                          : "border-slate-200/80 bg-slate-50/80 hover:border-slate-300 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-900">
                            {hit.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {hit.relativePath}
                          </div>
                        </div>
                        <ScopeBadge scope={hit.scope} t={t} />
                      </div>
                      <div className="mt-2 text-xs leading-5 text-slate-600">
                        {hit.summary}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-[1.6rem] border border-slate-200/70 bg-slate-950/[0.95] p-4 text-slate-100 shadow-[0_30px_70px_-40px_rgba(15,23,42,0.58)]">
            <div className="flex items-center gap-2">
              <FileSearch className="size-4 text-indigo-300" />
              <div className="text-sm font-semibold">
                {t("corpus.inspector.title")}
              </div>
            </div>

            {selectedCorpusHit ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-base font-semibold text-white">
                    {selectedCorpusHit.title}
                  </div>
                  <div className="mt-1 break-all text-xs text-slate-400">
                    {selectedCorpusHit.relativePath}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <InspectorMetric
                    label={t("corpus.inspector.scope")}
                    value={t(`corpus.scopes.${selectedCorpusHit.scope}`)}
                  />
                  <InspectorMetric
                    label={t("corpus.inspector.score")}
                    value={selectedCorpusHit.score.toFixed(3)}
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {t("corpus.inspector.summary")}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-200">
                    {selectedCorpusHit.summary}
                  </div>
                </div>

                <div className="rounded-2xl border border-indigo-400/20 bg-indigo-400/10 p-4 text-sm text-indigo-50">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-indigo-200" />
                    <div>
                      <div className="font-semibold">
                        {t("corpus.inspector.agentUses.title")}
                      </div>
                      <div className="mt-1 text-indigo-100/85">
                        {t("corpus.inspector.agentUses.description")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm leading-6 text-slate-300">
                {t("corpus.inspector.empty")}
              </div>
            )}
          </div>
        </div>
      </GlassCardContent>

      <GlassCardFooter className="border-t border-white/60 pt-5">
        <Button
          onClick={onSyncCorpus}
          disabled={isSyncingCorpus || !state?.binding}
          className="h-11 rounded-full bg-[linear-gradient(135deg,#312e81,#2563eb)] px-6 text-white shadow-[0_20px_40px_-24px_rgba(37,99,235,0.55)]"
        >
          {isSyncingCorpus ? (
            <RefreshCw className="mr-2 size-4 animate-spin" />
          ) : (
            <DatabaseZap className="mr-2 size-4" />
          )}
          {isSyncingCorpus ? t("corpus.syncing") : t("corpus.sync")}
        </Button>
      </GlassCardFooter>
    </GlassCard>
  )
}

function CorpusMetric({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function ScopeBadge({
  scope,
  t,
}: {
  scope: string
  t: Translation
}) {
  const label = t(`corpus.scopes.${scope}`)
  return (
    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {label}
    </span>
  )
}

function InspectorMetric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  )
}

function EmptyPreviewState({
  t,
  hasQuery,
}: {
  t: Translation
  hasQuery: boolean
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 text-sm leading-6 text-slate-500">
      {hasQuery ? t("corpus.preview.noResults") : t("corpus.preview.empty")}
    </div>
  )
}
