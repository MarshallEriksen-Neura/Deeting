"use client"

import { Activity, BrainCircuit, FileSearch, GitBranch } from "lucide-react"

import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"

type Translation = (key: string, values?: Record<string, string | number>) => string

const lifecycleSteps = [
  { icon: FileSearch, key: "scan" },
  { icon: Activity, key: "retrieve" },
  { icon: GitBranch, key: "delegate" },
  { icon: BrainCircuit, key: "promote" },
] as const

export function LlmWikiLifecycleCard({ t }: { t: Translation }) {
  return (
    <GlassCard
      blur="lg"
      theme="surface"
      hover="none"
      className="h-full border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.83),rgba(247,244,255,0.74))]"
    >
      <GlassCardHeader className="border-b border-white/60 pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-700">
            <BrainCircuit className="size-3.5" />
            {t("lifecycle.eyebrow")}
          </div>
          <GlassCardTitle className="text-slate-900">
            {t("lifecycle.title")}
          </GlassCardTitle>
          <GlassCardDescription className="text-slate-500">
            {t("lifecycle.description")}
          </GlassCardDescription>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-4 pt-6">
        {lifecycleSteps.map(({ icon: Icon, key }, index) => (
          <div
            key={key}
            className="flex gap-4 rounded-[1.5rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.28)]"
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_16px_32px_-24px_rgba(15,23,42,0.58)]">
              <Icon className="size-5" />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {t("lifecycle.stepLabel", { step: index + 1 })}
              </div>
              <div className="text-base font-semibold text-slate-900">
                {t(`lifecycle.steps.${key}.title`)}
              </div>
              <div className="text-sm leading-6 text-slate-500">
                {t(`lifecycle.steps.${key}.description`)}
              </div>
            </div>
          </div>
        ))}
      </GlassCardContent>
    </GlassCard>
  )
}
