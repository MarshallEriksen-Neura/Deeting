"use client"

import { useMemo } from "react"
import useSWR from "swr"

import { fetchChatModels, type ModelInfo, type ModelGroup } from "@/lib/api/models"
import { isTauriRuntime } from "@/lib/runtime/tauri"
import { useAuthStore } from "@/store/auth-store"

const MODELS_QUERY_KEY = "/api/v1/internal/models"
const MODEL_LIST_DEDUPING_INTERVAL_MS = 60_000

export function useChatModels({
  enabled = true,
  modelCapability,
}: {
  enabled?: boolean
  modelCapability?: string
}) {
  const { isAuthenticated } = useAuthStore()
  const isEnabled = enabled && (isTauriRuntime() || isAuthenticated)

  const modelQueryKey = isEnabled
    ? [MODELS_QUERY_KEY, modelCapability ?? "all"]
    : null

  const { data: modelList, isLoading: isLoadingModels } = useSWR(
    modelQueryKey,
    () => fetchChatModels(modelCapability ? { capability: modelCapability } : undefined),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: MODEL_LIST_DEDUPING_INTERVAL_MS,
    },
  )

  const modelGroups = useMemo<ModelGroup[]>(() => {
    return (modelList?.instances ?? []).filter((group) => group.models.length > 0)
  }, [modelList])

  const models = useMemo<ModelInfo[]>(() => {
    if (modelGroups.length === 0) return []
    return modelGroups.flatMap((group) => group.models)
  }, [modelGroups])

  return {
    models,
    modelGroups,
    isLoadingModels,
  }
}
