"use client"

import { HardDrive } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card"
import { LlmWikiAgentCard } from "./llm-wiki-agent-card"
import { LlmWikiBindingCard } from "./llm-wiki-binding-card"
import { LlmWikiHero } from "./llm-wiki-hero"
import { LlmWikiLifecycleCard } from "./llm-wiki-lifecycle-card"
import { useLlmWiki } from "./use-llm-wiki"
import { LlmWikiWorkspaceCard } from "./llm-wiki-workspace-card"

type Translation = (key: string, values?: Record<string, string | number>) => string

export function LlmWikiClient() {
  const t = useTranslations("llm-wiki") as unknown as Translation
  const {
    desktopSupported,
    state,
    vaultRoot,
    workspaceRelativePath,
    isLoading,
    isAnalyzing,
    isBootstrapping,
    isSyncingAgent,
    lastBootstrap,
    setVaultRoot,
    setWorkspaceRelativePath,
    refresh,
    analyze,
    bootstrap,
    copyAgentPrompt,
    syncMaintainerAgent,
  } = useLlmWiki(t)

  if (desktopSupported === null && isLoading) {
    return (
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          disabled
          className="rounded-full border border-white/60 bg-white/70 px-5 text-slate-500"
        >
          {t("loading")}
        </Button>
      </div>
    )
  }

  if (desktopSupported === false) {
    return (
      <GlassCard blur="lg" theme="surface" hover="none" className="border-white/15 bg-white/80">
        <GlassCardHeader>
          <GlassCardTitle className="flex items-center gap-3 text-slate-900">
            <HardDrive className="size-5 text-slate-500" />
            {t("desktopOnly.title")}
          </GlassCardTitle>
        </GlassCardHeader>
        <GlassCardContent className="text-sm leading-7 text-slate-500">
          {t("desktopOnly.description")}
        </GlassCardContent>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-6">
      <LlmWikiHero t={t} state={state} />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <LlmWikiBindingCard
          t={t}
          state={state}
          vaultRoot={vaultRoot}
          workspaceRelativePath={workspaceRelativePath}
          isAnalyzing={isAnalyzing}
          onVaultRootChange={setVaultRoot}
          onWorkspaceRelativePathChange={setWorkspaceRelativePath}
          onAnalyze={analyze}
          onRefresh={refresh}
        />

        <LlmWikiWorkspaceCard
          t={t}
          state={state}
          lastBootstrap={lastBootstrap}
          isBootstrapping={isBootstrapping}
          onBootstrap={bootstrap}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <LlmWikiLifecycleCard t={t} />
        <LlmWikiAgentCard
          t={t}
          state={state}
          isSyncingAgent={isSyncingAgent}
          onCopyPrompt={copyAgentPrompt}
          onSyncMaintainerAgent={syncMaintainerAgent}
        />
      </div>

      {isLoading && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            disabled
            className="rounded-full border border-white/60 bg-white/70 px-5 text-slate-500"
          >
            {t("loading")}
          </Button>
        </div>
      )}
    </div>
  )
}
