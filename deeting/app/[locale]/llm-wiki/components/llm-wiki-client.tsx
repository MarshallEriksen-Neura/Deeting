"use client"

import * as React from "react"
import { Bot, Database, HardDrive, Wrench } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/ui/shadcn/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs"
import { LlmWikiAgentCard } from "./llm-wiki-agent-card"
import { LlmWikiAutomationCard } from "./llm-wiki-automation-card"
import { LlmWikiBindingCard } from "./llm-wiki-binding-card"
import { LlmWikiCorpusCard } from "./llm-wiki-corpus-card"
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

  if (desktopSupported === null && isLoading) {
    return (
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          disabled
          className="rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-5 text-[var(--ink-3)]"
        >
          {t("loading")}
        </Button>
      </div>
    )
  }

  if (desktopSupported === false) {
    return (
      <Card className="gap-0 py-0 border-[var(--hairline)] bg-[var(--panel-bg)] shadow-[0_18px_40px_-30px_rgba(15,17,28,0.22)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-[var(--ink)]">
            <HardDrive className="size-5 text-slate-500" />
            {t("desktopOnly.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-7 text-[var(--ink-3)]">
          {t("desktopOnly.description")}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div ref={tabsAnchorRef}>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)]/88 p-1 shadow-sm backdrop-blur-xl md:grid-cols-4">
            <TabsTrigger
              value="setup"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-lg px-3 py-2 text-center text-xs leading-tight whitespace-normal text-[var(--ink-3)] data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:text-[var(--accent-ink)] data-[state=active]:shadow-none sm:text-sm"
            >
              <HardDrive className="size-4" />
              {t("tabs.setup")}
            </TabsTrigger>
            <TabsTrigger
              value="operations"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-lg px-3 py-2 text-center text-xs leading-tight whitespace-normal text-[var(--ink-3)] data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:text-[var(--accent-ink)] data-[state=active]:shadow-none sm:text-sm"
            >
              <Wrench className="size-4" />
              {t("tabs.operations")}
            </TabsTrigger>
            <TabsTrigger
              value="corpus"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-lg px-3 py-2 text-center text-xs leading-tight whitespace-normal text-[var(--ink-3)] data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:text-[var(--accent-ink)] data-[state=active]:shadow-none sm:text-sm"
            >
              <Database className="size-4" />
              {t("tabs.corpus")}
            </TabsTrigger>
            <TabsTrigger
              value="agent"
              className="h-auto min-h-10 flex-col gap-0.5 rounded-lg px-3 py-2 text-center text-xs leading-tight whitespace-normal text-[var(--ink-3)] data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:text-[var(--accent-ink)] data-[state=active]:shadow-none sm:text-sm"
            >
              <Bot className="size-4" />
              {t("tabs.agent")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="m-0">
            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
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
            <div className="grid gap-4">
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
            <div className="grid gap-4">
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
            className="rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-5 text-[var(--ink-3)]"
          >
            {t("loading")}
          </Button>
        </div>
      )}
    </div>
  )
}
