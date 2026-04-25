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
    <Card className="h-full gap-0 py-0 border-[var(--hairline)] bg-[var(--panel-bg)] shadow-sm">
      <CardHeader className="border-b border-[var(--hairline)] pb-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-violet-700">
            <BrainCircuit className="size-3.5" />
            {t("lifecycle.eyebrow")}
          </div>
          <CardTitle className="text-base text-[var(--ink)]">
            {t("lifecycle.title")}
          </CardTitle>
          <CardDescription className="text-sm text-[var(--ink-3)]">
            {t("lifecycle.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pt-4">
        {lifecycleSteps.map(({ icon: Icon, key }, index) => (
          <div
            key={key}
            className="flex gap-3 rounded-xl border border-white/70 bg-white/78 p-3"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">
              <Icon className="size-4" />
            </div>
            <div className="space-y-0.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
                {t("lifecycle.stepLabel", { step: index + 1 })}
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {t(`lifecycle.steps.${key}.title`)}
              </div>
              <div className="text-xs leading-4 text-slate-500">
                {t(`lifecycle.steps.${key}.description`)}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
