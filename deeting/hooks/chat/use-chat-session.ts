"use client"

import { useCallback, useEffect, useMemo } from "react"
import { useChatStore } from "@/store/chat-store"

interface UseChatSessionProps {
  agentId: string
}

export function useChatSession({ agentId }: UseChatSessionProps) {
  const { sessionId, setSessionId, resetSession, setMessages, clearAttachments } = useChatStore()

  const sessionStorageKey = useMemo(
    () => `deeting-chat-session:${agentId}`,
    [agentId]
  )

  // 同步 sessionId 到 localStorage
  useEffect(() => {
    if (typeof window === "undefined" || !sessionId) return
    localStorage.setItem(sessionStorageKey, sessionId)
  }, [sessionId, sessionStorageKey])

  const handleNewChat = useCallback(() => {
    resetSession()
    setMessages([])
    clearAttachments()
    if (typeof window !== "undefined") {
      localStorage.removeItem(sessionStorageKey)
    }
  }, [resetSession, setMessages, clearAttachments, sessionStorageKey])

  const loadStoredSession = useCallback(() => {
    if (typeof window === "undefined") return null
    return localStorage.getItem(sessionStorageKey)
  }, [sessionStorageKey])

  return {
    sessionId,
    setSessionId,
    handleNewChat,
    loadStoredSession,
  }
}