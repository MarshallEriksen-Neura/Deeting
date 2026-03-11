"use client"

import { useCallback } from "react"
import { useChatStore } from "@/store/chat-store"

interface UseChatSessionProps {
  selectedAssistantId: string
}

export function useChatSession({ selectedAssistantId: _selectedAssistantId }: UseChatSessionProps) {
  const { sessionId, setSessionId, resetSession, setMessages, clearAttachments } = useChatStore()

  const handleNewChat = useCallback(() => {
    resetSession()
    setMessages([])
    clearAttachments()
  }, [resetSession, setMessages, clearAttachments])

  const loadStoredSession = useCallback(() => {
    return null
  }, [])

  return {
    sessionId,
    setSessionId,
    handleNewChat,
    loadStoredSession,
  }
}
