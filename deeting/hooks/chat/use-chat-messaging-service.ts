"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  cancelChatCompletion,
  cancelDesktopLocalChatCompletion,
  streamChatCompletion,
  streamDesktopLocalChatCompletion,
  type ChatMessage,
} from "@/lib/api/chat"
import { buildMessageContent, resolveLocalAssetUrlsInContent } from "@/lib/chat/message-content"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"
import { createRequestId } from "@/lib/chat/request-id"

const WEB_SESSION_STORAGE_KEY = "deeting-chat-session:router"

export function resolveAssistantRequestContext({
  isTauriRuntime,
  activeAssistantId,
}: {
  isTauriRuntime: boolean
  activeAssistantId?: string | null
}) {
  if (!activeAssistantId) {
    return { assistantId: undefined, sessionStorageKey: WEB_SESSION_STORAGE_KEY }
  }
  if (!isTauriRuntime) {
    return { assistantId: activeAssistantId, sessionStorageKey: WEB_SESSION_STORAGE_KEY }
  }
  return {
    assistantId: activeAssistantId,
    sessionStorageKey: `deeting-chat-session:${activeAssistantId}`,
  }
}
import { resolveSessionIdFromBrowser } from "@/lib/chat/session-storage"
import {
  fetchConversationHistory,
} from "@/lib/api/conversations"
import type { ConversationMessage } from "@/lib/api/conversations"
import { signAssets } from "@/lib/api/media-assets"
import { useChatStore, type Message } from "@/store/chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"

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

const resolveMessageAttachments = async (messages: Message[], isTauri = false) => {
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

  const [signedResult, ...localResults] = await Promise.all([
    objectKeys.size
      ? signAssets(Array.from(objectKeys)).catch(() => ({ assets: [] as { object_key: string; asset_url: string }[] }))
      : Promise.resolve({ assets: [] as { object_key: string; asset_url: string }[] }),
    ...localAssets.map((la) => resolveLocalChatAsset(la.sha256, la.type)),
  ])

  const urlMap = new Map(
    signedResult.assets.map((item) => [item.object_key, item.asset_url])
  )

  const localUrlMap = new Map<string, string>()
  localAssets.forEach((la, i) => {
    const dataUrl = localResults[i]
    if (dataUrl) localUrlMap.set(la.sha256, dataUrl)
  })

  return messages.map((message, msgIdx) => {
    if (!message.attachments?.length) return message
    const attachments = message.attachments.map((attachment, attIdx) => {
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
    agent,
    agentId,
    streamEnabled,
    setInput,
    clearAttachments,
    setMessages,
    mergeMessageMeta,
    appendMessageBlocks,
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

  const sendMessage = useCallback(async (sessionIdOverride?: string | null) => {
    const trimmedInput = input.trim()
    if (!trimmedInput && attachments.length === 0) return

    const selectedModel =
      models.find((model) => model.provider_model_id === config.model || model.id === config.model) ??
      models[0]
    const preferLocalRoute =
      isTauriRuntime && (selectedModel?.request_route ?? "local_invoke") === "local_invoke"
    const activeAssistant = agent
    if (!selectedModel) return

    const { assistantId, sessionStorageKey } = resolveAssistantRequestContext({
      isTauriRuntime,
      activeAssistantId: agentId,
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

    // 更新 UI 状态
    setMessages([...messages, userMessage, assistantMessage])
    setInput("")
    clearAttachments()
    setIsLoading(true)
    clearStatus()

    let resolvedSessionId = sessionIdOverride ?? useChatStore.getState().sessionId ?? sessionId
    const storageKey = sessionStorageKey
    if (!resolvedSessionId) {
      const fallbackSessionId = resolveSessionIdFromBrowser(storageKey, { allowStorageFallback: false })
      if (fallbackSessionId) {
        resolvedSessionId = fallbackSessionId
        setSessionId(resolvedSessionId)
      }
    }
    try {
      if (preferLocalRoute && !resolvedSessionId) {
        throw new Error("Session not found")
      }

      // Local route: Rust orchestrator injects assistant persona; skip frontend prepend to avoid duplication.
      const requestMessages = buildChatMessages(
        [...messages, userMessage],
        preferLocalRoute ? undefined : activeAssistant?.systemPrompt,
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

      const streamFn = preferLocalRoute ? streamDesktopLocalChatCompletion : streamChatCompletion
      const streamedText = await streamFn(
        {
          ...payload,
          stream: streamEnabled,
          status_stream: true,
          session_id: resolvedSessionId ?? undefined,
        },
        {
          onDelta: (delta) => {
            if (!delta) return
            appendMessageBlocks(assistantMessageId, [
              { type: "text", content: delta, streamState: "streaming" } as MessageBlock,
            ])
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
                blocks?: unknown
                message?: string
                error_code?: string
                trace_id?: string | null
              }
              if (payload.type === "status") {
                setStatus({
                  stage: payload.stage ?? null,
                  code: payload.code ?? null,
                  meta: typeof payload.meta === "object" && payload.meta ? (payload.meta as Record<string, unknown>) : null,
                })
                // 如果状态消息带了 trace_id，也记录下来
                const traceId = payload.trace_id
                if (traceId) {
                  mergeMessageMeta(assistantMessageId, { trace_id: traceId })
                }
                return
              }
              if (payload.type === "error") {
                const message = payload.message || "Request failed"
                appendMessageBlocks(assistantMessageId, [
                  {
                    id: `${assistantMessageId}-error`,
                    type: "error",
                    message,
                    streamState: "completed",
                    displayMode: "bubble",
                  },
                ] as MessageBlock[])
                setErrorMessage(payload.error_code ? `${payload.error_code}: ${message}` : message)
                return
              }
              if (payload.type === "blocks") {
                const blocks = payload.blocks
                if (Array.isArray(blocks)) {
                  appendMessageBlocks(
                    assistantMessageId,
                    blocks.filter(isValidBlock) as MessageBlock[]
                  )
                }
                return
              }
            }

            // ─── Final response body (non-status/blocks/error event) ───
            // 当 stream=false 时，后端最终会返回完整的 OpenAI 格式响应体。
            // 从 meta_info.blocks 中提取尚未流式到达的 blocks（thought, text），
            // 使用 appendMessageBlocks 追加，避免 setMessageBlocks 全量替换导致的渲染问题。
            let responseBody: Record<string, unknown> | null = null
            if (typeof data === "string") {
              // safeJson 可能因代理折行导致解析失败，这里重试一次
              try { responseBody = JSON.parse(data) } catch { /* ignore */ }
            } else if (data && typeof data === "object") {
              responseBody = data as Record<string, unknown>
            }
            if (!responseBody) return

            // 提取 session_id 和 trace_id
            if (typeof responseBody.session_id === "string") {
              setSessionId(responseBody.session_id)
            }
            if (typeof responseBody.trace_id === "string") {
              mergeMessageMeta(assistantMessageId, { trace_id: responseBody.trace_id })
            }

            // 从 choices[0].message.meta_info.blocks 提取新 blocks
            const choices = Array.isArray(responseBody.choices) ? responseBody.choices : []
            const firstChoice = choices[0]
            const respMessage = firstChoice && typeof firstChoice === "object"
              ? (firstChoice as Record<string, unknown>).message
              : null
            if (respMessage && typeof respMessage === "object") {
              const msgObj = respMessage as Record<string, unknown>
              const metaInfo = msgObj.meta_info && typeof msgObj.meta_info === "object"
                ? (msgObj.meta_info as Record<string, unknown>)
                : null
              const metaBlocks = Array.isArray(metaInfo?.blocks)
                ? ((metaInfo!.blocks as unknown[]).filter(isValidBlock) as MessageBlock[])
                : []

              // 只追加尚未通过流式 blocks 事件到达的 blocks（跳过 tool_call/tool_result）
              const newBlocks: MessageBlock[] = metaBlocks.filter(
                (b) => b.type !== "tool_call" && b.type !== "tool_result"
              )

              // 兜底：如果 meta_info.blocks 为空，从 reasoning_content 和 content 构建
              if (metaBlocks.length === 0) {
                const reasoning = typeof msgObj.reasoning_content === "string" ? msgObj.reasoning_content : ""
                const textContent = typeof msgObj.content === "string" ? msgObj.content : ""
                if (reasoning.trim()) {
                  newBlocks.push({ type: "thought", content: reasoning } as MessageBlock)
                }
                if (textContent.trim()) {
                  newBlocks.push({ type: "text", content: textContent } as MessageBlock)
                }
              } else if (!newBlocks.some((b) => b.type === "text")) {
                // meta_info.blocks 存在但没有 text block，从 content 兜底
                const textContent = typeof msgObj.content === "string" ? msgObj.content : ""
                if (textContent.trim()) {
                  newBlocks.push({ type: "text", content: textContent } as MessageBlock)
                }
              }

              if (newBlocks.length > 0) {
                appendMessageBlocks(assistantMessageId, newBlocks)
              }
            }
          },
        },
        {
          onCancel: (cancel) => {
            cancelRef.current = cancel
          },
        }
      )

      const latest = useChatStore.getState().messages.find(
        (m) => m.id === assistantMessageId
      )
      const latestBlocks = Array.isArray(latest?.blocks)
        ? (latest.blocks as MessageBlock[])
        : []
      if (
        streamedText.trim().length > 0 &&
        !hasRenderableTextBlock(latestBlocks) &&
        !hasRenderableNonToolBlocks(latestBlocks)
      ) {
        appendMessageBlocks(assistantMessageId, [
          { type: "text", content: streamedText } as MessageBlock,
        ])
      }
    } catch (error) {
      if (interruptedMessageIdsRef.current.has(assistantMessageId)) {
        return
      }
      const message = error instanceof Error && error.message ? error.message : "Request failed"
      appendMessageBlocks(assistantMessageId, [
        {
          id: `${assistantMessageId}-error`,
          type: "error",
          message,
          streamState: "completed",
          displayMode: "bubble",
        },
      ] as MessageBlock[])
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
    agent,
    agentId,
    streamEnabled,
    sessionId,
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
    const activeAssistant = agent
    if (!selectedModel) return

    const { assistantId, sessionStorageKey } = resolveAssistantRequestContext({
      isTauriRuntime,
      activeAssistantId: agentId,
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

    setMessages([...messagesBeforeTarget, newAssistantMessage])
    setIsLoading(true)
    clearStatus()

    // 构建请求消息（不含被删除的 assistant 消息）
    let resolvedSessionId = sessionId
    const storageKey = sessionStorageKey
    if (!resolvedSessionId) {
      const fallbackSessionId = resolveSessionIdFromBrowser(storageKey, { allowStorageFallback: false })
      if (fallbackSessionId) {
        resolvedSessionId = fallbackSessionId
        setSessionId(resolvedSessionId)
      }
    }
    try {
      if (preferLocalRoute && !resolvedSessionId) {
        throw new Error("Session not found")
      }

      const requestMessages = buildChatMessages(
        messagesBeforeTarget,
        preferLocalRoute ? undefined : activeAssistant?.systemPrompt,
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

      const streamFn = preferLocalRoute ? streamDesktopLocalChatCompletion : streamChatCompletion
      const streamedText = await streamFn(
        {
          ...payload,
          stream: streamEnabled,
          status_stream: true,
          session_id: resolvedSessionId ?? undefined,
        },
        {
          onDelta: (delta) => {
            if (!delta) return
            appendMessageBlocks(assistantMessageId, [
              { type: "text", content: delta, streamState: "streaming" } as MessageBlock,
            ])
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
                blocks?: unknown
                message?: string
                error_code?: string
                trace_id?: string | null
              }
              if (payload.type === "status") {
                setStatus({
                  stage: payload.stage ?? null,
                  code: payload.code ?? null,
                  meta: typeof payload.meta === "object" && payload.meta ? (payload.meta as Record<string, unknown>) : null,
                })
                const traceId = payload.trace_id
                if (traceId) {
                  mergeMessageMeta(assistantMessageId, { trace_id: traceId })
                }
                return
              }
              if (payload.type === "error") {
                const message = payload.message || "Request failed"
                appendMessageBlocks(assistantMessageId, [
                  {
                    id: `${assistantMessageId}-error`,
                    type: "error",
                    message,
                    streamState: "completed",
                    displayMode: "bubble",
                  },
                ] as MessageBlock[])
                setErrorMessage(payload.error_code ? `${payload.error_code}: ${message}` : message)
                return
              }
              if (payload.type === "blocks") {
                const blocks = payload.blocks
                if (Array.isArray(blocks)) {
                  appendMessageBlocks(
                    assistantMessageId,
                    blocks.filter(isValidBlock) as MessageBlock[]
                  )
                }
                return
              }
            }

            let responseBody: Record<string, unknown> | null = null
            if (typeof data === "string") {
              try { responseBody = JSON.parse(data) } catch { /* ignore */ }
            } else if (data && typeof data === "object") {
              responseBody = data as Record<string, unknown>
            }
            if (!responseBody) return

            if (typeof responseBody.session_id === "string") {
              setSessionId(responseBody.session_id)
            }
            if (typeof responseBody.trace_id === "string") {
              mergeMessageMeta(assistantMessageId, { trace_id: responseBody.trace_id })
            }

            const choices = Array.isArray(responseBody.choices) ? responseBody.choices : []
            const firstChoice = choices[0]
            const respMessage = firstChoice && typeof firstChoice === "object"
              ? (firstChoice as Record<string, unknown>).message
              : null
            if (respMessage && typeof respMessage === "object") {
              const msgObj = respMessage as Record<string, unknown>
              const metaInfo = msgObj.meta_info && typeof msgObj.meta_info === "object"
                ? (msgObj.meta_info as Record<string, unknown>)
                : null
              const metaBlocks = Array.isArray(metaInfo?.blocks)
                ? ((metaInfo!.blocks as unknown[]).filter(isValidBlock) as MessageBlock[])
                : []

              const newBlocks: MessageBlock[] = metaBlocks.filter(
                (b) => b.type !== "tool_call" && b.type !== "tool_result"
              )

              if (metaBlocks.length === 0) {
                const reasoning = typeof msgObj.reasoning_content === "string" ? msgObj.reasoning_content : ""
                const textContent = typeof msgObj.content === "string" ? msgObj.content : ""
                if (reasoning.trim()) {
                  newBlocks.push({ type: "thought", content: reasoning } as MessageBlock)
                }
                if (textContent.trim()) {
                  newBlocks.push({ type: "text", content: textContent } as MessageBlock)
                }
              } else if (!newBlocks.some((b) => b.type === "text")) {
                const textContent = typeof msgObj.content === "string" ? msgObj.content : ""
                if (textContent.trim()) {
                  newBlocks.push({ type: "text", content: textContent } as MessageBlock)
                }
              }

              if (newBlocks.length > 0) {
                appendMessageBlocks(assistantMessageId, newBlocks)
              }
            }
          },
        },
        {
          onCancel: (cancel) => {
            cancelRef.current = cancel
          },
        }
      )

      const latest = useChatStore.getState().messages.find(
        (m) => m.id === assistantMessageId
      )
      const latestBlocks = Array.isArray(latest?.blocks)
        ? (latest.blocks as MessageBlock[])
        : []
      if (
        streamedText.trim().length > 0 &&
        !hasRenderableTextBlock(latestBlocks) &&
        !hasRenderableNonToolBlocks(latestBlocks)
      ) {
        appendMessageBlocks(assistantMessageId, [
          { type: "text", content: streamedText } as MessageBlock,
        ])
      }
    } catch (error) {
      if (interruptedMessageIdsRef.current.has(assistantMessageId)) {
        return
      }
      const message = error instanceof Error && error.message ? error.message : "Request failed"
      appendMessageBlocks(assistantMessageId, [
        {
          id: `${assistantMessageId}-error`,
          type: "error",
          message,
          streamState: "completed",
          displayMode: "bubble",
        },
      ] as MessageBlock[])
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
    agent,
    agentId,
    streamEnabled,
    sessionId,
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
    loadHistoryBySession,
    loadMoreHistory,
    resetSession,
    cancelActiveRequest,
    hasInterruptedGeneration,
    continueInterruptedGeneration,
  }
}
