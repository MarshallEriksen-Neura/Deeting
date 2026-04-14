"use client"

import { HardDrive } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card"
import { LlmWikiAgentCard } from "./llm-wiki-agent-card"
import { LlmWikiAutomationCard } from "./llm-wiki-automation-card"
import { LlmWikiBindingCard } from "./llm-wiki-binding-card"
import { LlmWikiCorpusCard } from "./llm-wiki-corpus-card"
import { LlmWikiHero } from "./llm-wiki-hero"
import { LlmWikiJourneyCard } from "./llm-wiki-journey-card"
import { LlmWikiLifecycleCard } from "./llm-wiki-lifecycle-card"
import { LlmWikiMaintenanceCard } from "./llm-wiki-maintenance-card"
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
    bindingMode,
    adoptFolderRelativePath,
    adoptionPreview,
    isLoading,
    isAnalyzing,
    isPreviewingAdoption,
    isConfirmingAdoption,
    isBootstrapping,
    isSyncingAgent,
    isSyncingCorpus,
    isSearchingCorpus,
    lastBootstrap,
    corpusQuery,
    corpusHits,
    selectedCorpusHit,
    hasSearchedCorpus,
    corpusSearchError,
    ingestSelectionInput,
    isIngestingSelection,
    lastIngestResult,
    isRunningLint,
    automation,
    lastLintReport,
    isUpdatingAutomationSettings,
    executingSuggestionId,
    dismissingSuggestionId,
    setVaultRoot,
    setWorkspaceRelativePath,
    setBindingMode,
    setAdoptFolderRelativePath,
    setCorpusQuery,
    setSelectedCorpusHitId,
    setIngestSelectionInput,
    refresh,
    analyze,
    confirmAdoption,
    bootstrap,
    copyAgentPrompt,
    syncMaintainerAgent,
    syncCorpus,
    searchCorpus,
    setAutomationSetting,
    executeAutomationSuggestion,
    dismissAutomationSuggestion,
    openTaskAgentHandoff,
    ingestSelection,
    runLint,
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
      <LlmWikiJourneyCard
        t={t}
        state={state}
        hasSearchedCorpus={hasSearchedCorpus}
        corpusHitCount={corpusHits.length}
        isAnalyzing={isAnalyzing}
        isBootstrapping={isBootstrapping}
        isSyncingCorpus={isSyncingCorpus}
        isSearchingCorpus={isSearchingCorpus}
        isSyncingAgent={isSyncingAgent}
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <LlmWikiBindingCard
          t={t}
          state={state}
          vaultRoot={vaultRoot}
          workspaceRelativePath={workspaceRelativePath}
          bindingMode={bindingMode}
          adoptFolderRelativePath={adoptFolderRelativePath}
          adoptionPreview={adoptionPreview}
          isAnalyzing={isAnalyzing}
          isPreviewingAdoption={isPreviewingAdoption}
          isConfirmingAdoption={isConfirmingAdoption}
          onVaultRootChange={setVaultRoot}
          onWorkspaceRelativePathChange={setWorkspaceRelativePath}
          onBindingModeChange={setBindingMode}
          onAdoptFolderRelativePathChange={setAdoptFolderRelativePath}
          onAnalyze={analyze}
          onConfirmAdoption={confirmAdoption}
          onRefresh={refresh}
        />

        <LlmWikiWorkspaceCard
          t={t}
          state={state}
          bindingMode={bindingMode}
          lastBootstrap={lastBootstrap}
          isBootstrapping={isBootstrapping}
          onBootstrap={bootstrap}
        />
      </div>

      <LlmWikiAutomationCard
        t={t}
        settings={automation?.settings ?? null}
        suggestions={automation?.suggestions ?? []}
        audit={automation?.audit ?? []}
        isUpdatingSettings={isUpdatingAutomationSettings}
        executingSuggestionId={executingSuggestionId}
        dismissingSuggestionId={dismissingSuggestionId}
        onToggleSetting={setAutomationSetting}
        onExecuteSuggestion={executeAutomationSuggestion}
        onDismissSuggestion={dismissAutomationSuggestion}
      />

      <LlmWikiMaintenanceCard
        t={t}
        ingestSelectionInput={ingestSelectionInput}
        onIngestSelectionInputChange={setIngestSelectionInput}
        onRefresh={refresh}
        onRebuildIndex={syncCorpus}
        onIngestSelection={ingestSelection}
        onRunLint={runLint}
        isRefreshing={isLoading}
        isRebuildingIndex={isSyncingCorpus}
        isIngestingSelection={isIngestingSelection}
        isRunningLint={isRunningLint}
        lastIngestResult={lastIngestResult}
        lastLintReport={lastLintReport}
        recentLifecycleActions={(automation?.audit ?? []).slice(0, 6)}
      />

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="grid gap-6">
          <LlmWikiLifecycleCard t={t} />
          <LlmWikiCorpusCard
            t={t}
            state={state}
            corpusQuery={corpusQuery}
            corpusHits={corpusHits}
            selectedCorpusHit={selectedCorpusHit}
            hasSearchedCorpus={hasSearchedCorpus}
            corpusSearchError={corpusSearchError}
            isSyncingCorpus={isSyncingCorpus}
            isSearchingCorpus={isSearchingCorpus}
            onCorpusQueryChange={setCorpusQuery}
            onSelectCorpusHit={setSelectedCorpusHitId}
            onSyncCorpus={syncCorpus}
            onSearchCorpus={searchCorpus}
          />
        </div>
        <LlmWikiAgentCard
          t={t}
          state={state}
          isSyncingAgent={isSyncingAgent}
          onCopyPrompt={copyAgentPrompt}
          onSyncMaintainerAgent={syncMaintainerAgent}
          onOpenTaskAgents={openTaskAgentHandoff}
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
