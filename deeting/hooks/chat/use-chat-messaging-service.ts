"use client"

import { useCallback } from "react"
import { streamChatCompletion, type ChatMessage } from "@/lib/api/chat"
import { buildMessageContent, parseMessageContent } from "@/lib/chat/message-content"
import { createSessionId } from "@/lib/chat/session-id"
import { fetchConversationWindow } from "@/lib/api/conversations"
import { signAssets } from "@/lib/api/media-assets"
import { useChatStateStore, type Message, type ChatAssistant } from "@/store/chat-state-store"
import { useChatSessionStore } from "@/store/chat-session-store"

function createMessageId() {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID()
  }

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16)
    cryptoObj.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const toHex = (byte: number) => byte.toString(16).padStart(2, "0")
    return (
      `${toHex(bytes[0])}${toHex(bytes[1])}${toHex(bytes[2])}${toHex(bytes[3])}` +
      `-${toHex(bytes[4])}${toHex(bytes[5])}` +
      `-${toHex(bytes[6])}${toHex(bytes[7])}` +
      `-${toHex(bytes[8])}${toHex(bytes[9])}` +
      `-${toHex(bytes[10])}${toHex(bytes[11])}${toHex(bytes[12])}${toHex(bytes[13])}${toHex(bytes[14])}${toHex(bytes[15])}`
    )
  }

  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function buildChatMessages(history: Message[], systemPrompt?: string): ChatMessage[] {
  const mapped = history.map((msg) => ({
    role: msg.role,
    content: buildMessageContent(
      msg.content,
      msg.role === "user" ? msg.attachments ?? [] : []
    ),
  })) as ChatMessage[]

  const trimmedPrompt = systemPrompt?.trim()
  if (trimmedPrompt && !mapped.some((msg) => msg.role === "system")) {
    mapped.unshift({ role: "system", content: trimmedPrompt })
  }

  return mapped
}

function mapConversationMessages(rawMessages: Array<{ role?: string; content?: unknown; turn_index?: number | null }>) {
  const filtered = rawMessages.filter((msg) => msg.role === "user" || msg.role === "assistant")
  const total = filtered.length
  return filtered.map((msg, index) => {
    const parsed = parseMessageContent(msg.content)
    return {
      id: `conv-${msg.turn_index ?? index}`,
      role: (msg.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: parsed.text,
      attachments: parsed.attachments.length ? parsed.attachments : undefined,
      createdAt: Date.now() - (total - index) * 1000,
    }
  })
}

const resolveMessageAttachments = async (messages: Message[]) => {
  const objectKeys = new Set<string>()
  messages.forEach((message) => {
    message.attachments?.forEach((attachment) => {
      const key = attachment.objectKey
      if (!key) return
      if (!attachment.url || attachment.url.startsWith("asset://")) {
        objectKeys.add(key)
      }
    })
  })
  if (!objectKeys.size) return messages

  const signed = await signAssets(Array.from(objectKeys))
  const urlMap = new Map(
    signed.assets.map((item) => [item.object_key, item.asset_url])
  )

  return messages.map((message) => {
    if (!message.attachments?.length) return message
    const attachments = message.attachments.map((attachment) => {
      if (!attachment.objectKey) return attachment
      const url = urlMap.get(attachment.objectKey)
      if (!url) return attachment
      return { ...attachment, url }
    })
    return { ...message, attachments }
  })
}

export function useChatMessagingService() {
  const {
    input,
    attachments,
    messages,
    config,
    models,
    assistants,
    activeAssistantId,
    streamEnabled,
    setInput,
    clearAttachments,
    setMessages,
    updateMessage,
  } = useChatStateStore()

  const {
    sessionId,
    setSessionId,
    setIsLoading,
    setErrorMessage,
    setStatus,
    clearStatus,
  } = useChatSessionStore()

  const loadHistoryBySession = useCallback(async (sessionId: string) => {
    if (!sessionId) return
    try {
      const windowState = await fetchConversationWindow(sessionId)
      const mapped = mapConversationMessages(windowState.messages ?? [])
      let resolved = mapped
      try {
        resolved = await resolveMessageAttachments(mapped)
      } catch (error) {
        console.warn("signAssets_failed", error)
        setErrorMessage("i18n:input.image.errorSign")
        resolved = mapped
      }
      setMessages(resolved)
      setSessionId(sessionId)
    } catch {
      setMessages([])
      setSessionId(undefined)
    }
  }, [setMessages, setSessionId, setErrorMessage])

  const resetSession = useCallback(() => {
    const activeAssistantId = useChatStateStore.getState().activeAssistantId
    if (typeof window !== "undefined" && activeAssistantId) {
      localStorage.removeItem(`deeting-chat-session:${activeAssistantId}`)
    }
    setMessages([])
    setSessionId(undefined)
    clearAttachments()
  }, [setMessages, setSessionId, clearAttachments])

  const sendMessage = useCallback(async () => {
    const trimmedInput = input.trim()
    if (!trimmedInput && attachments.length === 0) return

    const selectedModel =
      models.find((model) => model.provider_model_id === config.model || model.id === config.model) ??
      models[0]
    const activeAssistant = assistants.find((assistant) => assistant.id === activeAssistantId)
    if (!selectedModel || !activeAssistant) return

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: trimmedInput,
      attachments: attachments.length ? attachments : undefined,
      createdAt: Date.now(),
    }
    const assistantMessageId = createMessageId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }

    // 更新 UI 状态
    setMessages([...messages, userMessage, assistantMessage])
    setInput("")
    clearAttachments()
    setIsLoading(true)
    clearStatus()

    const requestMessages = buildChatMessages([...messages, userMessage], activeAssistant.systemPrompt)
    let resolvedSessionId = sessionId
    const storageKey = `deeting-chat-session:${activeAssistant.id}`
    if (!resolvedSessionId) {
      resolvedSessionId = createSessionId()
      setSessionId(resolvedSessionId)
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, resolvedSessionId)
      }
    }

    const payload = {
      model: selectedModel.id,
      provider_model_id: selectedModel.provider_model_id ?? undefined,
      messages: requestMessages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      assistant_id: activeAssistant?.id ?? undefined,
      session_id: resolvedSessionId ?? undefined,
    }

    try {
      await streamChatCompletion(
        { ...payload, stream: streamEnabled, status_stream: true },
        {
          onDelta: (_delta, snapshot) => {
            updateMessage(assistantMessageId, snapshot)
          },
          onMessage: (data) => {
            if (data && typeof data === "object" && "type" in data) {
              const payload = data as {
                type?: string
                stage?: string | null
                step?: string | null
                state?: string | null
                code?: string | null
                meta?: unknown
                message?: string
                error_code?: string
              }
              if (payload.type === "status") {
                setStatus({
                  stage: payload.stage ?? null,
                  step: payload.step ?? null,
                  state: payload.state ?? null,
                  code: payload.code ?? null,
                  meta: typeof payload.meta === "object" && payload.meta ? (payload.meta as Record<string, unknown>) : null,
                })
                return
              }
              if (payload.type === "error") {
                const message = payload.message || "Request failed"
                updateMessage(assistantMessageId, message)
                setErrorMessage(payload.error_code ? `${payload.error_code}: ${message}` : message)
                return
              }
            }

            const session = (data as { session_id?: string | null })?.session_id ?? undefined
            if (session) {
              setSessionId(session)
              localStorage.setItem(storageKey, session)
            }
          },
        }
      )
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Request failed"
      updateMessage(assistantMessageId, message)
      setErrorMessage(message)
    } finally {
      setIsLoading(false)
      clearStatus()
    }
  }, [
    input,
    attachments,
    messages,
    config,
    models,
    assistants,
    activeAssistantId,
    streamEnabled,
    sessionId,
    setInput,
    clearAttachments,
    setMessages,
    updateMessage,
    setSessionId,
    setIsLoading,
    setErrorMessage,
    setStatus,
    clearStatus,
  ])

  return {
    sendMessage,
    loadHistoryBySession,
    resetSession,
  }
}