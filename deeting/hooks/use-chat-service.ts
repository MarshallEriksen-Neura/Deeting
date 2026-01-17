"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"

import {
  fetchAssistantInstalls,
  type AssistantInstallItem,
} from "@/lib/api/assistants"
import { fetchAvailableModels, fetchChatModels, type ModelInfo } from "@/lib/api/models"
import { fetchConversationWindow } from "@/lib/api/conversations"
import { useAuthStore } from "@/store/auth-store"

const INSTALLS_QUERY_KEY = "/api/v1/assistants/installs"
const MODELS_QUERY_KEY = "/api/v1/internal/models"
const AVAILABLE_MODELS_QUERY_KEY = "/api/v1/models/available"

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
  }
}

export function useChatService({
  assistantId,
  enabled = true,
  installSize = 100,
}: {
  assistantId?: string
  enabled?: boolean
  installSize?: number
}) {
  const { isAuthenticated } = useAuthStore()
  const isEnabled = enabled && isAuthenticated
  const shouldFetch = isEnabled ? [INSTALLS_QUERY_KEY, { size: installSize }] : null

  const {
    data: installPage,
    isLoading: isLoadingAssistants,
  } = useSWR(shouldFetch, () => fetchAssistantInstalls({ size: installSize }))

  const {
    data: modelList,
    isLoading: isLoadingAllModels,
  } = useSWR(isEnabled ? MODELS_QUERY_KEY : null, fetchChatModels)

  const {
    data: availableModels,
    isLoading: isLoadingAvailableModels,
  } = useSWR(isEnabled ? AVAILABLE_MODELS_QUERY_KEY : null, fetchAvailableModels)

  const assistant = useMemo(() => {
    if (!assistantId || !installPage?.items?.length) return null
    const found = installPage.items.find((item) => item.assistant_id === assistantId)
    return found ? mapInstallToAssistant(found) : null
  }, [assistantId, installPage])

  const assistants = useMemo<ChatAssistant[]>(() => {
    if (!installPage?.items?.length) return []
    return installPage.items.map(mapInstallToAssistant)
  }, [installPage])

  const models = useMemo<ModelInfo[]>(() => {
    const all = modelList?.data ?? []
    if (!availableModels?.items) return []
    if (availableModels.items.length === 0) return []
    const allowed = new Set(availableModels.items)
    return all.filter((model) => allowed.has(model.id))
  }, [availableModels, modelList])

  const isLoadingModels = isLoadingAllModels || isLoadingAvailableModels

  const loadHistory = useCallback(async (sessionId: string) => {
    return fetchConversationWindow(sessionId)
  }, [])

  return {
    assistant,
    assistants,
    models,
    isLoadingAssistants,
    isLoadingModels,
    loadHistory,
  }
}
