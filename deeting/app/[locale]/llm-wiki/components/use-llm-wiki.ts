"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  bootstrapLocalLlmWikiWorkspace,
  confirmLocalLlmWikiAdoption,
  createOrUpdateLocalLlmWikiMaintainerAgent,
  dismissLocalLlmWikiAutomationSuggestion,
  executeLocalLlmWikiAutomationSuggestion,
  getLocalLlmWikiState,
  ingestLocalLlmWikiSelection,
  previewLocalLlmWikiAdoption,
  runLocalLlmWikiLint,
  saveLocalLlmWikiBinding,
  reconcileLocalLlmWikiCorpus,
  searchLocalLlmWikiCorpus,
  supportsLocalLlmWiki,
  updateLocalLlmWikiAutomationSettings,
  type IngestLocalLlmWikiSelectionResult,
  type LocalLlmWikiAdoptionPreview,
  type LocalLlmWikiAutomationSuggestion,
  type LocalLlmWikiLintReport,
  type BootstrapLocalLlmWikiWorkspaceResult,
  type LocalLlmWikiCorpusSearchHit,
  type LocalLlmWikiState,
} from "@/lib/api/llm-wiki"
import { useOpenWorkflow } from "@/hooks/use-open-workflow"
import { saveLlmWikiTaskAgentHandoff } from "@/lib/llm-wiki-handoff"

type Translation = (key: string, values?: Record<string, string | number>) => string

const DEFAULT_WORKSPACE_RELATIVE_PATH = "Deeting Wiki"
const MODE_MANAGED_WORKSPACE = "managed_workspace"
const MODE_ADOPT_EXISTING_FOLDER = "adopt_existing_folder"

export function useLlmWiki(t: Translation) {
  const openWorkflow = useOpenWorkflow()
  const router = useRouter()
  const [desktopSupported, setDesktopSupported] = React.useState<boolean | null>(null)
  const [state, setState] = React.useState<LocalLlmWikiState | null>(null)
  const [vaultRoot, setVaultRoot] = React.useState("")
  const [workspaceRelativePath, setWorkspaceRelativePath] = React.useState(
    DEFAULT_WORKSPACE_RELATIVE_PATH,
  )
  const [bindingMode, setBindingMode] = React.useState(MODE_MANAGED_WORKSPACE)
  const [adoptFolderRelativePath, setAdoptFolderRelativePath] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAnalyzing, setIsAnalyzing] = React.useState(false)
  const [isPreviewingAdoption, setIsPreviewingAdoption] = React.useState(false)
  const [isConfirmingAdoption, setIsConfirmingAdoption] = React.useState(false)
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
  const [adoptionPreview, setAdoptionPreview] =
    React.useState<LocalLlmWikiAdoptionPreview | null>(null)
  const [ingestSelectionInput, setIngestSelectionInput] = React.useState("")
  const [isIngestingSelection, setIsIngestingSelection] = React.useState(false)
  const [lastIngestResult, setLastIngestResult] =
    React.useState<IngestLocalLlmWikiSelectionResult | null>(null)
  const [isRunningLint, setIsRunningLint] = React.useState(false)
  const [isUpdatingAutomationSettings, setIsUpdatingAutomationSettings] = React.useState(false)
  const [executingSuggestionId, setExecutingSuggestionId] = React.useState<string | null>(null)
  const [dismissingSuggestionId, setDismissingSuggestionId] = React.useState<string | null>(null)
  const [batchDismissingActionKind, setBatchDismissingActionKind] = React.useState<string | null>(null)

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
        setBindingMode(next.binding.mode ?? MODE_MANAGED_WORKSPACE)
        setAdoptFolderRelativePath(next.binding.adoptedFolderRelativePath ?? "")
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

  React.useEffect(() => {
    setAdoptionPreview(null)
  }, [adoptFolderRelativePath, bindingMode])

  const analyze = React.useCallback(async () => {
    if (bindingMode === MODE_ADOPT_EXISTING_FOLDER) {
      try {
        setIsPreviewingAdoption(true)
        const preview = await previewLocalLlmWikiAdoption({
          vaultRoot,
          folderRelativePath: adoptFolderRelativePath,
        })
        setAdoptionPreview(preview)
        toast.success(preview.summaryMessage)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("toast.adoptionPreviewFailed"),
        )
      } finally {
        setIsPreviewingAdoption(false)
      }
      return
    }

    try {
      setIsAnalyzing(true)
      const next = await saveLocalLlmWikiBinding({
        vaultRoot,
        workspaceRelativePath,
        mode: bindingMode,
      })
      setState(next)
      setLastBootstrap(null)
      clearCorpusInspector()
      setAdoptionPreview(null)
      toast.success(t("toast.bindingSaved"))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.bindingSaveFailed"),
      )
    } finally {
      setIsAnalyzing(false)
    }
  }, [
    adoptFolderRelativePath,
    bindingMode,
    clearCorpusInspector,
    t,
    vaultRoot,
    workspaceRelativePath,
  ])

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

  const confirmAdoption = React.useCallback(async () => {
    try {
      setIsConfirmingAdoption(true)
      const next = await confirmLocalLlmWikiAdoption({
        vaultRoot,
        folderRelativePath: adoptFolderRelativePath,
      })
      setState(next)
      setLastBootstrap(null)
      clearCorpusInspector()
      toast.success(t("toast.adoptionConfirmed"))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.adoptionConfirmFailed"),
      )
    } finally {
      setIsConfirmingAdoption(false)
    }
  }, [adoptFolderRelativePath, clearCorpusInspector, t, vaultRoot])

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
      const result = await reconcileLocalLlmWikiCorpus()
      setState(result.state)
      toast.success(
        t("toast.corpusReconciled", {
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
        error instanceof Error ? error.message : t("toast.corpusReconcileFailed"),
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

  const dismissBatchAutomationSuggestions = React.useCallback(
    async (actionKind: string, suggestionIds: string[]) => {
      if (suggestionIds.length === 0) return
      try {
        setBatchDismissingActionKind(actionKind)
        for (const id of suggestionIds) {
          const next = await dismissLocalLlmWikiAutomationSuggestion(id)
          setState(next)
        }
        toast.success(
          t("toast.batchDismissCompleted", { count: suggestionIds.length }),
        )
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("toast.automationDismissFailed"),
        )
      } finally {
        setBatchDismissingActionKind(null)
      }
    },
    [t],
  )

  const openTaskAgentHandoff = React.useCallback(() => {
    const maintainer = state?.maintainerAgent
    if (maintainer?.agentId) {
      router.push(`/agents/task-agents?handoff=llm-wiki&agentId=${encodeURIComponent(maintainer.agentId)}`)
      return
    }

    const binding = state?.binding
    saveLlmWikiTaskAgentHandoff({
      mode: "create",
      name: binding ? `${binding.vaultName} Wiki Maintainer` : "Wiki Maintainer",
      description: binding
        ? `Maintains the Deeting-managed LLM Wiki workspace at ${binding.workspaceRelativePath}`
        : "Maintains the Deeting-managed LLM Wiki workspace",
      taskPrompt: state?.recommendedAgentPrompt ?? "",
      sourceKind: "llm_wiki_maintainer",
      sourcePath: state?.workspaceStatus?.resolvedWorkspacePath ?? "",
      tags: ["llm-wiki", "obsidian", "maintainer"],
    })
    router.push("/agents/task-agents?handoff=llm-wiki")
  }, [router, state])

  const ingestSelection = React.useCallback(async () => {
    const selectedRelativePaths = ingestSelectionInput
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (selectedRelativePaths.length === 0) {
      toast.error(t("toast.ingestSelectionEmpty"))
      return
    }

    try {
      setIsIngestingSelection(true)
      const result = await ingestLocalLlmWikiSelection({ selectedRelativePaths })
      setState(result.state)
      setLastIngestResult(result)
      toast.success(
        t("toast.ingestCompleted", {
          ingested: result.ingestedPaths.length,
          copied: result.rawFilesCopied.length,
        }),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.ingestFailed"))
    } finally {
      setIsIngestingSelection(false)
    }
  }, [ingestSelectionInput, t])

  const runLint = React.useCallback(async () => {
    try {
      setIsRunningLint(true)
      const report: LocalLlmWikiLintReport = await runLocalLlmWikiLint()
      setState((current) => (current ? { ...current, lastLintReport: report } : current))
      toast.success(
        t("toast.lintCompleted", {
          count: report.findingCount,
        }),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.lintFailed"))
    } finally {
      setIsRunningLint(false)
    }
  }, [t])

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
    automation: state?.automation ?? null,
    lastLintReport: state?.lastLintReport ?? null,
    isUpdatingAutomationSettings,
    executingSuggestionId,
    dismissingSuggestionId,
    batchDismissingActionKind,
    setVaultRoot,
    setWorkspaceRelativePath,
    setBindingMode,
    setAdoptFolderRelativePath,
    setCorpusQuery: updateCorpusQuery,
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
    dismissBatchAutomationSuggestions,
    openTaskAgentHandoff,
    ingestSelection,
    runLint,
  }
}
