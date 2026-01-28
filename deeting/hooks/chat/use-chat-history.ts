"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSearchParams } from "next/navigation"
import { useChatStateStore } from "@/store/chat-state-store"
import { useChatSessionStore } from "@/store/chat-session-store"
import { parseMessageContent } from "@/lib/chat/message-content"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"

interface LocalAssistantMessageRecord {
  id: string
  assistant_id: string
  role: string
  content: string
  created_at: string
}

interface UseChatHistoryProps {
  agentId: string
  agent?: { id: string; name: string; desc?: string }
  isTauriRuntime: boolean
  loadHistory?: (sessionId: string) => Promise<any>
}

export function useChatHistory({
  agentId,
  agent,
  isTauriRuntime,
  loadHistory,
}: UseChatHistoryProps) {
  const searchParams = useSearchParams()
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const isLoadingRef = useRef(false)

  const { setMessages } = useChatStateStore()
  const { setSessionId, setHistoryState } = useChatSessionStore()

  const sessionStorageKey = `deeting-chat-session:${agentId}`

  // 稳定化 sessionId 获取，避免 searchParams 引用变化导致重复加载
  const querySessionIdRef = useRef<string | null>(null)
  if (searchParams) {
    querySessionIdRef.current = searchParams.get("session")?.trim() || null
  }

  const loadCloudHistory = useCallback(async () => {
    // 使用 ref 防止并发调用
    if (!loadHistory || isLoadingRef.current) return
    isLoadingRef.current = true

    try {
      setHistoryState({ loading: true })
      const querySessionId = querySessionIdRef.current
      const storedSessionId =
        querySessionId ??
        (typeof window !== "undefined" ? localStorage.getItem(sessionStorageKey) : null)

      if (storedSessionId) {
        setSessionId(storedSessionId)
        if (querySessionId && typeof window !== "undefined") {
          localStorage.setItem(sessionStorageKey, storedSessionId)
        }

        const windowState = await loadHistory(storedSessionId)
        const mapped = normalizeConversationMessages(windowState.messages || [], {
          idPrefix: storedSessionId ?? undefined,
        })

        if (mapped.length > 0) {
          setMessages(mapped)
          setHistoryState({
            cursor: windowState.next_cursor ?? null,
            hasMore: Boolean(windowState.has_more),
          })
          setHistoryLoaded(true)
          return
        }
      }

      setMessages([])
      setHistoryState({ cursor: null, hasMore: false })
      setHistoryLoaded(true)
    } catch {
      setMessages([])
      setHistoryState({ cursor: null, hasMore: false })
      setHistoryLoaded(true)
    } finally {
      setHistoryState({ loading: false })
      isLoadingRef.current = false
    }
  }, [
    loadHistory,
    sessionStorageKey,
    setMessages,
    setSessionId,
    setHistoryState,
  ])

  const loadLocalHistory = useCallback(async () => {
    // 使用 ref 防止并发调用
    if (!agent || isLoadingRef.current) return
    isLoadingRef.current = true

    try {
      setHistoryState({ loading: true })
      const records = await invoke<LocalAssistantMessageRecord[]>(
        "list_assistant_messages",
        { assistant_id: agent.id }
      )

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
        setHistoryState({ cursor: null, hasMore: false })
        setHistoryLoaded(true)
        return
      }

      setMessages([])
      setHistoryState({ cursor: null, hasMore: false })
      setHistoryLoaded(true)
    } catch {
      setMessages([])
      setHistoryState({ cursor: null, hasMore: false })
      setHistoryLoaded(true)
    } finally {
      setHistoryState({ loading: false })
      isLoadingRef.current = false
    }
  }, [agent, setMessages, setHistoryState])

  const resetHistory = useCallback(() => {
    setHistoryLoaded(false)
    isLoadingRef.current = false
    setMessages([])
  }, [setMessages])

  // 单一 effect 处理历史加载，避免重复调用
  useEffect(() => {
    // 如果已加载或正在加载，跳过
    if (historyLoaded || isLoadingRef.current) return

    // Tauri 运行时需要等待 agent 加载
    if (isTauriRuntime && !agent) return

    if (isTauriRuntime) {
      loadLocalHistory()
    } else {
      loadCloudHistory()
    }
  }, [agent, historyLoaded, isTauriRuntime, loadLocalHistory, loadCloudHistory])

  return {
    historyLoaded,
    resetHistory,
  }
}
