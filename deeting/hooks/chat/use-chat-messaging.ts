"use client"

import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useChatStateStore } from "@/store/chat-state-store"
import { useChatSessionStore } from "@/store/chat-session-store"
import { useChatMessagingService } from "./use-chat-messaging-service"
import { serializeMessageContent } from "@/lib/chat/message-content"
import { useI18n } from "@/hooks/use-i18n"

interface UseChatMessagingProps {
  agent?: { id: string; name: string }
  isTauriRuntime: boolean
}

export function useChatMessaging({ agent, isTauriRuntime }: UseChatMessagingProps) {
  const t = useI18n("chat")
  
  const { input, attachments, config } = useChatStateStore()
  const { isLoading, errorMessage, setErrorMessage } = useChatSessionStore()
  const { sendMessage: serviceSendMessage, cancelActiveRequest } = useChatMessagingService()

  const handleSendMessage = useCallback(async () => {
    if (isTauriRuntime && agent) {
      const userContent = input.trim()
      if (!userContent && attachments.length === 0) return

      if (!config.model) {
        setErrorMessage(t("error.modelUnavailable"))
        return
      }

      // 1. 持久化用户消息到 Tauri DB
      void invoke("append_assistant_message", {
        assistant_id: agent.id,
        role: "user",
        content: serializeMessageContent(userContent, attachments)
      }).catch(() => undefined)

      // 2. 委托给服务（添加到 UI，调用 API）
      await serviceSendMessage()

      // 3. 持久化助手响应到 Tauri DB
      const currentMessages = useChatStateStore.getState().messages
      const lastMsg = currentMessages[currentMessages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        void invoke("append_assistant_message", {
          assistant_id: agent.id,
          role: "assistant",
          content: lastMsg.content
        }).catch(() => undefined)
      }
    } else {
      await serviceSendMessage()
    }
  }, [
    isTauriRuntime,
    agent,
    input,
    attachments,
    config.model,
    setErrorMessage,
    serviceSendMessage,
    t
  ])

  const hasContent = Boolean(input.trim() || attachments.length)

  return {
    handleSendMessage,
    hasContent,
    isLoading,
    errorMessage,
    cancelActiveRequest,
  }
}
