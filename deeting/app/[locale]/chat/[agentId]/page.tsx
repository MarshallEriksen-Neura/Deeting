"use client"

import { Suspense, useEffect } from "react"
import { ChatContainer } from "../components/chat-container"
import { ChatSkeleton } from "../components/chat-skeleton"
import { useChatStore } from "@/store/chat-store"

interface ChatPageProps {
  params: { agentId: string }
}

export default function AgentChatPage({ params }: ChatPageProps) {
  const { agentId } = params
  const setActiveAssistantId = useChatStore((state) => state.setActiveAssistantId)
  const setErrorMessage = useChatStore((state) => state.setErrorMessage)
  const setMessages = useChatStore((state) => state.setMessages)
  const setInput = useChatStore((state) => state.setInput)
  const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"

  useEffect(() => {
    setActiveAssistantId(agentId)
    setErrorMessage(null)
    setMessages([])
    setInput("")
  }, [agentId, setActiveAssistantId, setErrorMessage, setMessages, setInput])

  if (!isTauri) {
    return null
  }

  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContainer agentId={agentId} />
    </Suspense>
  )
}
