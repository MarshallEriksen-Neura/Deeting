"use client"

import * as React from "react"
import { useChatStateStore } from "@/store/chat-state-store"
import { useChatSessionStore } from "@/store/chat-session-store"

interface ChatContextValue {
  // 基础状态
  isTyping: boolean
  errorMessage: string | null
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
  
  // 输入相关
  input: string
  setInput: (input: string) => void
  
  // 错误处理
  setErrorMessage: (error: string | null) => void
  resetSession: () => void
}

const ChatContext = React.createContext<ChatContextValue | null>(null)

export function useChatContext() {
  const context = React.useContext(ChatContext)
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider")
  }
  return context
}

interface ChatProviderProps {
  children: React.ReactNode
}

export function ChatProvider({ children }: ChatProviderProps) {
  const { input, setInput } = useChatStateStore()
  const {
    isLoading,
    errorMessage,
    statusStage,
    statusCode,
    statusMeta,
    setErrorMessage,
    resetSession,
  } = useChatSessionStore()

  const contextValue: ChatContextValue = React.useMemo(() => ({
    isTyping: isLoading,
    errorMessage,
    statusStage,
    statusCode,
    statusMeta,
    input,
    setInput,
    setErrorMessage,
    resetSession,
  }), [
    isLoading,
    errorMessage,
    statusStage,
    statusCode,
    statusMeta,
    input,
    setInput,
    setErrorMessage,
    resetSession,
  ])

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  )
}