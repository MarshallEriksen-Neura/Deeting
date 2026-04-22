"use client"
import { Bot, Copy, RefreshCw, Sparkles } from "lucide-react"

import { Button } from "@/ui/shadcn/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card"
import { Textarea } from "@/ui/shadcn/textarea"
import type { LocalLlmWikiState } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function LlmWikiAgentCard({
  t,
  state,
  isSyncingAgent,
  onCopyPrompt,
  onSyncMaintainerAgent,
  onOpenTaskAgents,
}: {
  t: Translation
  state: LocalLlmWikiState | null
  isSyncingAgent: boolean
  onCopyPrompt: () => void
  onSyncMaintainerAgent: () => void
  onOpenTaskAgents: () => void
}) {
  const prompt = state?.recommendedAgentPrompt ?? ""
  const maintainer = state?.maintainerAgent
  const workspacePath = state?.workspaceStatus?.resolvedWorkspacePath ?? null

  return (
    <Card className="h-full gap-0 py-0 border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[0_18px_40px_-30px_rgba(15,17,28,0.22)]">
      <CardHeader className="border-b border-[var(--hairline)] pb-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
            <Bot className="size-3.5" />
            {t("agent.eyebrow")}
          </div>
          <CardTitle className="text-[var(--ink)]">
            {t("agent.title")}
          </CardTitle>
          <CardDescription className="text-[var(--ink-3)]">
            {t("agent.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-6">
        <div className="rounded-[1.75rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(236,248,255,0.82))] p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {t("agent.currentAgent.label")}
              </div>
              <div className="text-lg font-semibold text-slate-900">
                {maintainer?.name ?? t("agent.currentAgent.none")}
              </div>
            </div>
            <span
              className={[
                "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                maintainer
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700",
              ].join(" ")}
            >
              {maintainer ? t("agent.status.ready") : t("agent.status.pending")}
            </span>
          </div>
          <div className="mt-3 text-sm leading-6 text-slate-600">
            {maintainer
              ? t("agent.currentAgent.description", {
                  updatedAt: maintainer.updatedAt,
                })
              : t("agent.currentAgent.emptyDescription")}
          </div>
          {workspacePath ? (
            <div className="mt-4 rounded-2xl border border-white/70 bg-white/75 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {t("agent.workspacePath")}
              </div>
              <div className="mt-1 break-all text-sm font-medium text-slate-800">
                {workspacePath}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-[1.75rem] border border-white/70 bg-white/78 p-4 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.32)] sm:grid-cols-2">
          <AgentFact label={t("agent.facts.read")} value={t("agent.factValues.read")} />
          <AgentFact label={t("agent.facts.write")} value={t("agent.factValues.write")} />
        </div>

        <div className="rounded-[1.5rem] border border-sky-200/70 bg-sky-50/80 p-4 text-sm text-sky-950">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-600" />
            <div className="space-y-2">
              <div className="font-semibold">{t("agent.tip.title")}</div>
              <div className="text-sky-900/85">{t("agent.tip.description")}</div>
              <div className="grid gap-2 pt-1">
                <HandoffStep
                  title={t("agent.handoff.stepOne.title")}
                  description={t("agent.handoff.stepOne.description")}
                />
                <HandoffStep
                  title={t("agent.handoff.stepTwo.title")}
                  description={t("agent.handoff.stepTwo.description")}
                />
                <HandoffStep
                  title={t("agent.handoff.stepThree.title")}
                  description={t("agent.handoff.stepThree.description")}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-amber-200/70 bg-amber-50/90 p-4 text-sm text-amber-950">
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="font-semibold">{t("agent.prerequisite.title")}</div>
              <div className="leading-6 text-amber-900/85">
                {t("agent.prerequisite.description")}
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="rounded-full border-amber-300 bg-white/80 text-amber-900 hover:bg-white">
              <a
                href="https://mcp-obsidian.org/install/"
                target="_blank"
                rel="noreferrer"
              >
                {t("agent.prerequisite.docs")}
              </a>
            </Button>
          </div>
        </div>

        <Textarea
          value={prompt}
          readOnly
          className="min-h-[260px] rounded-[1.75rem] border-white/70 bg-slate-950/[0.95] p-5 font-mono text-xs leading-6 text-slate-100 shadow-[0_32px_70px_-42px_rgba(15,23,42,0.58)]"
        />
      </CardContent>

      <CardFooter className="flex-wrap gap-3 border-t border-[var(--hairline)] pt-5">
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

        <button
          type="button"
          onClick={onOpenTaskAgents}
          className="inline-flex h-11 items-center justify-center rounded-full border border-white/70 bg-white/80 px-5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white"
        >
          <Bot className="mr-2 size-4 text-sky-600" />
          {t("agent.openTaskAgents")}
        </button>
      </CardFooter>
    </Card>
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

function HandoffStep({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-sky-200 bg-white/70 px-3 py-3">
      <div className="text-sm font-semibold text-sky-950">{title}</div>
      <div className="mt-1 text-xs leading-5 text-sky-900/80">{description}</div>
    </div>
  )
}
