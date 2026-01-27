"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"

import {
  fetchAssistantInstalls,
  type AssistantInstallItem,
  type AssistantInstallPage,
} from "@/lib/api/assistants"
import { fetchChatModels, type ModelInfo, type ModelGroup } from "@/lib/api/models"
import { fetchConversationHistory } from "@/lib/api/conversations"
import { useAuthStore } from "@/store/auth-store"

const INSTALLS_QUERY_KEY = "/api/v1/assistants/installs"
const MODELS_QUERY_KEY = "/api/v1/internal/models"

const COLOR_PRESETS = [
  "from-indigo-500 to-purple-500",
  "from-sky-500 to-cyan-500",
  "from-emerald-500 to-green-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-fuchsia-500 to-purple-500",
]

const hashToIndex = (value: string, modulo: number) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % modulo
  }
  return hash
}

export type ChatAssistant = {
  id: string
  name: string
  desc: string
  color: string
  systemPrompt?: string
  ownerUserId?: string | null
}

function mapInstallToAssistant(item: AssistantInstallItem): ChatAssistant {
  const color = COLOR_PRESETS[hashToIndex(item.assistant_id, COLOR_PRESETS.length)]
  const version = item.assistant.version
  return {
    id: item.assistant_id,
    name: version?.name || "Assistant",
    desc: version?.description || item.assistant.summary || "",
    color,
    systemPrompt: version?.system_prompt ?? undefined,
    ownerUserId: item.assistant.owner_user_id,
  }
}

export function useChatService({
  assistantId,
  enabled = true,
  installSize = 100,
  modelCapability,
}: {
  assistantId?: string
  enabled?: boolean
  installSize?: number
  modelCapability?: string
}) {
  const { isAuthenticated } = useAuthStore()
  const isEnabled = enabled && isAuthenticated
  const shouldFetch = isEnabled ? [INSTALLS_QUERY_KEY, { size: installSize }] : null

  const {
    data: installPage,
    isLoading: isLoadingAssistants,
    mutate: mutateInstalls,
  } = useSWR<AssistantInstallPage>(shouldFetch, () => fetchAssistantInstalls({ size: installSize }))

  const modelQueryKey = isEnabled
    ? [MODELS_QUERY_KEY, modelCapability ?? "all"]
    : null

  const {
    data: modelList,
    isLoading: isLoadingAllModels,
  } = useSWR(modelQueryKey, () =>
    fetchChatModels(modelCapability ? { capability: modelCapability } : undefined)
  )

  const assistant = useMemo(() => {
    if (!assistantId || !installPage?.items?.length) return null
    const found = installPage.items.find((item) => item.assistant_id === assistantId)
    return found ? mapInstallToAssistant(found) : null
  }, [assistantId, installPage])

  const assistants = useMemo<ChatAssistant[]>(() => {
    if (!installPage?.items?.length) return []
    return installPage.items.map(mapInstallToAssistant)
  }, [installPage])

  const removeAssistantOptimistic = useCallback(
    (assistantId: string) => {
      if (!assistantId || !isEnabled) return
      void mutateInstalls(
        (current) => {
          if (!current?.items?.length) return current
          return {
            ...current,
            items: current.items.filter((item) => item.assistant_id !== assistantId),
          }
        },
        { revalidate: false }
      )
    },
    [isEnabled, mutateInstalls]
  )

  const modelGroups = useMemo<ModelGroup[]>(() => {
    return (modelList?.instances ?? []).filter((group) => group.models.length > 0)
  }, [modelList])

  const models = useMemo<ModelInfo[]>(() => {
    if (modelGroups.length === 0) return []
    return modelGroups.flatMap((group) => group.models)
  }, [modelGroups])

  const isLoadingModels = isLoadingAllModels

  const loadHistory = useCallback(async (sessionId: string) => {
    return fetchConversationHistory(sessionId, { limit: 30 })
  }, [])

  return {
    assistant,
    assistants,
    models,
    modelGroups,
    isLoadingAssistants,
    isLoadingModels,
    loadHistory,
    removeAssistantOptimistic,
  }
}
