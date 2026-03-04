"use client"

import { useCallback } from "react"
import { useChatStore } from "@/store/chat-store"
import { useChatMessagingService } from "./use-chat-messaging-service"
import { useI18n } from "@/hooks/use-i18n"
import { createConversation } from "@/lib/api/conversations"

interface UseChatMessagingProps {
  agent?: { id: string; name: string }
  isTauriRuntime: boolean
}

export function useChatMessaging({ agent, isTauriRuntime }: UseChatMessagingProps) {
  const t = useI18n("chat")

  const {
    input,
    attachments,
    config,
    isLoading,
    errorMessage,
    setErrorMessage,
    sessionId,
    setSessionId,
  } = useChatStore()
  const {
    sendMessage: serviceSendMessage,
    cancelActiveRequest,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  } = useChatMessagingService()

  const handleSendMessage = useCallback(async () => {
    if (isTauriRuntime && agent) {
      const userContent = input.trim()
      if (!userContent && attachments.length === 0) return

      if (!config.model) {
        setErrorMessage(t("error.modelUnavailable"))
        return
      }

      let localSessionId = sessionId
      if (!localSessionId) {
        try {
          const created = await createConversation({ assistant_id: agent.id })
          if (created.session_id) {
            localSessionId = created.session_id
            setSessionId(created.session_id)
          }
        } catch {
          // ignore local conversation create failures
        }
      }

      await serviceSendMessage()
    } else {
      await serviceSendMessage()
    }
  }, [
    isTauriRuntime,
    agent,
    input,
    attachments,
    config.model,
    sessionId,
    setSessionId,
    setErrorMessage,
    serviceSendMessage,
    t,
  ])

  const hasContent = Boolean(input.trim() || attachments.length)

  return {
    handleSendMessage,
    hasContent,
    isLoading,
    errorMessage,
    cancelActiveRequest,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  }
}
