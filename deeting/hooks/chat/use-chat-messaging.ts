"use client"

import { useCallback } from "react"
import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useChatMessagingService } from "./use-chat-messaging-service"
import { useI18n } from "@/hooks/use-i18n"
import { createConversation } from "@/lib/api/conversations"

interface UseChatMessagingProps {
  isTauriRuntime: boolean
}

export function useChatMessaging({ isTauriRuntime }: UseChatMessagingProps) {
  const t = useI18n("chat")

  const {
    input,
    attachments,
    config,
  } = useChatStore(
    useShallow((state) => ({
      input: state.input,
      attachments: state.attachments,
      config: state.config,
    }))
  )
  const {
    isLoading,
    errorMessage,
    setErrorMessage,
    sessionId,
    setSessionId,
  } = useChatRuntimeStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      errorMessage: state.errorMessage,
      setErrorMessage: state.setErrorMessage,
      sessionId: state.sessionId,
      setSessionId: state.setSessionId,
    }))
  )
  const {
    sendMessage: serviceSendMessage,
    pendingTakeover,
    pendingTakeoverRequestedAction,
    queuePendingTakeoverFromCurrentDraft,
    stopAndSendPendingTakeover,
    markPendingTakeoverForDeferredSend,
    cancelPendingTakeover,
    cancelActiveRequest,
    regenerateMessage,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  } = useChatMessagingService()

  const handleSendMessage = useCallback(async () => {
    if (isTauriRuntime) {
      const userContent = input.trim()
      if (!userContent && attachments.length === 0) return

      if (!config.model) {
        setErrorMessage(t("error.modelUnavailable"))
        return
      }

      let localSessionId = sessionId
      if (!localSessionId) {
        try {
          const created = await createConversation({})
          if (created.session_id) {
            localSessionId = created.session_id
            setSessionId(created.session_id)
          }
        } catch {
          // ignore local conversation create failures
        }
      }

      await serviceSendMessage(localSessionId)
    } else {
      await serviceSendMessage()
    }
  }, [
    isTauriRuntime,
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
    pendingTakeover,
    pendingTakeoverRequestedAction,
    queuePendingTakeoverFromCurrentDraft,
    stopAndSendPendingTakeover,
    markPendingTakeoverForDeferredSend,
    cancelPendingTakeover,
    cancelActiveRequest,
    regenerateMessage,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  }
}
