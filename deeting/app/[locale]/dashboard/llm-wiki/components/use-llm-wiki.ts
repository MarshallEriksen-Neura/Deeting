"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  bootstrapLocalLlmWikiWorkspace,
  createOrUpdateLocalLlmWikiMaintainerAgent,
  dismissLocalLlmWikiAutomationSuggestion,
  executeLocalLlmWikiAutomationSuggestion,
  getLocalLlmWikiState,
  saveLocalLlmWikiBinding,
  searchLocalLlmWikiCorpus,
  syncLocalLlmWikiCorpus,
  supportsLocalLlmWiki,
  updateLocalLlmWikiAutomationSettings,
  type LocalLlmWikiAutomationSuggestion,
  type BootstrapLocalLlmWikiWorkspaceResult,
  type LocalLlmWikiCorpusSearchHit,
  type LocalLlmWikiState,
} from "@/lib/api/llm-wiki"
import { useOpenWorkflow } from "@/hooks/use-open-workflow"

type Translation = (key: string, values?: Record<string, string | number>) => string

const DEFAULT_WORKSPACE_RELATIVE_PATH = "Deeting Wiki"

export function useLlmWiki(t: Translation) {
  const openWorkflow = useOpenWorkflow()
  const [desktopSupported, setDesktopSupported] = React.useState<boolean | null>(null)
  const [state, setState] = React.useState<LocalLlmWikiState | null>(null)
  const [vaultRoot, setVaultRoot] = React.useState("")
  const [workspaceRelativePath, setWorkspaceRelativePath] = React.useState(
    DEFAULT_WORKSPACE_RELATIVE_PATH,
  )
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAnalyzing, setIsAnalyzing] = React.useState(false)
  const [isBootstrapping, setIsBootstrapping] = React.useState(false)
  const [isSyncingAgent, setIsSyncingAgent] = React.useState(false)
  const [isSyncingCorpus, setIsSyncingCorpus] = React.useState(false)
  const [isSearchingCorpus, setIsSearchingCorpus] = React.useState(false)
  const [lastBootstrap, setLastBootstrap] =
    React.useState<BootstrapLocalLlmWikiWorkspaceResult | null>(null)
  const [corpusQuery, setCorpusQuery] = React.useState("")
  const [corpusHits, setCorpusHits] = React.useState<LocalLlmWikiCorpusSearchHit[]>([])
  const [selectedCorpusHitId, setSelectedCorpusHitId] = React.useState<string | null>(null)
  const [hasSearchedCorpus, setHasSearchedCorpus] = React.useState(false)
  const [corpusSearchError, setCorpusSearchError] = React.useState<string | null>(null)
  const [isUpdatingAutomationSettings, setIsUpdatingAutomationSettings] = React.useState(false)
  const [executingSuggestionId, setExecutingSuggestionId] = React.useState<string | null>(null)
  const [dismissingSuggestionId, setDismissingSuggestionId] = React.useState<string | null>(null)

  const clearCorpusInspector = React.useCallback(() => {
    setCorpusHits([])
    setSelectedCorpusHitId(null)
    setHasSearchedCorpus(false)
    setCorpusSearchError(null)
  }, [])

  const runCorpusSearch = React.useCallback(
    async (nextQuery: string) => {
      const query = nextQuery.trim()
      if (!query) {
        clearCorpusInspector()
        return
      }

      try {
        setIsSearchingCorpus(true)
        setHasSearchedCorpus(true)
        setCorpusSearchError(null)
        const result = await searchLocalLlmWikiCorpus({ query, limit: 6 })
        setCorpusHits(result.hits)
        setSelectedCorpusHitId(result.hits[0]?.assetId ?? null)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("toast.corpusSearchFailed")
        setCorpusHits([])
        setSelectedCorpusHitId(null)
        setCorpusSearchError(message)
        toast.error(message)
      } finally {
        setIsSearchingCorpus(false)
      }
    },
    [clearCorpusInspector, t],
  )

  const refresh = React.useCallback(async () => {
    if (!supportsLocalLlmWiki()) {
      setDesktopSupported(false)
      setIsLoading(false)
      return
    }

    setDesktopSupported(true)
    setIsLoading(true)
    try {
      const next = await getLocalLlmWikiState()
      setState(next)
      if (next.binding) {
        setVaultRoot(next.binding.vaultRoot)
        setWorkspaceRelativePath(next.binding.workspaceRelativePath)
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.loadFailed"),
      )
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const analyze = React.useCallback(async () => {
    try {
      setIsAnalyzing(true)
      const next = await saveLocalLlmWikiBinding({
        vaultRoot,
        workspaceRelativePath,
      })
      setState(next)
      setLastBootstrap(null)
      clearCorpusInspector()
      toast.success(t("toast.bindingSaved"))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.bindingSaveFailed"),
      )
    } finally {
      setIsAnalyzing(false)
    }
  }, [clearCorpusInspector, t, vaultRoot, workspaceRelativePath])

  const bootstrap = React.useCallback(async () => {
    try {
      setIsBootstrapping(true)
      const result = await bootstrapLocalLlmWikiWorkspace()
      setState(result.state)
      setLastBootstrap(result)
      toast.success(
        t("toast.workspaceBootstrapped", {
          files: result.createdFiles.length,
          directories: result.createdDirectories.length,
        }),
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.bootstrapFailed"),
      )
    } finally {
      setIsBootstrapping(false)
    }
  }, [t])

  const copyAgentPrompt = React.useCallback(async () => {
    const prompt = state?.recommendedAgentPrompt?.trim()
    if (!prompt) {
      toast.error(t("toast.noPrompt"))
      return
    }

    try {
      await navigator.clipboard.writeText(prompt)
      toast.success(t("toast.promptCopied"))
    } catch {
      toast.error(t("toast.promptCopyFailed"))
    }
  }, [state?.recommendedAgentPrompt, t])

  const syncMaintainerAgent = React.useCallback(async () => {
    try {
      setIsSyncingAgent(true)
      const result = await createOrUpdateLocalLlmWikiMaintainerAgent()
      setState(result.state)
      toast.success(
        result.state.maintainerAgent
          ? t("toast.maintainerAgentReady", {
              name: result.state.maintainerAgent.name,
            })
          : t("toast.maintainerAgentReady", { name: "Maintainer" }),
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("toast.maintainerAgentFailed"),
      )
    } finally {
      setIsSyncingAgent(false)
    }
  }, [t])

  const syncCorpus = React.useCallback(async () => {
    try {
      setIsSyncingCorpus(true)
      const result = await syncLocalLlmWikiCorpus()
      setState(result.state)
      toast.success(
        t("toast.corpusSynced", {
          indexed: result.indexedFiles,
          removed: result.removedFiles,
        }),
      )
      if (corpusQuery.trim()) {
        await runCorpusSearch(corpusQuery)
      } else {
        clearCorpusInspector()
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.corpusSyncFailed"),
      )
    } finally {
      setIsSyncingCorpus(false)
    }
  }, [clearCorpusInspector, corpusQuery, runCorpusSearch, t])

  const searchCorpus = React.useCallback(async () => {
    await runCorpusSearch(corpusQuery)
  }, [corpusQuery, runCorpusSearch])

  const setAutomationSetting = React.useCallback(
    async (
      key:
        | "autoSyncOnVaultBound"
        | "suggestMaintainerOnWorkspaceBootstrap"
        | "autoRefreshInspectorOnCorpusSync"
        | "createCrystallizationCandidatesOnSessionEnd"
        | "enableScheduleSuggestions"
        | "suggestOnValuableAnswer"
        | "autoDelegateNewSources"
        | "autoDelegateMaintenanceSchedule"
        | "promoteRepeatedStableConclusionsToMemory",
      value: boolean,
    ) => {
      try {
        setIsUpdatingAutomationSettings(true)
        const next = await updateLocalLlmWikiAutomationSettings({ [key]: value })
        setState(next)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("toast.automationSettingsFailed"),
        )
      } finally {
        setIsUpdatingAutomationSettings(false)
      }
    },
    [t],
  )

  const executeAutomationSuggestion = React.useCallback(
    async (suggestion: LocalLlmWikiAutomationSuggestion) => {
      try {
        setExecutingSuggestionId(suggestion.id)
        const result = await executeLocalLlmWikiAutomationSuggestion(suggestion.id)
        setState(result.state)
        if (result.workflowRunId) {
          openWorkflow({ runId: result.workflowRunId })
        }
        if (result.message) {
          toast.success(result.message)
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("toast.automationExecutionFailed"),
        )
      } finally {
        setExecutingSuggestionId(null)
      }
    },
    [openWorkflow, t],
  )

  const dismissAutomationSuggestion = React.useCallback(
    async (suggestionId: string) => {
      try {
        setDismissingSuggestionId(suggestionId)
        const next = await dismissLocalLlmWikiAutomationSuggestion(suggestionId)
        setState(next)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("toast.automationDismissFailed"),
        )
      } finally {
        setDismissingSuggestionId(null)
      }
    },
    [t],
  )

  const updateCorpusQuery = React.useCallback(
    (value: string) => {
      setCorpusQuery(value)
      setCorpusSearchError(null)
      if (!value.trim()) {
        clearCorpusInspector()
      }
    },
    [clearCorpusInspector],
  )

  const selectedCorpusHit =
    corpusHits.find((hit) => hit.assetId === selectedCorpusHitId) ?? null

  return {
    desktopSupported,
    state,
    vaultRoot,
    workspaceRelativePath,
    isLoading,
    isAnalyzing,
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
    automation: state?.automation ?? null,
    isUpdatingAutomationSettings,
    executingSuggestionId,
    dismissingSuggestionId,
    setVaultRoot,
    setWorkspaceRelativePath,
    setCorpusQuery: updateCorpusQuery,
    setSelectedCorpusHitId,
    refresh,
    analyze,
    bootstrap,
    copyAgentPrompt,
    syncMaintainerAgent,
    syncCorpus,
    searchCorpus,
    setAutomationSetting,
    executeAutomationSuggestion,
    dismissAutomationSuggestion,
  }
}
