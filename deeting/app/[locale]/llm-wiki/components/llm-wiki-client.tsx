"use client"

import * as React from "react"
import { Bot, Database, HardDrive, Wrench } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/ui/shadcn/button"
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/ui/common/glass-card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs"
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
type LlmWikiTabValue = "setup" | "operations" | "corpus" | "agent"

export function LlmWikiClient() {
  const t = useTranslations("llm-wiki") as unknown as Translation
  const [activeTab, setActiveTab] = React.useState<LlmWikiTabValue>("setup")
  const tabsAnchorRef = React.useRef<HTMLDivElement | null>(null)
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

  const handleTabChange = React.useCallback((value: string) => {
    setActiveTab(value as LlmWikiTabValue)
  }, [])

  const handleJourneyNavigate = React.useCallback((tab: LlmWikiTabValue) => {
    setActiveTab(tab)
    tabsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

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
        onNavigateTab={handleJourneyNavigate}
      />

      <div ref={tabsAnchorRef}>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-5">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-[1.4rem] border border-white/60 bg-white/70 p-1 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)] md:grid-cols-4">
            <TabsTrigger
              value="setup"
              className="h-auto min-h-14 flex-col gap-1 rounded-[1.05rem] px-3 py-3 text-center text-xs leading-tight whitespace-normal text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 sm:text-sm"
            >
              <HardDrive className="size-4" />
              {t("tabs.setup")}
            </TabsTrigger>
            <TabsTrigger
              value="operations"
              className="h-auto min-h-14 flex-col gap-1 rounded-[1.05rem] px-3 py-3 text-center text-xs leading-tight whitespace-normal text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 sm:text-sm"
            >
              <Wrench className="size-4" />
              {t("tabs.operations")}
            </TabsTrigger>
            <TabsTrigger
              value="corpus"
              className="h-auto min-h-14 flex-col gap-1 rounded-[1.05rem] px-3 py-3 text-center text-xs leading-tight whitespace-normal text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 sm:text-sm"
            >
              <Database className="size-4" />
              {t("tabs.corpus")}
            </TabsTrigger>
            <TabsTrigger
              value="agent"
              className="h-auto min-h-14 flex-col gap-1 rounded-[1.05rem] px-3 py-3 text-center text-xs leading-tight whitespace-normal text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 sm:text-sm"
            >
              <Bot className="size-4" />
              {t("tabs.agent")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="m-0">
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
          </TabsContent>

          <TabsContent value="operations" className="m-0">
            <div className="grid gap-6">
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
            </div>
          </TabsContent>

          <TabsContent value="corpus" className="m-0">
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
          </TabsContent>

          <TabsContent value="agent" className="m-0">
            <LlmWikiAgentCard
              t={t}
              state={state}
              isSyncingAgent={isSyncingAgent}
              onCopyPrompt={copyAgentPrompt}
              onSyncMaintainerAgent={syncMaintainerAgent}
              onOpenTaskAgents={openTaskAgentHandoff}
            />
          </TabsContent>
        </Tabs>
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
