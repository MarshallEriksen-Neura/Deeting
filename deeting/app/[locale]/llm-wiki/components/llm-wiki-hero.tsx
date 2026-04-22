"use client"

import { BookOpen, HardDrive, Sparkles, Workflow } from "lucide-react"

import { GlassCard } from "@/ui/common/glass-card"
import type { LocalLlmWikiState } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function LlmWikiHero({
  t,
  state,
}: {
  t: Translation
  state: LocalLlmWikiState | null
}) {
  const corpus = state?.corpusStatus
  const workspace = state?.workspaceStatus

  return (
    <GlassCard
      blur="xl"
      theme="surface"
      hover="none"
      className="overflow-hidden border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(242,247,255,0.68)_42%,rgba(236,255,250,0.58)_100%)] shadow-[0_30px_90px_-42px_rgba(16,24,40,0.42)]"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-12 top-0 h-36 w-36 rounded-full bg-sky-400/18 blur-3xl" />
        <div className="absolute right-0 top-10 h-40 w-40 rounded-full bg-emerald-300/18 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-white/70" />
      </div>

      <div className="relative grid gap-8 p-7 lg:grid-cols-[1.25fr_0.95fr] lg:p-8">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 shadow-sm backdrop-blur-xl">
            <Sparkles className="size-3.5 text-sky-500" />
            {t("hero.eyebrow")}
          </div>

          <div className="space-y-3">
            <h1 className="max-w-3xl font-serif text-3xl leading-tight tracking-[-0.04em] text-slate-900 md:text-5xl">
              {t("hero.title")}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
              {t("hero.description")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <HeroPill icon={HardDrive} label={t("hero.readScope")} />
            <HeroPill icon={BookOpen} label={t("hero.writeScope")} />
            <HeroPill icon={Workflow} label={t("hero.agentFlow")} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <HeroMetric
            label={t("hero.metrics.notes")}
            value={corpus?.indexedNoteCount ?? "--"}
            hint={t("hero.metrics.notesHint")}
          />
          <HeroMetric
            label={t("hero.metrics.attachments")}
            value={corpus?.queuedChangeCount ?? "--"}
            hint={t("hero.metrics.attachmentsHint")}
          />
          <HeroMetric
            label={t("hero.metrics.workspace")}
            value={workspace?.workspaceExists ? t("hero.metrics.ready") : t("hero.metrics.pending")}
            hint={t("hero.metrics.workspaceHint", {
              readyCount: workspace?.readyFileCount ?? 0,
            })}
          />
        </div>
      </div>
    </GlassCard>
  )
}

function HeroPill({
  icon: Icon,
  label,
}: {
  icon: typeof Sparkles
  label: string
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/72 px-3.5 py-2 text-xs font-medium text-slate-600 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <Icon className="size-3.5 text-sky-500" />
      <span>{label}</span>
    </div>
  )
}

function HeroMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint: string
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/60 bg-white/74 p-4 shadow-[0_14px_36px_-24px_rgba(15,23,42,0.3)] backdrop-blur-xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-900">
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{hint}</div>
    </div>
  )
}
