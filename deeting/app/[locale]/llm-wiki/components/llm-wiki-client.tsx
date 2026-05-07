"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { BookOpen, Loader2, RefreshCw, Settings } from "lucide-react"

import { GlassButton } from "@/components/ui/common/glass-button"
import { useLlmWiki } from "./use-llm-wiki"
import { StatsBar } from "./llm-wiki-stats-bar"
import { ListPanel, type ListTab } from "./llm-wiki-list-panel"
import { DetailPanel } from "./llm-wiki-detail-panel"
import { BottomSection } from "./llm-wiki-bottom-section"
import { SetupForm } from "./llm-wiki-setup-form"

export function LlmWikiClient() {
  const t = useTranslations("llm-wiki")
  const wiki = useLlmWiki(t)

  const [activeTab, setActiveTab] = React.useState<ListTab>("maintenance")
  const [selectedSuggestionId, setSelectedSuggestionId] = React.useState<string | null>(null)
  const [showSetup, setShowSetup] = React.useState(false)

  const selectedSuggestion = React.useMemo(() => {
    const suggestions = wiki.state?.automation?.suggestions ?? []
    return suggestions.find((s) => s.id === selectedSuggestionId) ?? null
  }, [wiki.state?.automation?.suggestions, selectedSuggestionId])

  // Auto-show setup on first load if not connected
  React.useEffect(() => {
    if (!wiki.isLoading && wiki.state && !wiki.state.binding) {
      setShowSetup(true)
    }
  }, [wiki.isLoading, wiki.state])

  if (wiki.desktopSupported === false) {
    return (
      <div className="space-y-6">
        <div className="rounded-[var(--r-14)] border border-[var(--hairline)] bg-[var(--card)]/60 p-8 text-center">
          <p className="text-lg font-semibold text-[var(--foreground)]">{t("desktopOnly.title")}</p>
          <p className="mt-2 text-[var(--muted)]">{t("desktopOnly.description")}</p>
        </div>
      </div>
    )
  }

  if (wiki.isLoading || wiki.desktopSupported === null) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="size-6 animate-spin text-[var(--accent-strong)]" />
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-[-0.02em] text-[var(--ink)] md:text-2xl">
            <BookOpen className="size-6 text-[var(--accent-strong)]" />
            {t("hero.title")}
          </h1>
          <p className="text-sm text-[var(--ink-2)]">{t("hero.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <GlassButton variant="secondary" size="sm" onClick={() => setShowSetup(true)}>
            <Settings className="size-3.5" />
            {t("tabs.setup")}
          </GlassButton>
          <GlassButton variant="secondary" size="icon-sm" onClick={wiki.refresh}>
            <RefreshCw className="size-3.5" />
          </GlassButton>
        </div>
      </div>

      {/* Stats bar */}
      <StatsBar t={t} state={wiki.state} />

      {/* Main area: left list + right detail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5" style={{ minHeight: "420px" }}>
        {/* Left panel */}
        <div className="lg:col-span-2">
          <ListPanel
            t={t}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            // Search
            corpusQuery={wiki.corpusQuery}
            corpusHits={wiki.corpusHits}
            selectedCorpusHitId={wiki.selectedCorpusHit?.assetId ?? null}
            hasSearchedCorpus={wiki.hasSearchedCorpus}
            corpusSearchError={wiki.corpusSearchError}
            isSearchingCorpus={wiki.isSearchingCorpus}
            isSyncingCorpus={wiki.isSyncingCorpus}
            setCorpusQuery={wiki.setCorpusQuery}
            setSelectedCorpusHitId={wiki.setSelectedCorpusHitId}
            searchCorpus={wiki.searchCorpus}
            syncCorpus={wiki.syncCorpus}
            // Suggestions
            suggestions={wiki.state?.automation?.suggestions ?? []}
            selectedSuggestionId={selectedSuggestionId}
            setSelectedSuggestionId={setSelectedSuggestionId}
            executingSuggestionId={wiki.executingSuggestionId}
            dismissingSuggestionId={wiki.dismissingSuggestionId}
            batchDismissingActionKind={wiki.batchDismissingActionKind}
            executeAutomationSuggestion={wiki.executeAutomationSuggestion}
            dismissAutomationSuggestion={wiki.dismissAutomationSuggestion}
            dismissBatchAutomationSuggestions={wiki.dismissBatchAutomationSuggestions}
            // Maintenance
            ingestSelectionInput={wiki.ingestSelectionInput}
            isIngestingSelection={wiki.isIngestingSelection}
            lastIngestResult={wiki.lastIngestResult}
            isRunningLint={wiki.isRunningLint}
            lastLintReport={wiki.lastLintReport}
            setIngestSelectionInput={wiki.setIngestSelectionInput}
            ingestSelection={wiki.ingestSelection}
            runLint={wiki.runLint}
          />
        </div>

        {/* Right panel */}
        <div className="lg:col-span-3">
          <DetailPanel
            t={t}
            activeTab={activeTab}
            selectedCorpusHit={wiki.selectedCorpusHit}
            selectedSuggestion={selectedSuggestion}
            executingSuggestionId={wiki.executingSuggestionId}
            dismissingSuggestionId={wiki.dismissingSuggestionId}
            batchDismissingActionKind={wiki.batchDismissingActionKind}
            executeAutomationSuggestion={wiki.executeAutomationSuggestion}
            dismissAutomationSuggestion={wiki.dismissAutomationSuggestion}
            state={wiki.state}
            lastIngestResult={wiki.lastIngestResult}
            lastLintReport={wiki.lastLintReport}
            onOpenSetup={() => setShowSetup(true)}
          />
        </div>
      </div>

      {/* Bottom section */}
      <BottomSection
        t={t}
        state={wiki.state}
        isSyncingAgent={wiki.isSyncingAgent}
        isUpdatingAutomationSettings={wiki.isUpdatingAutomationSettings}
        syncMaintainerAgent={wiki.syncMaintainerAgent}
        copyAgentPrompt={wiki.copyAgentPrompt}
        openTaskAgentHandoff={wiki.openTaskAgentHandoff}
        setAutomationSetting={wiki.setAutomationSetting}
      />

      {/* Setup modal */}
      <SetupForm
        t={t}
        visible={showSetup}
        onClose={() => setShowSetup(false)}
        vaultRoot={wiki.vaultRoot}
        workspaceRelativePath={wiki.workspaceRelativePath}
        bindingMode={wiki.bindingMode}
        adoptFolderRelativePath={wiki.adoptFolderRelativePath}
        adoptionPreview={wiki.adoptionPreview}
        state={wiki.state}
        isAnalyzing={wiki.isAnalyzing}
        isPreviewingAdoption={wiki.isPreviewingAdoption}
        isConfirmingAdoption={wiki.isConfirmingAdoption}
        setVaultRoot={wiki.setVaultRoot}
        setWorkspaceRelativePath={wiki.setWorkspaceRelativePath}
        setBindingMode={wiki.setBindingMode}
        setAdoptFolderRelativePath={wiki.setAdoptFolderRelativePath}
        analyze={wiki.analyze}
        confirmAdoption={wiki.confirmAdoption}
        refresh={wiki.refresh}
        isBootstrapping={wiki.isBootstrapping}
        lastBootstrap={wiki.lastBootstrap}
        bootstrap={wiki.bootstrap}
      />
    </div>
  )
}
