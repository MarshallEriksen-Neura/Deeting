"use client"

import { DatabaseZap, FileSearch, RefreshCw, Search, Sparkles } from "lucide-react"

import { Button } from "@/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card"
import { Input } from "@/ui/shadcn/input"
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
  hasSearchedCorpus,
  corpusSearchError,
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
  hasSearchedCorpus: boolean
  corpusSearchError: string | null
  isSyncingCorpus: boolean
  isSearchingCorpus: boolean
  onCorpusQueryChange: (value: string) => void
  onSelectCorpusHit: (assetId: string) => void
  onSyncCorpus: () => void
  onSearchCorpus: () => void
}) {
  const corpus = state?.corpusStatus
  const searchDisabled =
    isSearchingCorpus || !state?.binding || !corpusQuery.trim()

  return (
    <Card className="h-full gap-0 py-0 border-[var(--hairline)] bg-[var(--panel-bg)] shadow-sm">
      <CardHeader className="border-b border-[var(--hairline)] pb-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-700">
            <DatabaseZap className="size-3.5" />
            {t("corpus.eyebrow")}
          </div>
          <CardTitle className="text-base text-[var(--ink)]">
            {t("corpus.title")}
          </CardTitle>
          <CardDescription className="text-sm text-[var(--ink-3)]">
            {t("corpus.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <CorpusMetric
            label={t("corpus.metrics.indexed")}
            value={corpus?.indexedNoteCount ?? "--"}
          />
          <CorpusMetric
            label={t("corpus.metrics.workspace")}
            value={corpus?.managedWorkspaceNoteCount ?? "--"}
          />
          <CorpusMetric
            label={t("corpus.metrics.legacy")}
            value={corpus?.legacyVaultNoteCount ?? "--"}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <CorpusMetric label="Pending" value={corpus?.pendingNoteCount ?? "--"} />
          <CorpusMetric label="Failed" value={corpus?.failedNoteCount ?? "--"} />
          <CorpusMetric label="Queued" value={corpus?.queuedChangeCount ?? "--"} />
        </div>

        <div className="rounded-xl border border-white/70 bg-slate-50/85 p-3 text-sm text-slate-700">
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
            {t("corpus.lastSynced")}
          </div>
          <div className="mt-1 text-base font-semibold text-slate-900">
            {corpus?.lastSyncedAt ?? t("corpus.notSynced")}
          </div>
          <div className="mt-1 text-xs leading-4 text-slate-500">
            {t("corpus.note")}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-2 rounded-xl border border-slate-200/70 bg-white/84 p-3">
            <div className="flex items-center gap-2">
              <Search className="size-4 text-slate-400" />
              <div className="text-sm font-semibold text-slate-900">
                {t("corpus.preview.title")}
              </div>
            </div>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault()
                if (!searchDisabled) {
                  onSearchCorpus()
                }
              }}
            >
              <Input
                value={corpusQuery}
                onChange={(event) => onCorpusQueryChange(event.target.value)}
                placeholder={t("corpus.preview.placeholder")}
                className="h-9 rounded-lg border-white/70 bg-white/90"
              />
              <Button
                type="submit"
                disabled={searchDisabled}
                className="h-9 rounded-lg bg-slate-950 px-4 text-white sm:min-w-[100px]"
              >
                {isSearchingCorpus ? (
                  <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Search className="mr-1.5 size-3.5" />
                )}
                {isSearchingCorpus
                  ? t("corpus.preview.searching")
                  : t("corpus.preview.search")}
              </Button>
            </form>
            <div className="text-xs leading-4 text-slate-500">
              {t("corpus.preview.hint")}
            </div>

            {isSearchingCorpus ? (
              <div className="inline-flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                <RefreshCw className="size-3.5 animate-spin" />
                {t("corpus.preview.loading")}
              </div>
            ) : null}

            <div className="space-y-2">
              {corpusSearchError ? (
                <PreviewErrorState message={corpusSearchError} />
              ) : corpusHits.length === 0 ? (
                <EmptyPreviewState t={t} hasSearched={hasSearchedCorpus} />
              ) : (
                corpusHits.map((hit) => {
                  const selected = selectedCorpusHit?.assetId === hit.assetId
                  return (
                    <button
                      key={hit.assetId}
                      onClick={() => onSelectCorpusHit(hit.assetId)}
                      className={[
                        "w-full rounded-lg border px-3 py-2.5 text-left transition",
                        selected
                          ? "border-indigo-300 bg-indigo-50/90"
                          : "border-slate-200/80 bg-slate-50/80 hover:border-slate-300 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="text-sm font-semibold text-slate-900">
                            {hit.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {hit.relativePath}
                          </div>
                        </div>
                        <ScopeBadge scope={hit.scope} t={t} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>{`doc ${hit.docId}`}</span>
                        <span>{`chunk ${hit.chunkIndex}`}</span>
                      </div>
                      <div className="mt-1 text-xs leading-4 text-slate-600">
                        {hit.summary}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200/70 bg-slate-950/[0.95] p-3 text-slate-100">
            <div className="flex items-center gap-2">
              <FileSearch className="size-4 text-indigo-300" />
              <div className="text-sm font-semibold">
                {t("corpus.inspector.title")}
              </div>
            </div>

            {corpusSearchError ? (
              <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-4 text-sm leading-5 text-rose-50">
                {corpusSearchError}
              </div>
            ) : selectedCorpusHit ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-sm font-semibold text-white">
                    {selectedCorpusHit.title}
                  </div>
                  <div className="mt-0.5 break-all text-xs text-slate-400">
                    {selectedCorpusHit.relativePath}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <InspectorMetric
                    label={t("corpus.inspector.scope")}
                    value={t(`corpus.scopes.${selectedCorpusHit.scope}`)}
                  />
                  <InspectorMetric
                    label={t("corpus.inspector.score")}
                    value={selectedCorpusHit.score.toFixed(3)}
                  />
                  <InspectorMetric
                    label="Lexical"
                    value={selectedCorpusHit.lexicalScore.toFixed(3)}
                  />
                  <InspectorMetric
                    label="Semantic"
                    value={selectedCorpusHit.semanticScore.toFixed(3)}
                  />
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-300">
                  {`doc ${selectedCorpusHit.docId} | chunk ${selectedCorpusHit.chunkIndex}`}
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
                    {t("corpus.inspector.summary")}
                  </div>
                  <div className="mt-1 text-sm leading-5 text-slate-200">
                    {selectedCorpusHit.summary}
                  </div>
                </div>

                <div className="rounded-lg border border-indigo-400/20 bg-indigo-400/10 p-3 text-sm text-indigo-50">
                  <div className="flex items-start gap-2.5">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-indigo-200" />
                    <div>
                      <div className="font-semibold">
                        {t("corpus.inspector.agentUses.title")}
                      </div>
                      <div className="mt-0.5 text-indigo-100/85">
                        {t("corpus.inspector.agentUses.description")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm leading-5 text-slate-300">
                {t("corpus.inspector.empty")}
              </div>
            )}
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex-wrap gap-2 border-t border-[var(--hairline)] pt-4">
        <Button
          onClick={onSyncCorpus}
          disabled={isSyncingCorpus || !state?.binding}
          className="h-9 rounded-lg bg-[linear-gradient(135deg,#312e81,#2563eb)] px-5 text-white"
        >
          {isSyncingCorpus ? (
            <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <DatabaseZap className="mr-1.5 size-3.5" />
          )}
          {isSyncingCorpus ? t("corpus.syncing") : t("corpus.sync")}
        </Button>
      </CardFooter>
    </Card>
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
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-slate-900">{value}</div>
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
    <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
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
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  )
}

function EmptyPreviewState({
  t,
  hasSearched,
}: {
  t: Translation
  hasSearched: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 text-sm leading-5 text-slate-500">
      {hasSearched ? t("corpus.preview.noResults") : t("corpus.preview.empty")}
    </div>
  )
}

function PreviewErrorState({
  message,
}: {
  message: string
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/90 p-3 text-sm leading-5 text-rose-700">
      {message}
    </div>
  )
}
