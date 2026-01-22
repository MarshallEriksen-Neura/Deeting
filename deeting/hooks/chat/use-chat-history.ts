"use client"

import { useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSearchParams } from "next/navigation"
import { useChatStateStore, type Message } from "@/store/chat-state-store"
import { parseMessageContent } from "@/lib/chat/message-content"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"
import { useI18n } from "@/hooks/use-i18n"

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
  const t = useI18n("chat")
  const searchParams = useSearchParams()
  const [historyLoaded, setHistoryLoaded] = useState(false)
  
  const { setMessages } = useChatStateStore()

  const sessionStorageKey = `deeting-chat-session:${agentId}`

  const createGreeting = useCallback((): Message => ({
    id: 'init',
    role: 'assistant',
    content: t("greeting.content", {
      name: agent?.name || "",
      desc: agent?.desc || "",
    }),
    createdAt: Date.now()
  }), [agent?.name, agent?.desc, t])

  const loadCloudHistory = useCallback(async () => {
    if (!loadHistory || historyLoaded) return

    try {
      const querySessionId = searchParams?.get("session")?.trim() || null
      const storedSessionId =
        querySessionId ??
        (typeof window !== "undefined" ? localStorage.getItem(sessionStorageKey) : null)

      if (storedSessionId) {
        if (querySessionId && typeof window !== "undefined") {
          localStorage.setItem(sessionStorageKey, storedSessionId)
        }

        const windowState = await loadHistory(storedSessionId)
        const mapped = normalizeConversationMessages(windowState.messages || [], {
          idPrefix: storedSessionId ?? undefined,
        })

        if (mapped.length > 0) {
          setMessages(mapped)
          setHistoryLoaded(true)
          return
        }
      }

      setMessages([createGreeting()])
      setHistoryLoaded(true)
    } catch {
      setMessages([createGreeting()])
      setHistoryLoaded(true)
    }
  }, [
    loadHistory,
    historyLoaded,
    searchParams,
    sessionStorageKey,
    setMessages,
    createGreeting
  ])

  const loadLocalHistory = useCallback(async () => {
    if (!agent || historyLoaded) return

    try {
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
        setHistoryLoaded(true)
        return
      }

      const greeting = createGreeting()
      setMessages([greeting])
      
      try {
        await invoke("append_assistant_message", {
          assistant_id: agent.id,
          role: "assistant",
          content: greeting.content
        })
      } catch {
        // ignore persist errors
      }
      
      setHistoryLoaded(true)
    } catch {
      setMessages([createGreeting()])
      setHistoryLoaded(true)
    }
  }, [agent, historyLoaded, setMessages, createGreeting])

  const resetHistory = useCallback(() => {
    setHistoryLoaded(false)
    setMessages([])
  }, [setMessages])

  useEffect(() => {
    if (!agent) return

    if (isTauriRuntime) {
      loadLocalHistory()
    } else {
      loadCloudHistory()
    }
  }, [agent, isTauriRuntime, loadLocalHistory, loadCloudHistory])

  // Ensure history is loaded on mount if not already loaded
  useEffect(() => {
    if (!agent || historyLoaded) return

    if (isTauriRuntime) {
      loadLocalHistory()
    } else {
      loadCloudHistory()
    }
  }, [agent, historyLoaded, isTauriRuntime, loadCloudHistory, loadLocalHistory])

  return {
    historyLoaded,
    resetHistory,
  }
}
