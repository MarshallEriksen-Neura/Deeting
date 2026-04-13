"use client"

import Link from "next/link"
import { Bot, Copy, RefreshCw, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from "@/components/ui/glass-card"
import { Textarea } from "@/components/ui/textarea"
import type { LocalLlmWikiState } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function LlmWikiAgentCard({
  t,
  state,
  isSyncingAgent,
  onCopyPrompt,
  onSyncMaintainerAgent,
}: {
  t: Translation
  state: LocalLlmWikiState | null
  isSyncingAgent: boolean
  onCopyPrompt: () => void
  onSyncMaintainerAgent: () => void
}) {
  const prompt = state?.recommendedAgentPrompt ?? ""
  const maintainer = state?.maintainerAgent

  return (
    <GlassCard
      blur="lg"
      theme="surface"
      hover="none"
      className="h-full border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.85),rgba(241,248,255,0.74))]"
    >
      <GlassCardHeader className="border-b border-white/60 pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
            <Bot className="size-3.5" />
            {t("agent.eyebrow")}
          </div>
          <GlassCardTitle className="text-slate-900">
            {t("agent.title")}
          </GlassCardTitle>
          <GlassCardDescription className="text-slate-500">
            {t("agent.description")}
          </GlassCardDescription>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-4 pt-6">
        <div className="grid gap-3 rounded-[1.75rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)] sm:grid-cols-2">
          <AgentFact label={t("agent.facts.read")} value={t("agent.factValues.read")} />
          <AgentFact label={t("agent.facts.write")} value={t("agent.factValues.write")} />
        </div>

        <div className="rounded-[1.5rem] border border-white/70 bg-slate-50/85 p-4 text-sm text-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {t("agent.currentAgent.label")}
          </div>
          <div className="mt-2 text-base font-semibold text-slate-900">
            {maintainer?.name ?? t("agent.currentAgent.none")}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {maintainer
              ? t("agent.currentAgent.description", {
                  updatedAt: maintainer.updatedAt,
                })
              : t("agent.currentAgent.emptyDescription")}
          </div>
        </div>

        <Textarea
          value={prompt}
          readOnly
          className="min-h-[260px] rounded-[1.75rem] border-white/70 bg-slate-950/[0.95] p-5 font-mono text-xs leading-6 text-slate-100 shadow-[0_32px_70px_-42px_rgba(15,23,42,0.58)]"
        />

        <div className="rounded-[1.5rem] border border-sky-200/70 bg-sky-50/80 p-4 text-sm text-sky-950">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-600" />
            <div className="space-y-1">
              <div className="font-semibold">{t("agent.tip.title")}</div>
              <div className="text-sky-900/85">{t("agent.tip.description")}</div>
            </div>
          </div>
        </div>
      </GlassCardContent>

      <GlassCardFooter className="border-t border-white/60 pt-5">
        <Button
          onClick={onSyncMaintainerAgent}
          disabled={isSyncingAgent || !state?.binding}
          className="h-11 rounded-full bg-[linear-gradient(135deg,#1d4ed8,#0f766e)] px-6 text-white shadow-[0_20px_40px_-24px_rgba(29,78,216,0.55)]"
        >
          {isSyncingAgent ? (
            <RefreshCw className="mr-2 size-4 animate-spin" />
          ) : (
            <Bot className="mr-2 size-4" />
          )}
          {maintainer ? t("agent.updateMaintainer") : t("agent.createMaintainer")}
        </Button>

        <Button
          onClick={onCopyPrompt}
          className="h-11 rounded-full bg-[linear-gradient(135deg,#0f172a,#0369a1)] px-6 text-white shadow-[0_20px_40px_-24px_rgba(3,105,161,0.65)]"
        >
          <Copy className="mr-2 size-4" />
          {t("agent.copyPrompt")}
        </Button>

        <Link
          href="/dashboard/user/task-agents"
          className="inline-flex h-11 items-center justify-center rounded-full border border-white/70 bg-white/80 px-5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white"
        >
          <Bot className="mr-2 size-4 text-sky-600" />
          {t("agent.openTaskAgents")}
        </Link>
      </GlassCardFooter>
    </GlassCard>
  )
}

function AgentFact({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}
