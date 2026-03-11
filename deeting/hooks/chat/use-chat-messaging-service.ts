"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  cancelChatCompletion,
  cancelDesktopLocalChatCompletion,
  finalizeDesktopLocalCompare,
  streamChatCompletion,
  streamDesktopLocalChatCompletion,
  type ChatMessage,
} from "@/lib/api/chat"
import { buildMessageContent, resolveLocalAssetUrlsInContent } from "@/lib/chat/message-content"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"
import { createRequestId } from "@/lib/chat/request-id"

const WEB_SESSION_STORAGE_KEY = "deeting-chat-session:router"

export function resolveChatRequestContext({
  isTauriRuntime,
  selectedAssistantId,
}: {
  isTauriRuntime: boolean
  selectedAssistantId?: string | null
}) {
  if (!selectedAssistantId || isTauriRuntime) {
    return { assistantId: undefined, sessionStorageKey: WEB_SESSION_STORAGE_KEY }
  }
  return { assistantId: selectedAssistantId, sessionStorageKey: WEB_SESSION_STORAGE_KEY }
}
import { resolveSessionIdFromBrowser } from "@/lib/chat/session-storage"
import {
  fetchConversationHistory,
} from "@/lib/api/conversations"
import type { ConversationMessage } from "@/lib/api/conversations"
import { prepareDesktopObjectStorageRead } from "@/lib/api/desktop-object-storage"
import { signAssets } from "@/lib/api/media-assets"
import { useChatStore, type CompareCandidate, type Message } from "@/store/chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import { extractAssistantTextFromBlocks } from "@/lib/chat/message-blocks"

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

function collectLocalAssetUrlMap(history: Message[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of history) {
    if (!msg.attachments) continue
    for (const att of msg.attachments) {
      if (att.source === "local" && att.sha256 && att.url && !att.url.startsWith("local-asset://")) {
        map.set(att.sha256, att.url)
      }
    }
  }
  return map
}

function buildChatMessages(history: Message[], systemPrompt?: string): ChatMessage[] {
  const localUrlMap = collectLocalAssetUrlMap(history)
  const mapped = history.map((msg) => {
    const content = buildMessageContent(
      msg.content,
      msg.role === "user" ? msg.attachments ?? [] : []
    )
    return {
      role: msg.role,
      content: localUrlMap.size > 0
        ? resolveLocalAssetUrlsInContent(content, localUrlMap)
        : content,
    }
  }) as ChatMessage[]

  const trimmedPrompt = systemPrompt?.trim()
  if (trimmedPrompt && !mapped.some((msg) => msg.role === "system")) {
    mapped.unshift({ role: "system", content: trimmedPrompt })
  }

  return mapped
}

function mapConversationMessages(rawMessages: Array<{ role?: string; content?: unknown; turn_index?: number | null }>) {
  return normalizeConversationMessages(rawMessages as ConversationMessage[], { idPrefix: "conv" })
}

function isValidBlock(block: unknown): block is MessageBlock {
  return Boolean(
    block &&
      typeof block === "object" &&
      "type" in (block as Record<string, unknown>)
  )
}

function hasRenderableTextBlock(blocks: MessageBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.type === "text" &&
      typeof block.content === "string" &&
      block.content.trim().length > 0
  )
}

function hasRenderableNonToolBlocks(blocks: MessageBlock[]): boolean {
  return blocks.some((block) => block.type !== "tool_call" && block.type !== "tool_result")
}

function parseStreamResponseBody(data: unknown): Record<string, unknown> | null {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (data && typeof data === "object") {
    return data as Record<string, unknown>
  }
  return null
}

function extractAssistantResponseBlocks(responseBody: Record<string, unknown>): MessageBlock[] {
  const choices = Array.isArray(responseBody.choices) ? responseBody.choices : []
  const firstChoice = choices[0]
  const responseMessage = firstChoice && typeof firstChoice === "object"
    ? (firstChoice as Record<string, unknown>).message
    : null
  if (!responseMessage || typeof responseMessage !== "object") {
    return []
  }

  const messageObject = responseMessage as Record<string, unknown>
  const metaInfo = messageObject.meta_info && typeof messageObject.meta_info === "object"
    ? (messageObject.meta_info as Record<string, unknown>)
    : null
  const metaBlocks = Array.isArray(metaInfo?.blocks)
    ? ((metaInfo.blocks as unknown[]).filter(isValidBlock) as MessageBlock[])
    : []

  const nextBlocks: MessageBlock[] = metaBlocks.filter(
    (block) => block.type !== "tool_call" && block.type !== "tool_result"
  )

  if (metaBlocks.length === 0) {
    const reasoning = typeof messageObject.reasoning_content === "string"
      ? messageObject.reasoning_content
      : ""
    const textContent = typeof messageObject.content === "string" ? messageObject.content : ""
    if (reasoning.trim()) {
      nextBlocks.push({ type: "thought", content: reasoning } as MessageBlock)
    }
    if (textContent.trim()) {
      nextBlocks.push({ type: "text", content: textContent } as MessageBlock)
    }
  } else if (!nextBlocks.some((block) => block.type === "text")) {
    const textContent = typeof messageObject.content === "string" ? messageObject.content : ""
    if (textContent.trim()) {
      nextBlocks.push({ type: "text", content: textContent } as MessageBlock)
    }
  }

  return nextBlocks
}

export function shouldAppendFinalResponseBlocks({
  currentBlocks,
  responseBlocks,
  receivedStructuredBlocks,
}: {
  currentBlocks: MessageBlock[]
  responseBlocks: MessageBlock[]
  receivedStructuredBlocks: boolean
}): boolean {
  if (responseBlocks.length === 0) return false
  if (receivedStructuredBlocks) return false

  const responseHasOnlyText = responseBlocks.every((block) => block.type === "text")
  if (!responseHasOnlyText) return true

  const currentText = extractAssistantTextFromBlocks(currentBlocks).trim()
  const responseText = extractAssistantTextFromBlocks(responseBlocks).trim()
  if (!responseText) return false

  return currentText !== responseText
}

export function filterIncomingStructuredBlocks({
  currentBlocks,
  incomingBlocks,
  preferLocalRoute,
  isStreaming,
}: {
  currentBlocks: MessageBlock[]
  incomingBlocks: MessageBlock[]
  preferLocalRoute: boolean
  isStreaming: boolean
}): MessageBlock[] {
  if (!preferLocalRoute || !isStreaming || incomingBlocks.length === 0) {
    return incomingBlocks
  }

  const currentText = extractAssistantTextFromBlocks(currentBlocks).trim()
  if (!currentText) {
    return incomingBlocks
  }

  const incomingText = extractAssistantTextFromBlocks(incomingBlocks).trim()
  if (!incomingText || incomingText !== currentText) {
    return incomingBlocks
  }

  return incomingBlocks.filter((block) => block.type !== "text")
}

function createErrorBlock(messageId: string, message: string): MessageBlock {
  return {
    id: `${messageId}-error`,
    type: "error",
    message,
    streamState: "completed",
    displayMode: "bubble",
  } as MessageBlock
}

function isDesktopLocalModel(model?: { request_route?: string; runtime_source?: string }) {
  if (!model) return false
  return model.request_route === "local_invoke" || model.runtime_source === "desktop_local"
}

function getAssistantBlocksForCandidate(message: Message): MessageBlock[] {
  if (Array.isArray(message.blocks) && message.blocks.length > 0) {
    return message.blocks as MessageBlock[]
  }
  if (message.content.trim()) {
    return [{ type: "text", content: message.content } as MessageBlock]
  }
  return []
}

async function resolveLocalChatAsset(
  sha256: string,
  contentType: string
): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const result = await invoke<{ data_url: string }>("read_local_chat_asset", {
      payload: { sha256, content_type: contentType },
    })
    return result.data_url
  } catch {
    return null
  }
}

async function resolveDesktopObjectStorageAssetUrls(objectKeys: string[]) {
  if (!objectKeys.length) {
    return new Map<string, string>()
  }

  const settled = await Promise.allSettled(
    objectKeys.map(async (objectKey) => {
      const ticket = await prepareDesktopObjectStorageRead({
        object_key: objectKey,
        expires_seconds: 900,
      })
      return [objectKey, ticket.asset_url] as const
    })
  )

  const urlMap = new Map<string, string>()
  const unresolved: string[] = []
  settled.forEach((result, index) => {
    const objectKey = objectKeys[index]
    if (result.status === "fulfilled") {
      urlMap.set(result.value[0], result.value[1])
      return
    }
    unresolved.push(objectKey)
  })

  if (unresolved.length) {
    const signedResult = await signAssets(unresolved).catch(() => ({
      assets: [] as { object_key: string; asset_url: string }[],
    }))
    signedResult.assets.forEach((item) => {
      urlMap.set(item.object_key, item.asset_url)
    })
  }

  return urlMap
}

export const resolveMessageAttachments = async (messages: Message[], isTauri = false) => {
  const objectKeys = new Set<string>()
  const localAssets: { msgIdx: number; attIdx: number; sha256: string; type: string }[] = []

  messages.forEach((message, msgIdx) => {
    message.attachments?.forEach((attachment, attIdx) => {
      if (
        isTauri &&
        attachment.source === "local" &&
        attachment.sha256 &&
        (!attachment.url || attachment.url.startsWith("local-asset://"))
      ) {
        localAssets.push({
          msgIdx,
          attIdx,
          sha256: attachment.sha256,
          type: attachment.type || "image/png",
        })
        return
      }
      const key = attachment.objectKey
      if (!key) return
      if (!attachment.url || attachment.url.startsWith("asset://")) {
        objectKeys.add(key)
      }
    })
  })

  if (!objectKeys.size && !localAssets.length) return messages

  const [urlMap, ...localResults] = await Promise.all([
    objectKeys.size
      ? isTauri
        ? resolveDesktopObjectStorageAssetUrls(Array.from(objectKeys))
        : signAssets(Array.from(objectKeys))
            .then(
              (result) => new Map(result.assets.map((item) => [item.object_key, item.asset_url]))
            )
            .catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
    ...localAssets.map((la) => resolveLocalChatAsset(la.sha256, la.type)),
  ])

  const localUrlMap = new Map<string, string>()
  localAssets.forEach((la, i) => {
    const dataUrl = localResults[i]
    if (dataUrl) localUrlMap.set(la.sha256, dataUrl)
  })

  return messages.map((message) => {
    if (!message.attachments?.length) return message
    const attachments = message.attachments.map((attachment) => {
      if (attachment.source === "local" && attachment.sha256 && localUrlMap.has(attachment.sha256)) {
        return { ...attachment, url: localUrlMap.get(attachment.sha256)! }
      }
      if (!attachment.objectKey) return attachment
      const url = urlMap.get(attachment.objectKey)
      if (!url) return attachment
      return { ...attachment, url }
    })
    return { ...message, attachments }
  })
}

export function useChatMessagingService() {
  const cancelRef = useRef<(() => void) | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const activeRequestRouteRef = useRef<"local_gateway" | "cloud" | null>(null)
  const activeAssistantMessageIdRef = useRef<string | null>(null)
  const interruptedMessageIdsRef = useRef<Set<string>>(new Set())
  const [interruptedAssistantMessageId, setInterruptedAssistantMessageId] = useState<string | null>(null)
  const {
    input,
    attachments,
    messages,
    config,
    models,
    selectedAssistant,
    agentId: selectedAssistantId,
    streamEnabled,
    setInput,
    clearAttachments,
    setMessages,
    mergeMessageMeta,
    appendMessageBlocks,
    ensureCompareState,
    upsertCompareCandidate,
    appendCompareCandidateBlocks,
    setCompareActiveCandidate,
    setCompareFinalizing,
    clearCompareState,
    clearAllCompareStates,
    sessionId,
    setSessionId,
    setIsLoading,
    setErrorMessage,
    setStatus,
    clearStatus,
  } = useChatStore()

  const setHistoryState = useCallback((state: { cursor?: number | null; hasMore?: boolean; loading?: boolean }) => {
    useChatStore.setState({
      ...(state.cursor !== undefined && { historyCursor: state.cursor }),
      ...(state.hasMore !== undefined && { historyHasMore: state.hasMore }),
      ...(state.loading !== undefined && { isLoading: state.loading }),
    })
  }, [])

  const isTauriRuntime = useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  )

  const loadHistoryBySession = useCallback(async (sessionId: string) => {
    if (!sessionId) return
    setHistoryState({ loading: true })
    try {
      const windowState = await fetchConversationHistory(sessionId, { limit: 30 })
      const mapped = mapConversationMessages(windowState.messages ?? [])
      let resolved = mapped
      try {
        resolved = await resolveMessageAttachments(mapped, isTauriRuntime)
      } catch (error) {
        console.warn("resolve_attachments_failed", error)
        if (!isTauriRuntime) {
          setErrorMessage("i18n:input.image.errorSign")
        }
        resolved = mapped
      }
      setMessages(resolved)
      setSessionId(sessionId)
      setHistoryState({
        cursor: windowState.next_cursor ?? null,
        hasMore: Boolean(windowState.has_more),
      })
    } catch {
      setMessages([])
      setSessionId(null)
      setHistoryState({ cursor: null, hasMore: false })
    } finally {
      setHistoryState({ loading: false })
    }
  }, [isTauriRuntime, setMessages, setSessionId, setErrorMessage, setHistoryState])

  const resetSession = useCallback(() => {
    setMessages([])
    setSessionId(null)
    clearAttachments()
    setHistoryState({ cursor: null, hasMore: false, loading: false })
  }, [setMessages, setSessionId, clearAttachments, setHistoryState])

  const loadMoreHistory = useCallback(async () => {
    const state = useChatStore.getState()
    const {
      sessionId,
      historyCursor,
      historyHasMore,
      isLoading: historyLoading,
    } = state

    if (!sessionId || historyLoading || !historyHasMore) return
    if (historyCursor == null) return

    setHistoryState({ loading: true })
    try {
      const windowState = await fetchConversationHistory(sessionId, {
        cursor: historyCursor ?? undefined,
        limit: 30,
      })
      const mapped = mapConversationMessages(windowState.messages ?? [])
      let resolved = mapped
      try {
        resolved = await resolveMessageAttachments(mapped, isTauriRuntime)
      } catch (error) {
        console.warn("resolve_attachments_failed", error)
        if (!isTauriRuntime) {
          setErrorMessage("i18n:input.image.errorSign")
        }
        resolved = mapped
      }
      const currentMessages = useChatStore.getState().messages
      setMessages([...resolved, ...currentMessages])
      setHistoryState({
        cursor: windowState.next_cursor ?? null,
        hasMore: Boolean(windowState.has_more),
      })
    } catch {
      setHistoryState({ hasMore: false })
    } finally {
      setHistoryState({ loading: false })
    }
  }, [isTauriRuntime, setErrorMessage, setHistoryState, setMessages])

  const cancelActiveRequest = useCallback(async () => {
    const requestId = requestIdRef.current
    const route = activeRequestRouteRef.current
    const activeAssistantMessageId = activeAssistantMessageIdRef.current
    if (activeAssistantMessageId) {
      interruptedMessageIdsRef.current.add(activeAssistantMessageId)
      setInterruptedAssistantMessageId(activeAssistantMessageId)
    }
    cancelRef.current?.()
    cancelRef.current = null
    requestIdRef.current = null
    activeAssistantMessageIdRef.current = null
    setIsLoading(false)
    clearStatus()
    if (!requestId) return
    try {
      if (route === "local_gateway") {
        await cancelDesktopLocalChatCompletion(requestId)
      } else {
        await cancelChatCompletion(requestId)
      }
    } catch {
      // ignore cancel errors
    } finally {
      activeRequestRouteRef.current = null
    }
  }, [clearStatus, setIsLoading])

  const findModelByValue = useCallback((value?: string | null) => {
    if (!value) return null
    return (
      models.find((model) => model.provider_model_id === value || model.id === value) ?? null
    )
  }, [models])

  const resolveCurrentSessionId = useCallback((sessionStorageKey: string, fallback?: string | null) => {
    let resolved = fallback ?? useChatStore.getState().sessionId ?? sessionId
    if (!resolved) {
      const fallbackSessionId = resolveSessionIdFromBrowser(sessionStorageKey, {
        allowStorageFallback: false,
      })
      if (fallbackSessionId) {
        resolved = fallbackSessionId
        setSessionId(resolved)
      }
    }
    return resolved
  }, [sessionId, setSessionId])

  const runStreamedRequest = useCallback(async ({
    payload,
    preferLocalRoute,
    trackActiveRequest = false,
    errorBlockIdBase,
    onBlocks,
    onTraceId,
    onSessionResolved,
    onStatusEvent,
    getCurrentBlocks,
    onRequestError,
  }: {
    payload: Parameters<typeof streamChatCompletion>[0]
    preferLocalRoute: boolean
    trackActiveRequest?: boolean
    errorBlockIdBase: string
    onBlocks: (blocks: MessageBlock[]) => void
    onTraceId?: (traceId: string) => void
    onSessionResolved?: (nextSessionId: string) => void
    onStatusEvent?: (status: {
      stage: string | null
      code: string | null
      meta: Record<string, unknown> | null
    }) => void
    getCurrentBlocks: () => MessageBlock[]
    onRequestError: (message: string, errorCode?: string | null) => void
  }) => {
    const streamFn = preferLocalRoute ? streamDesktopLocalChatCompletion : streamChatCompletion
    let receivedStructuredBlocks = false
    const streamedText = await streamFn(
      {
        ...payload,
        stream: streamEnabled,
        status_stream: true,
      },
      {
        onDelta: (delta) => {
          if (!delta) return
          onBlocks([
            { type: "text", content: delta, streamState: "streaming" } as MessageBlock,
          ])
        },
        onMessage: (data) => {
          if (data && typeof data === "object" && "type" in data) {
            const streamMessage = data as {
              type?: string
              stage?: string | null
              code?: string | null
              meta?: unknown
              blocks?: unknown
              message?: string
              error_code?: string
              trace_id?: string | null
            }
            if (streamMessage.type === "status") {
              onStatusEvent?.({
                stage: streamMessage.stage ?? null,
                code: streamMessage.code ?? null,
                meta:
                  typeof streamMessage.meta === "object" && streamMessage.meta
                    ? (streamMessage.meta as Record<string, unknown>)
                    : null,
              })
              if (streamMessage.trace_id) {
                onTraceId?.(streamMessage.trace_id)
              }
              return
            }
            if (streamMessage.type === "error") {
              const message = streamMessage.message || "Request failed"
              onBlocks([createErrorBlock(errorBlockIdBase, message)])
              onRequestError(message, streamMessage.error_code ?? null)
              return
            }
            if (streamMessage.type === "blocks") {
              if (Array.isArray(streamMessage.blocks)) {
                const blocks = streamMessage.blocks.filter(isValidBlock) as MessageBlock[]
                if (blocks.length > 0) {
                  receivedStructuredBlocks = true
                  const filteredBlocks = filterIncomingStructuredBlocks({
                    currentBlocks: getCurrentBlocks(),
                    incomingBlocks: blocks,
                    preferLocalRoute,
                    isStreaming: streamEnabled,
                  })
                  if (filteredBlocks.length > 0) {
                    onBlocks(filteredBlocks)
                  }
                }
              }
              return
            }
          }

          const responseBody = parseStreamResponseBody(data)
          if (!responseBody) return

          if (typeof responseBody.session_id === "string") {
            onSessionResolved?.(responseBody.session_id)
          }
          if (typeof responseBody.trace_id === "string") {
            onTraceId?.(responseBody.trace_id)
          }

          const responseBlocks = extractAssistantResponseBlocks(responseBody)
          if (
            shouldAppendFinalResponseBlocks({
              currentBlocks: getCurrentBlocks(),
              responseBlocks,
              receivedStructuredBlocks,
            })
          ) {
            onBlocks(responseBlocks)
          }
        },
      },
      trackActiveRequest
        ? {
            onCancel: (cancel) => {
              cancelRef.current = cancel
            },
          }
        : undefined
    )

    const latestBlocks = getCurrentBlocks()
    if (
      streamedText.trim().length > 0 &&
      !hasRenderableTextBlock(latestBlocks) &&
      !hasRenderableNonToolBlocks(latestBlocks)
    ) {
      onBlocks([{ type: "text", content: streamedText } as MessageBlock])
    }
  }, [streamEnabled])

  const replaceAssistantMessage = useCallback((targetMessageId: string, replacement: Message) => {
    const currentMessages = useChatStore.getState().messages
    setMessages(
      currentMessages.map((message) =>
        message.id === targetMessageId
          ? {
              ...replacement,
              id: targetMessageId,
              createdAt: message.createdAt,
            }
          : message
      )
    )
  }, [setMessages])

  const sendMessage = useCallback(async (sessionIdOverride?: string | null) => {
    const trimmedInput = input.trim()
    if (!trimmedInput && attachments.length === 0) return

    const selectedModel =
      models.find((model) => model.provider_model_id === config.model || model.id === config.model) ??
      models[0]
    const preferLocalRoute =
      isTauriRuntime && (selectedModel?.request_route ?? "local_invoke") === "local_invoke"
    const selectedAssistantForRequest = selectedAssistant
    if (!selectedModel) return

    const { assistantId, sessionStorageKey } = resolveChatRequestContext({
      isTauriRuntime,
      selectedAssistantId,
    })

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
    activeAssistantMessageIdRef.current = assistantMessageId
    setInterruptedAssistantMessageId(null)
    clearAllCompareStates()

    // 更新 UI 状态
    setMessages([...messages, userMessage, assistantMessage])
    setInput("")
    clearAttachments()
    setIsLoading(true)
    clearStatus()

    const resolvedSessionId = resolveCurrentSessionId(sessionStorageKey, sessionIdOverride)
    try {
      if (preferLocalRoute && !resolvedSessionId) {
        throw new Error("Session not found")
      }

      // Local route: Rust orchestrator injects assistant persona; skip frontend prepend to avoid duplication.
      const requestMessages = buildChatMessages(
        [...messages, userMessage],
        preferLocalRoute ? undefined : selectedAssistantForRequest?.systemPrompt,
      )
      const payload = {
        model: selectedModel.id,
        provider_model_id: selectedModel.provider_model_id ?? undefined,
        messages: requestMessages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        request_id: createRequestId(),
        assistant_id: assistantId,
        session_id: resolvedSessionId ?? undefined,
      }
      requestIdRef.current = payload.request_id ?? null
      activeRequestRouteRef.current = preferLocalRoute ? "local_gateway" : "cloud"

      await runStreamedRequest({
        payload: {
          ...payload,
          session_id: resolvedSessionId ?? undefined,
        },
        preferLocalRoute,
        trackActiveRequest: true,
        errorBlockIdBase: assistantMessageId,
        onBlocks: (blocks) => {
          appendMessageBlocks(assistantMessageId, blocks)
        },
        onTraceId: (traceId) => mergeMessageMeta(assistantMessageId, { trace_id: traceId }),
        onSessionResolved: (nextSessionId) => setSessionId(nextSessionId),
        onStatusEvent: (status) => setStatus(status),
        getCurrentBlocks: () => {
          const latest = useChatStore.getState().messages.find((message) => message.id === assistantMessageId)
          return Array.isArray(latest?.blocks) ? (latest.blocks as MessageBlock[]) : []
        },
        onRequestError: (message, errorCode) => {
          setErrorMessage(errorCode ? `${errorCode}: ${message}` : message)
        },
      })
    } catch (error) {
      if (interruptedMessageIdsRef.current.has(assistantMessageId)) {
        return
      }
      const message = error instanceof Error && error.message ? error.message : "Request failed"
      appendMessageBlocks(assistantMessageId, [createErrorBlock(assistantMessageId, message)])
      setErrorMessage(message)
    } finally {
      setIsLoading(false)
      clearStatus()
      cancelRef.current = null
      requestIdRef.current = null
      activeRequestRouteRef.current = null
      activeAssistantMessageIdRef.current = null
      interruptedMessageIdsRef.current.delete(assistantMessageId)
    }
  }, [
    input,
    attachments,
    messages,
    config,
    models,
    selectedAssistant,
    selectedAssistantId,
    setInput,
    clearAttachments,
    setMessages,
    mergeMessageMeta,
    appendMessageBlocks,
    setSessionId,
    setIsLoading,
    setErrorMessage,
    setStatus,
    clearStatus,
    isTauriRuntime,
    clearAllCompareStates,
    resolveCurrentSessionId,
    runStreamedRequest,
  ])

  const regenerateMessage = useCallback(async (targetMessageId: string) => {
    // 并发保护：如果有正在进行的请求，先取消
    if (useChatStore.getState().isLoading) {
      await cancelActiveRequest()
    }

    // 找到目标 assistant 消息
    const currentMessages = useChatStore.getState().messages
    const targetIndex = currentMessages.findIndex(
      (m) => m.id === targetMessageId && m.role === "assistant"
    )
    if (targetIndex < 0) return

    const selectedModel =
      models.find((model) => model.provider_model_id === config.model || model.id === config.model) ??
      models[0]
    const preferLocalRoute =
      isTauriRuntime && (selectedModel?.request_route ?? "local_invoke") === "local_invoke"
    const selectedAssistantForRequest = selectedAssistant
    if (!selectedModel) return

    const { assistantId, sessionStorageKey } = resolveChatRequestContext({
      isTauriRuntime,
      selectedAssistantId,
    })

    // 移除旧的 assistant 消息，插入新的空 assistant 占位
    const messagesBeforeTarget = currentMessages.slice(0, targetIndex)
    const assistantMessageId = createMessageId()
    const newAssistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }
    activeAssistantMessageIdRef.current = assistantMessageId
    setInterruptedAssistantMessageId(null)
    clearAllCompareStates()

    setMessages([...messagesBeforeTarget, newAssistantMessage])
    setIsLoading(true)
    clearStatus()

    // 构建请求消息（不含被删除的 assistant 消息）
    const resolvedSessionId = resolveCurrentSessionId(sessionStorageKey)
    try {
      if (preferLocalRoute && !resolvedSessionId) {
        throw new Error("Session not found")
      }

      const requestMessages = buildChatMessages(
        messagesBeforeTarget,
        preferLocalRoute ? undefined : selectedAssistantForRequest?.systemPrompt,
      )
      const payload = {
        model: selectedModel.id,
        provider_model_id: selectedModel.provider_model_id ?? undefined,
        messages: requestMessages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        request_id: createRequestId(),
        assistant_id: assistantId,
        session_id: resolvedSessionId ?? undefined,
        regenerate: true,
      }
      requestIdRef.current = payload.request_id ?? null
      activeRequestRouteRef.current = preferLocalRoute ? "local_gateway" : "cloud"

      await runStreamedRequest({
        payload: {
          ...payload,
          session_id: resolvedSessionId ?? undefined,
        },
        preferLocalRoute,
        trackActiveRequest: true,
        errorBlockIdBase: assistantMessageId,
        onBlocks: (blocks) => {
          appendMessageBlocks(assistantMessageId, blocks)
        },
        onTraceId: (traceId) => mergeMessageMeta(assistantMessageId, { trace_id: traceId }),
        onSessionResolved: (nextSessionId) => setSessionId(nextSessionId),
        onStatusEvent: (status) => setStatus(status),
        getCurrentBlocks: () => {
          const latest = useChatStore.getState().messages.find((message) => message.id === assistantMessageId)
          return Array.isArray(latest?.blocks) ? (latest.blocks as MessageBlock[]) : []
        },
        onRequestError: (message, errorCode) => {
          setErrorMessage(errorCode ? `${errorCode}: ${message}` : message)
        },
      })
    } catch (error) {
      if (interruptedMessageIdsRef.current.has(assistantMessageId)) {
        return
      }
      const message = error instanceof Error && error.message ? error.message : "Request failed"
      appendMessageBlocks(assistantMessageId, [createErrorBlock(assistantMessageId, message)])
      setErrorMessage(message)
    } finally {
      setIsLoading(false)
      clearStatus()
      cancelRef.current = null
      requestIdRef.current = null
      activeRequestRouteRef.current = null
      activeAssistantMessageIdRef.current = null
      interruptedMessageIdsRef.current.delete(assistantMessageId)
    }
  }, [
    config,
    models,
    selectedAssistant,
    selectedAssistantId,
    cancelActiveRequest,
    setMessages,
    mergeMessageMeta,
    appendMessageBlocks,
    setSessionId,
    setIsLoading,
    setErrorMessage,
    setStatus,
    clearStatus,
    isTauriRuntime,
    clearAllCompareStates,
    resolveCurrentSessionId,
    runStreamedRequest,
  ])

  const compareWithModel = useCallback(async (targetMessageId: string, modelValue: string) => {
    if (!isTauriRuntime) return

    const currentMessages = useChatStore.getState().messages
    const targetIndex = currentMessages.findIndex(
      (message) => message.id === targetMessageId && message.role === "assistant"
    )
    if (targetIndex < 0) return

    const latestAssistantMessage = [...currentMessages]
      .reverse()
      .find((message) => message.role === "assistant")
    if (!latestAssistantMessage || latestAssistantMessage.id !== targetMessageId) {
      return
    }

    const targetMessage = currentMessages[targetIndex]
    const selectedCompareModel = findModelByValue(modelValue)
    if (!selectedCompareModel || !isDesktopLocalModel(selectedCompareModel)) {
      setErrorMessage("Compare mode currently supports desktop local models only")
      return
    }

    const baselineModel =
      findModelByValue(
        typeof targetMessage.metaInfo?.provider_model_id === "string"
          ? targetMessage.metaInfo.provider_model_id
          : typeof targetMessage.metaInfo?.model_id === "string"
            ? targetMessage.metaInfo.model_id
            : config.model
      ) ?? selectedCompareModel

    if (!isDesktopLocalModel(baselineModel)) {
      setErrorMessage("Compare mode currently supports answers from desktop local models only")
      return
    }

    const baselineModelKey = baselineModel.provider_model_id ?? baselineModel.id
    const baselineCandidate: CompareCandidate = {
      modelKey: baselineModelKey,
      modelId: baselineModel.id,
      providerModelId: baselineModel.provider_model_id ?? undefined,
      content: targetMessage.content,
      blocks: getAssistantBlocksForCandidate(targetMessage),
      loading: false,
      baseline: true,
      traceId:
        typeof targetMessage.metaInfo?.trace_id === "string"
          ? targetMessage.metaInfo.trace_id
          : undefined,
      errorMessage: null,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    }

    ensureCompareState(targetMessageId, baselineCandidate)

    const compareModelKey = selectedCompareModel.provider_model_id ?? selectedCompareModel.id
    setCompareActiveCandidate(targetMessageId, compareModelKey)
    if (compareModelKey === baselineModelKey) {
      return
    }

    const existingCandidate = useChatStore
      .getState()
      .compareByMessageId[targetMessageId]?.candidates[compareModelKey]
    if (existingCandidate && !existingCandidate.loading && !existingCandidate.errorMessage) {
      return
    }

    const { assistantId, sessionStorageKey } = resolveChatRequestContext({
      isTauriRuntime,
      selectedAssistantId,
    })
    const resolvedSessionId = resolveCurrentSessionId(sessionStorageKey)
    if (!resolvedSessionId) {
      setErrorMessage("Session not found")
      return
    }

    const messagesBeforeTarget = currentMessages.slice(0, targetIndex)
    upsertCompareCandidate(targetMessageId, {
      modelKey: compareModelKey,
      modelId: selectedCompareModel.id,
      providerModelId: selectedCompareModel.provider_model_id ?? undefined,
      content: existingCandidate?.content ?? "",
      blocks: existingCandidate?.blocks ?? [],
      loading: true,
      baseline: false,
      traceId: existingCandidate?.traceId,
      errorMessage: null,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    })

    try {
      const requestMessages = buildChatMessages(messagesBeforeTarget)
      await runStreamedRequest({
        payload: {
          model: selectedCompareModel.id,
          provider_model_id: selectedCompareModel.provider_model_id ?? undefined,
          messages: requestMessages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          request_id: createRequestId(),
          assistant_id: assistantId,
          session_id: resolvedSessionId,
          compare_only: true,
        },
        preferLocalRoute: true,
        errorBlockIdBase: `${targetMessageId}-${compareModelKey}`,
        onBlocks: (blocks) => appendCompareCandidateBlocks(targetMessageId, compareModelKey, blocks),
        onTraceId: (traceId) => {
          upsertCompareCandidate(targetMessageId, {
            modelKey: compareModelKey,
            modelId: selectedCompareModel.id,
            providerModelId: selectedCompareModel.provider_model_id ?? undefined,
            content: useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]?.content ?? "",
            blocks: useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]?.blocks ?? [],
            loading: true,
            traceId,
          })
        },
        onStatusEvent: (status) => {
          const currentCandidate = useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]
          upsertCompareCandidate(targetMessageId, {
            modelKey: compareModelKey,
            modelId: selectedCompareModel.id,
            providerModelId: selectedCompareModel.provider_model_id ?? undefined,
            content: currentCandidate?.content ?? "",
            blocks: currentCandidate?.blocks ?? [],
            loading: true,
            traceId: currentCandidate?.traceId,
            errorMessage: null,
            statusStage: status.stage,
            statusCode: status.code,
            statusMeta: status.meta,
          })
        },
        getCurrentBlocks: () => {
          const candidate = useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]
          return candidate?.blocks ?? []
        },
        onRequestError: (message, errorCode) => {
          const currentCandidate = useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]
          upsertCompareCandidate(targetMessageId, {
            modelKey: compareModelKey,
            modelId: selectedCompareModel.id,
            providerModelId: selectedCompareModel.provider_model_id ?? undefined,
            content: currentCandidate?.content ?? "",
            blocks: currentCandidate?.blocks ?? [],
            loading: false,
            traceId: currentCandidate?.traceId,
            errorMessage: errorCode ? `${errorCode}: ${message}` : message,
            statusStage: currentCandidate?.statusStage ?? null,
            statusCode: currentCandidate?.statusCode ?? null,
            statusMeta: currentCandidate?.statusMeta ?? null,
          })
        },
      })

      const currentCandidate = useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]
      upsertCompareCandidate(targetMessageId, {
        modelKey: compareModelKey,
        modelId: selectedCompareModel.id,
        providerModelId: selectedCompareModel.provider_model_id ?? undefined,
        content: currentCandidate?.content ?? "",
        blocks: currentCandidate?.blocks ?? [],
        loading: false,
        traceId: currentCandidate?.traceId,
        errorMessage: null,
        statusStage: currentCandidate?.statusStage ?? null,
        statusCode: currentCandidate?.statusCode ?? null,
        statusMeta: currentCandidate?.statusMeta ?? null,
      })
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Request failed"
      const currentCandidate = useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]
      upsertCompareCandidate(targetMessageId, {
        modelKey: compareModelKey,
        modelId: selectedCompareModel.id,
        providerModelId: selectedCompareModel.provider_model_id ?? undefined,
        content: currentCandidate?.content ?? "",
        blocks:
          currentCandidate?.blocks?.length
            ? currentCandidate.blocks
            : [createErrorBlock(`${targetMessageId}-${compareModelKey}`, message)],
        loading: false,
        traceId: currentCandidate?.traceId,
        errorMessage: message,
        statusStage: currentCandidate?.statusStage ?? null,
        statusCode: currentCandidate?.statusCode ?? null,
        statusMeta: currentCandidate?.statusMeta ?? null,
      })
      setErrorMessage(message)
    }
  }, [
    isTauriRuntime,
    findModelByValue,
    setErrorMessage,
    config,
    ensureCompareState,
    setCompareActiveCandidate,
    selectedAssistantId,
    resolveCurrentSessionId,
    upsertCompareCandidate,
    runStreamedRequest,
    appendCompareCandidateBlocks,
  ])

  const finalizeCompareWinner = useCallback(async (targetMessageId: string, modelKey: string) => {
    const compareState = useChatStore.getState().compareByMessageId[targetMessageId]
    const candidate = compareState?.candidates[modelKey]
    if (!compareState || !candidate || candidate.loading) return

    if (candidate.baseline) {
      clearCompareState(targetMessageId)
      return
    }

    const { sessionStorageKey } = resolveChatRequestContext({
      isTauriRuntime,
      selectedAssistantId,
    })
    const resolvedSessionId = resolveCurrentSessionId(sessionStorageKey)
    if (!resolvedSessionId) {
      setErrorMessage("Session not found")
      return
    }

    setCompareFinalizing(targetMessageId, true)
    try {
      const response = await finalizeDesktopLocalCompare({
        session_id: resolvedSessionId,
        model_id: candidate.modelId,
        provider_model_id: candidate.providerModelId,
        content: candidate.content,
        blocks: candidate.blocks as unknown[],
      })
      if (response.session_id) {
        setSessionId(response.session_id)
      }

      const normalized = normalizeConversationMessages(
        [response.message as ConversationMessage],
        { idPrefix: response.session_id ?? "compare" }
      )[0]
      const currentMessage = useChatStore.getState().messages.find((message) => message.id === targetMessageId)
      if (!currentMessage) {
        clearCompareState(targetMessageId)
        return
      }

      replaceAssistantMessage(targetMessageId, {
        ...(normalized ?? currentMessage),
        content: candidate.content,
        blocks: candidate.blocks,
        metaInfo: {
          ...(normalized?.metaInfo ?? currentMessage.metaInfo ?? {}),
          model_id: candidate.modelId,
          provider_model_id: candidate.providerModelId,
          compare_winner: true,
          replaced_turn_index: response.replaced_turn_index,
        },
      })
      clearCompareState(targetMessageId)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Finalize compare failed"
      setErrorMessage(message)
      setCompareFinalizing(targetMessageId, false)
      return
    }

    setCompareFinalizing(targetMessageId, false)
  }, [
    selectedAssistantId,
    clearCompareState,
    isTauriRuntime,
    replaceAssistantMessage,
    resolveCurrentSessionId,
    setCompareFinalizing,
    setErrorMessage,
    setSessionId,
  ])

  const hasInterruptedGeneration = useMemo(() => {
    if (!interruptedAssistantMessageId) return false
    return messages.some(
      (message) =>
        message.id === interruptedAssistantMessageId && message.role === "assistant"
    )
  }, [interruptedAssistantMessageId, messages])

  const continueInterruptedGeneration = useCallback(async () => {
    const targetMessageId = interruptedAssistantMessageId
    if (!targetMessageId) return
    const targetExists = useChatStore
      .getState()
      .messages.some(
        (message) =>
          message.id === targetMessageId && message.role === "assistant"
      )
    if (!targetExists) {
      setInterruptedAssistantMessageId(null)
      return
    }
    setInterruptedAssistantMessageId(null)
    await regenerateMessage(targetMessageId)
  }, [interruptedAssistantMessageId, regenerateMessage])

  return {
    sendMessage,
    regenerateMessage,
    compareWithModel,
    finalizeCompareWinner,
    loadHistoryBySession,
    loadMoreHistory,
    resetSession,
    cancelActiveRequest,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  }
}
