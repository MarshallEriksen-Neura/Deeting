"use client"

import { HardDrive, FileText, Zap, Bot, CheckCircle2, Circle } from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassCard } from "@/components/ui/common/glass-card"
import type { LocalLlmWikiState } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

interface StatsBarProps {
  t: Translation
  state: LocalLlmWikiState | null
}

interface StatItem {
  icon: React.ReactNode
  value: string | number
  label: string
  color: string
  bgColor: string
}

export function StatsBar({ t, state }: StatsBarProps) {
  const binding = state?.binding
  const workspace = state?.workspaceStatus
  const corpus = state?.corpusStatus
  const maintainer = state?.maintainerAgent
  const suggestions = state?.automation?.suggestions ?? []

  const isConnected = !!binding
  const isWorkspaceReady = !!workspace?.workspaceExists
  const isCorpusReady = (corpus?.indexedNoteCount ?? 0) > 0
  const isAgentReady = !!maintainer

  const readySteps = [isConnected, isWorkspaceReady, isCorpusReady, isAgentReady].filter(Boolean).length

  const stats: StatItem[] = [
    {
      icon: <HardDrive className="size-5" />,
      value: isConnected ? binding!.vaultName : "—",
      label: t("hero.metrics.workspace"),
      color: "text-[var(--accent-strong)]",
      bgColor: "bg-[var(--accent-soft)]",
    },
    {
      icon: <FileText className="size-5" />,
      value: corpus?.indexedNoteCount ?? 0,
      label: t("hero.metrics.notes"),
      color: "text-[var(--info)]",
      bgColor: "bg-[var(--info-soft)]",
    },
    {
      icon: <Zap className="size-5" />,
      value: suggestions.length,
      label: t("automation.suggestions.title"),
      color: "text-[var(--warn)]",
      bgColor: "bg-[var(--warn-soft)]",
    },
    {
      icon: <Bot className="size-5" />,
      value: maintainer ? maintainer.name : t("agent.status.pending"),
      label: t("agent.currentAgent.label"),
      color: "text-[var(--ok)]",
      bgColor: "bg-[var(--ok-soft)]",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {stats.map((stat, i) => (
        <GlassCard key={i} padding="sm" hover="lift" className="flex items-center gap-3">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-[var(--r-10)]", stat.bgColor, stat.color)}>
            {stat.icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-[var(--foreground)]">
              {stat.value}
            </p>
            <p className="text-[11px] text-[var(--ink)]">{stat.label}</p>
          </div>
        </GlassCard>
      ))}

      {/* Pipeline progress mini card */}
      <GlassCard padding="sm" hover="lift" className="flex flex-col justify-center">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] text-[var(--ink)]">{t("journey.eyebrow")}</p>
          <span className="text-xs font-bold text-[var(--accent-strong)]">{readySteps}/4</span>
        </div>
        <div className="flex gap-1">
          {[isConnected, isWorkspaceReady, isCorpusReady, isAgentReady].map((ready, i) => (
            <div
              key={i}
              className={cn(
                "h-2 flex-1 rounded-full transition-all duration-500",
                ready
                  ? "bg-[var(--accent-strong)]"
                  : "bg-[var(--panel-bg)] border border-[var(--hairline)]"
              )}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[9px] text-[var(--ink)]">
          <span>{t("journey.stages.connect.title")}</span>
          <span>{t("journey.stages.handoff.title")}</span>
        </div>
      </GlassCard>
    </div>
  )
}
