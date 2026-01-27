"use client"

import * as React from "react"
import { invoke } from "@tauri-apps/api/core"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useChatService } from "@/hooks/use-chat-service"
import { useMarketStore } from "@/store/market-store"
import { useChatStore, type ChatAssistant } from "@/store/chat-store"
import { parseMessageContent } from "@/lib/chat/message-content"

interface ChatControllerProps {
  agentId: string
}

interface LocalAssistantMessageRecord {
  id: string
  assistant_id: string
  role: string
  content: string
  created_at: string
}

/**
 * ChatController - 聊天控制器组件（无UI）
 * 
 * 功能：
 * - 管理聊天会话状态
 * - 同步云端和本地助手数据
 * - 加载历史消息
 * - 处理 Tauri 桌面端和 Web 端的差异
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useCallback 缓存事件处理函数
 * - 使用 useMemo 缓存计算值
 */
function ChatController({ agentId }: ChatControllerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Stores
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants)
  const marketLoaded = useMarketStore((state) => state.loaded)
  
  const {
    input,
    config,
    activeAssistantId,
    sessionId,
    isLoading,
    streamEnabled,
    setInput,
    setModels,
    setActiveAssistantId,
    setSessionId,
    setStreamEnabled,
    setErrorMessage,
    setMessages,
    loadHistoryBySession,
    sendMessage: storeSendMessage,
    setConfig,
    setAssistants
  } = useChatStore()

  // Environment check (runtime-safe for browser dev)
  const isTauriRuntime = React.useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  )

  // Service hook for Cloud
  const {
    assistant: cloudAssistant,
    models: cloudModels,
    modelGroups: cloudModelGroups,
    isLoadingAssistants
  } = useChatService({ assistantId: agentId, enabled: !isTauriRuntime })

  // Derived state - 缓存计算值
  const localAgent = React.useMemo(
    () => installedAgents.find(a => a.id === agentId),
    [installedAgents, agentId]
  )
  
  // Combine cloud/local agent
  const agent = React.useMemo(() => {
    if (isTauriRuntime) return localAgent
    return cloudAssistant
  }, [isTauriRuntime, localAgent, cloudAssistant])

  // Sync assistants to store (optional, but good for consistency)
  React.useEffect(() => {
    if (agent) {
        setAssistants([agent as ChatAssistant])
    }
  }, [agent, setAssistants])

  const [historyLoaded, setHistoryLoaded] = React.useState(false)

  // Initialization & Sync
  React.useEffect(() => {
    if (!agentId) return
    const storeState = useChatStore.getState()
    const shouldPreserve =
      storeState.activeAssistantId === agentId &&
      (storeState.messages.length > 0 || storeState.isLoading)
    setActiveAssistantId(agentId)
    setHistoryLoaded(false)
    setErrorMessage(null)
    if (!shouldPreserve) {
      setMessages([])
      setInput("")
    }
  }, [agentId, setActiveAssistantId, setErrorMessage, setMessages, setInput])

  // Sync Stream Enabled from LocalStorage
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const stored = localStorage.getItem("deeting-chat-stream")
    if (stored !== null) {
      setStreamEnabled(stored === "true")
    }
  }, [setStreamEnabled])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem("deeting-chat-stream", String(streamEnabled))
  }, [streamEnabled])

  // Sync Models
  React.useEffect(() => {
    setModels(cloudModels)
    if (cloudModels.length === 0) return
    const hasSelectedModel = config.model
      ? cloudModels.some((model) => model.id === config.model || model.provider_model_id === config.model)
      : false
    if (!hasSelectedModel && cloudModels[0]) {
      setConfig({ model: cloudModels[0].provider_model_id ?? cloudModels[0].id })
    }
  }, [cloudModels, setModels, config.model, setConfig])

  // Session Management - 缓存 session storage key
  const sessionStorageKey = React.useMemo(
    () => `deeting-chat-session:${agentId}`,
    [agentId]
  )

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!sessionId) return
    localStorage.setItem(sessionStorageKey, sessionId)
  }, [sessionId, sessionStorageKey])

  React.useEffect(() => {
    if (!agentId || !sessionId) return
    if (pathname?.includes("/chat/create/assistant")) return
    if (typeof window === "undefined") return
    if (isLoading) return
    const params = new URLSearchParams(searchParams?.toString())
    params.set("session", sessionId)
    params.delete("agentId")
    const nextPath = `/chat/${agentId}`
    const query = params.toString()
    const nextUrl = query ? `${nextPath}?${query}` : nextPath
    const currentQuery = searchParams?.toString()
    const currentUrl = currentQuery ? `${pathname}?${currentQuery}` : pathname ?? ""
    if (nextUrl === currentUrl) return
    window.history.replaceState(null, "", nextUrl)
  }, [agentId, pathname, searchParams, sessionId, isLoading])

  React.useEffect(() => {
    if (isTauriRuntime && !agent) return

    if (!isTauriRuntime) {
      if (historyLoaded) return
      const storeState = useChatStore.getState()
      if (storeState.messages.length > 0 || storeState.isLoading) {
        setHistoryLoaded(true)
        return
      }
      let cancelled = false
      const loadRemoteHistory = async () => {
        try {
          const querySessionId = searchParams?.get("session")?.trim() || null
          const storedSessionId =
            querySessionId ??
            (typeof window !== "undefined" ? localStorage.getItem(sessionStorageKey) : null)
          if (storedSessionId) {
            setSessionId(storedSessionId)
            if (querySessionId && typeof window !== "undefined") {
              localStorage.setItem(sessionStorageKey, storedSessionId)
            }
            await loadHistoryBySession(storedSessionId)
            if (cancelled) return
            if (useChatStore.getState().messages.length > 0) {
              setHistoryLoaded(true)
              return
            }
          }
          setMessages([])
          setHistoryLoaded(true)
        } catch {
          if (!cancelled) {
            setMessages([])
            setHistoryLoaded(true)
          }
        }
      }

      void loadRemoteHistory()
      return () => { cancelled = true }
    }

    // Tauri Local History
    if (historyLoaded) return
    let cancelled = false

    const loadLocalHistory = async () => {
      try {
        const records = await invoke<LocalAssistantMessageRecord[]>(
          "list_assistant_messages",
          { assistant_id: agent.id }
        )
        if (cancelled) return

        if (records.length > 0) {
          setMessages(
            records.map((record) => {
              const parsed = Date.parse(record.created_at)
              const parsedContent = parseMessageContent(record.content)
              return {
                id: record.id,
                role: (record.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: parsedContent.text,
                attachments: parsedContent.attachments.length ? parsedContent.attachments : undefined,
                createdAt: Number.isNaN(parsed) ? Date.now() : parsed
              }
            })
          )
          setHistoryLoaded(true)
          return
        }

        setMessages([])
        if (!cancelled) setHistoryLoaded(true)
      } catch (error) {
        if (!cancelled) {
          setMessages([])
          setHistoryLoaded(true)
        }
      }
    }

    void loadLocalHistory()
    return () => { cancelled = true }
  }, [
    agent,
    historyLoaded,
    isTauriRuntime,
    loadHistoryBySession,
    searchParams,
    sessionStorageKey,
    setSessionId,
    setMessages,
    agentId,
  ])

  // Tauri Agent Loading
  React.useEffect(() => {
    if (!isTauriRuntime) return
    if (marketLoaded) return
    void loadLocalAssistants()
  }, [marketLoaded, loadLocalAssistants, isTauriRuntime])

  // Routing checks
  React.useEffect(() => {
    if (pathname?.includes("/chat/create/assistant")) return
    if (isTauriRuntime) {
      if (!marketLoaded) return
      // 桌面端仍保持兜底回到选择页
      if (!agent && agentId) router.replace("/chat")
      return
    }
    // Web 端不强制重定向
  }, [agent, marketLoaded, router, isTauriRuntime, isLoadingAssistants, pathname, agentId])

  return null
}

// 使用 React.memo 优化，避免不必要的重渲染
export const ChatControllerMemo = React.memo(ChatController)
