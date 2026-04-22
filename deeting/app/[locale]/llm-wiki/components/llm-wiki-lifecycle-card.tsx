"use client"

import { Activity, BrainCircuit, FileSearch, GitBranch } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card"

type Translation = (key: string, values?: Record<string, string | number>) => string

const lifecycleSteps = [
  { icon: FileSearch, key: "scan" },
  { icon: Activity, key: "retrieve" },
  { icon: GitBranch, key: "delegate" },
  { icon: BrainCircuit, key: "promote" },
] as const

export function LlmWikiLifecycleCard({ t }: { t: Translation }) {
  return (
    <Card className="h-full gap-0 py-0 border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[0_18px_40px_-30px_rgba(15,17,28,0.22)]">
      <CardHeader className="border-b border-[var(--hairline)] pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-700">
            <BrainCircuit className="size-3.5" />
            {t("lifecycle.eyebrow")}
          </div>
          <CardTitle className="text-[var(--ink)]">
            {t("lifecycle.title")}
          </CardTitle>
          <CardDescription className="text-[var(--ink-3)]">
            {t("lifecycle.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-6">
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
      </CardContent>
    </Card>
  )
}
