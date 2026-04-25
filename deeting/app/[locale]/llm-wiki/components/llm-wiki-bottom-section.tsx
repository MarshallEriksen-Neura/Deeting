"use client"

import {
  Bot,
  Copy,
  ExternalLink,
  Eye,
  Brain,
  ArrowRight,
  Cpu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassCard, GlassCardContent } from "@/components/ui/common/glass-card"
import { GlassButton } from "@/components/ui/common/glass-button"
import { Switch } from "@/components/ui/shadcn/switch"
import type { LocalLlmWikiState, LocalLlmWikiAutomationSuggestion } from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

const LIFECYCLE_STEPS = [
  { key: "scan", icon: Eye },
  { key: "retrieve", icon: Brain },
  { key: "delegate", icon: ArrowRight },
  { key: "promote", icon: Cpu },
] as const

const QUICK_SETTING_KEYS = [
  "autoSyncOnVaultBound",
  "suggestMaintainerOnWorkspaceBootstrap",
  "autoRefreshInspectorOnCorpusSync",
  "createCrystallizationCandidatesOnSessionEnd",
  "enableScheduleSuggestions",
] as const

interface BottomSectionProps {
  t: Translation
  state: LocalLlmWikiState | null
  isSyncingAgent: boolean
  isUpdatingAutomationSettings: boolean
  syncMaintainerAgent: () => Promise<void>
  copyAgentPrompt: () => Promise<void>
  openTaskAgentHandoff: () => void
  setAutomationSetting: (key: any, value: boolean) => Promise<void>
}

export function BottomSection({
  t,
  state,
  isSyncingAgent,
  isUpdatingAutomationSettings,
  syncMaintainerAgent,
  copyAgentPrompt,
  openTaskAgentHandoff,
  setAutomationSetting,
}: BottomSectionProps) {
  const maintainer = state?.maintainerAgent
  const binding = state?.binding
  const settings = state?.automation?.settings

  return (
    <div className="space-y-4">
      {/* Row 1: Agent status + Lifecycle */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Agent status card */}
        <GlassCard padding="sm" className="lg:col-span-1">
          <GlassCardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-[var(--r-10)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <Bot className="size-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--foreground)]">{t("agent.title")}</p>
                <p className="text-[10px] text-[var(--ink)]">{t("agent.description")}</p>
              </div>
            </div>

            {/* Status badge */}
            <div className="rounded-[var(--r-10)] border border-[var(--hairline)]/50 bg-[var(--panel-bg)]/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--ink)]">{t("agent.currentAgent.label")}</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                  maintainer ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"
                )}>
                  {maintainer ? t("agent.status.ready") : t("agent.status.pending")}
                </span>
              </div>
              <p className="mt-1 text-xs font-bold text-[var(--foreground)]">
                {maintainer?.name ?? t("agent.currentAgent.none")}
              </p>
              {maintainer && (
                <p className="mt-0.5 text-[10px] text-[var(--ink)]">
                  {t("agent.currentAgent.description", { updatedAt: maintainer.updatedAt })}
                </p>
              )}
            </div>

            {/* Facts */}
            <div className="space-y-1">
              <Fact label={t("agent.facts.read")} value={t("agent.factValues.read")} />
              <Fact label={t("agent.facts.write")} value={t("agent.factValues.write")} />
              {binding && <Fact label={t("agent.workspacePath")} value={binding.workspaceRelativePath} />}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-1.5">
              <GlassButton size="sm" className="h-7 text-[10px]" onClick={syncMaintainerAgent} loading={isSyncingAgent}>
                <Bot className="size-3" />
                {maintainer ? t("agent.updateMaintainer") : t("agent.createMaintainer")}
              </GlassButton>
              <GlassButton size="sm" variant="secondary" className="h-7 text-[10px]" onClick={copyAgentPrompt}>
                <Copy className="size-3" />
                {t("agent.copyPrompt")}
              </GlassButton>
              <GlassButton size="sm" variant="outline" className="h-7 text-[10px]" onClick={openTaskAgentHandoff}>
                <ExternalLink className="size-3" />
                {t("agent.openTaskAgents")}
              </GlassButton>
            </div>
          </GlassCardContent>
        </GlassCard>

        {/* Lifecycle steps */}
        <GlassCard padding="sm" className="lg:col-span-2">
          <GlassCardContent>
            <p className="mb-3 text-xs font-semibold text-[var(--foreground)]">{t("lifecycle.title")}</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {LIFECYCLE_STEPS.map((step, i) => {
                const Icon = step.icon
                return (
                  <div
                    key={step.key}
                    className="group relative rounded-[var(--r-10)] border border-[var(--hairline)]/50 bg-[var(--panel-bg)]/30 p-3 transition-all duration-200 hover:bg-[var(--accent-soft)]/20 hover:border-[var(--accent-border)]/30"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex size-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)] transition-colors group-hover:bg-[var(--accent-strong)] group-hover:text-white">
                        <Icon className="size-3.5" />
                      </div>
                      <span className="text-[9px] font-medium text-[var(--ink)]">{t("lifecycle.stepLabel", { step: i + 1 })}</span>
                    </div>
                    <p className="text-xs font-semibold text-[var(--foreground)]">
                      {t(`lifecycle.steps.${step.key}.title`)}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--ink)] line-clamp-2">
                      {t(`lifecycle.steps.${step.key}.description`)}
                    </p>
                    {/* Connector arrow */}
                    {i < LIFECYCLE_STEPS.length - 1 && (
                      <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 hidden lg:block text-[var(--ink)] z-10">
                        <ArrowRight className="size-2.5" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </GlassCardContent>
        </GlassCard>
      </div>

      {/* Row 2: Automation settings */}
      <GlassCard padding="sm">
        <GlassCardContent>
          <p className="mb-3 text-xs font-semibold text-[var(--foreground)]">{t("automation.settings.title")}</p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_SETTING_KEYS.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--panel-bg)]/40"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-[var(--foreground)]">
                    {t(`automation.settings.${key}.title`)}
                  </p>
                </div>
                <Switch
                  checked={settings?.[key] ?? false}
                  onCheckedChange={(v) => setAutomationSetting(key, v)}
                  disabled={isUpdatingAutomationSettings}
                />
              </div>
            ))}
          </div>
        </GlassCardContent>
      </GlassCard>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--hairline)]/30 bg-[var(--panel-bg)]/20 px-2.5 py-1 text-[10px]">
      <span className="text-[var(--ink)]">{label}</span>
      <span className="font-medium text-[var(--foreground)] truncate max-w-[140px]">{value}</span>
    </div>
  )
}
