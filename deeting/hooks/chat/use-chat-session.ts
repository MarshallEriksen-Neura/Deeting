"use client"

import { useCallback } from "react"
import { useChatStore } from "@/store/chat-store"

interface UseChatSessionProps {
  agentId: string
}

export function useChatSession({ agentId: _agentId }: UseChatSessionProps) {
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
