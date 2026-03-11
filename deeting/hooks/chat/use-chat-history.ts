"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSearchParams } from "next/navigation"
import { useChatStore } from "@/store/chat-store"
import { parseMessageContent } from "@/lib/chat/message-content"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"

interface LocalCapabilityMessageRecord {
  id: string
  assistant_id: string
  role: string
  content: string
  created_at: string
}

interface UseChatHistoryProps {
  selectedAssistantId: string
  selectedAssistant?: { id: string; name: string; desc?: string }
  isTauriRuntime: boolean
  loadHistory?: (sessionId: string) => Promise<any>
}

export function useChatHistory({
  selectedAssistantId: _selectedAssistantId,
  selectedAssistant,
  isTauriRuntime,
  loadHistory,
}: UseChatHistoryProps) {
  const searchParams = useSearchParams()
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const isLoadingRef = useRef(false)

  const { setMessages, setSessionId } = useChatStore()

  const setHistoryState = useCallback((state: { cursor?: number | null; hasMore?: boolean; loading?: boolean }) => {
    useChatStore.setState({
      ...(state.cursor !== undefined && { historyCursor: state.cursor }),
      ...(state.hasMore !== undefined && { historyHasMore: state.hasMore }),
      ...(state.loading !== undefined && { isLoading: state.loading }),
    })
  }, [])


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
      const storedSessionId = querySessionId

      if (storedSessionId) {
        setSessionId(storedSessionId)

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
    setMessages,
    setSessionId,
    setHistoryState,
  ])

  const loadLocalHistory = useCallback(async () => {
    // 使用 ref 防止并发调用
    if (!selectedAssistant || isLoadingRef.current) return
    isLoadingRef.current = true

    try {
      setHistoryState({ loading: true })
      const records = await invoke<LocalCapabilityMessageRecord[]>(
        "list_assistant_messages",
        { assistant_id: selectedAssistant.id }
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
              createdAt: Number.isNaN(parsed) ? Date.now() : parsed,
              fromHistory: true,
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
  }, [selectedAssistant, setMessages, setHistoryState])

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
    if (isTauriRuntime && !selectedAssistant) return

    if (isTauriRuntime) {
      loadLocalHistory()
    } else {
      loadCloudHistory()
    }
  }, [selectedAssistant, historyLoaded, isTauriRuntime, loadLocalHistory, loadCloudHistory])

  return {
    historyLoaded,
    resetHistory,
  }
}
