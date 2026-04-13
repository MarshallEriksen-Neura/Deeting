"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  bootstrapLocalLlmWikiWorkspace,
  createOrUpdateLocalLlmWikiMaintainerAgent,
  getLocalLlmWikiState,
  saveLocalLlmWikiBinding,
  searchLocalLlmWikiCorpus,
  syncLocalLlmWikiCorpus,
  supportsLocalLlmWiki,
  type BootstrapLocalLlmWikiWorkspaceResult,
  type LocalLlmWikiCorpusSearchHit,
  type LocalLlmWikiState,
} from "@/lib/api/llm-wiki"

type Translation = (key: string, values?: Record<string, string | number>) => string

const DEFAULT_WORKSPACE_RELATIVE_PATH = "Deeting Wiki"

export function useLlmWiki(t: Translation) {
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
      toast.success(t("toast.bindingSaved"))
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.bindingSaveFailed"),
      )
    } finally {
      setIsAnalyzing(false)
    }
  }, [t, vaultRoot, workspaceRelativePath])

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
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.corpusSyncFailed"),
      )
    } finally {
      setIsSyncingCorpus(false)
    }
  }, [t])

  const searchCorpus = React.useCallback(async () => {
    const query = corpusQuery.trim()
    if (!query) {
      setCorpusHits([])
      setSelectedCorpusHitId(null)
      return
    }

    try {
      setIsSearchingCorpus(true)
      const result = await searchLocalLlmWikiCorpus({ query, limit: 6 })
      setCorpusHits(result.hits)
      setSelectedCorpusHitId(result.hits[0]?.assetId ?? null)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("toast.corpusSearchFailed"),
      )
    } finally {
      setIsSearchingCorpus(false)
    }
  }, [corpusQuery, t])

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
    setVaultRoot,
    setWorkspaceRelativePath,
    setCorpusQuery,
    setSelectedCorpusHitId,
    refresh,
    analyze,
    bootstrap,
    copyAgentPrompt,
    syncMaintainerAgent,
    syncCorpus,
    searchCorpus,
  }
}
