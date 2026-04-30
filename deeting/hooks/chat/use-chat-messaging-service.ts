"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  cancelDesktopLocalChatCompletion,
  finalizeDesktopLocalCompare,
  streamDesktopLocalChatCompletion,
  type ChatMessage,
} from "@/lib/api/chat"
import { buildMessageContent, resolveLocalAssetUrlsInContent } from "@/lib/chat/message-content"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"
import {
  loadConversationHistoryPage,
  resolveMessageAttachments,
} from "@/lib/chat/history-loader"
import { createRequestId } from "@/lib/chat/request-id"
import { useI18n } from "@/hooks/use-i18n"
import { useLanguageStore } from "@/store/language-store"
import {
  isDesktopLocalModel,
  matchesChatModelSelectionValue,
} from "@/lib/api/models"

const WEB_SESSION_STORAGE_KEY = "deeting-chat-session:router"

export function resolveChatRequestContext({
  isTauriRuntime: _isTauriRuntime,
}: {
  isTauriRuntime: boolean
}) {
  void _isTauriRuntime
  return { assistantId: undefined, sessionStorageKey: WEB_SESSION_STORAGE_KEY }
}
import { resolveSessionIdFromBrowser } from "@/lib/chat/session-storage"
import { buildChatPageContextSystemPrompt } from "@/lib/browser/page-context"
import type { ConversationMessage } from "@/lib/api/conversations"
import {
  useChatStore,
  type CompareCandidate,
  type Message,
  type PendingTakeoverRequestedAction,
} from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useWorkspaceStore } from "@/store/workspace-store"
import type { HtmlRuntimeRefreshSpec, MessageBlock } from "@/lib/chat/message-protocol"
import { extractAssistantTextFromBlocks } from "@/lib/chat/message-blocks"
import {
  buildExecutionLifecycleBlocksFromMessage,
  extractExecutionTreeBlockFromBlocks,
  extractExecutionTreeFromMessage,
  extractRootExecutionIdFromMessage,
  extractWorkflowRunIdFromMessage,
  extractWorkflowRunIdFromExecutionTree,
} from "@/lib/chat/execution-tree"
import { listCustomTaskAgents } from "@/lib/api/custom-task-agents"
import { resolveLeadingTaskAgentMention } from "./task-agent-mention"
import {
  deriveAssistantActivityState,
} from "@/lib/chat/assistant-activity"
import { deriveChatStatusUpdateForMessage } from "@/lib/chat/live-status"
import {
  buildPendingTakeoverDispatchDraft,
  isPendingTakeoverSafeBoundary,
  normalizePendingTakeoverDraft,
  type PendingTakeoverDispatchDraft,
} from "@/lib/chat/takeover"

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
      msg.role === "user" ? msg.attachments ?? [] : [],
      { preferResolvedUrls: true }
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

function buildKnowledgeSelectionMetadata(selectedKnowledgeFileIds: string[]) {
  const docIds = Array.from(
    new Set(
      selectedKnowledgeFileIds
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  )
  if (docIds.length === 0) return undefined
  return {
    knowledge: {
      doc_ids: docIds,
    },
  }
}

function buildRequestMetadata(
  selectedKnowledgeFileIds: string[],
  rootExecutionId?: string | null
) {
  const knowledge = buildKnowledgeSelectionMetadata(selectedKnowledgeFileIds)
  const normalizedRootExecutionId =
    typeof rootExecutionId === "string" && rootExecutionId.trim().length > 0
      ? rootExecutionId.trim()
      : null

  if (!knowledge && !normalizedRootExecutionId) return undefined

  return {
    ...(knowledge ?? {}),
    ...(normalizedRootExecutionId
      ? {
          execution: {
            root_execution_id: normalizedRootExecutionId,
          },
        }
      : {}),
  }
}

function pageContextsMatch(
  left: PendingTakeoverDispatchDraft["pageContext"],
  right: PendingTakeoverDispatchDraft["pageContext"]
) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.tabId !== right.tabId) return false
  if (left.title !== right.title) return false
  if (left.url !== right.url) return false
  if (left.host !== right.host) return false
  if (left.mainTextSnippet !== right.mainTextSnippet) return false
  if (left.visibleTextSnippet !== right.visibleTextSnippet) return false
  if (left.headingsSummary.length !== right.headingsSummary.length) return false
  return left.headingsSummary.every((heading, index) => heading === right.headingsSummary[index])
}

function resolveExecutionRootForFollowup(message: Message | undefined | null) {
  if (!message) return undefined
  return extractRootExecutionIdFromMessage(message) ?? undefined
}

async function resolveExplicitTaskAgentIdForInput(input: string) {
  const trimmedInput = input.trim()
  if (!trimmedInput) return undefined

  const localAgents = await listCustomTaskAgents()
  const resolvedMention = resolveLeadingTaskAgentMention(
    trimmedInput,
    localAgents.map((agent) => ({ id: agent.id, name: agent.name })),
  )
  return resolvedMention?.agent?.id?.trim() || undefined
}

function resolveRequestedMaxTokens(value: number | null | undefined) {
  return typeof value === "number" && value > 0 ? value : undefined
}

function isValidBlock(block: unknown): block is MessageBlock {
  return Boolean(
    block &&
      typeof block === "object" &&
      "type" in (block as Record<string, unknown>)
  )
}

function syncAssistantActivityStatus({
  assistantMessageId,
  setStatus,
  clearStatus,
  setActiveMessageId,
}: {
  assistantMessageId: string
  setStatus: (status: {
    messageId?: string | null
    stage?: string | null
    code?: string | null
    meta?: Record<string, unknown> | null
  }) => void
  clearStatus: () => void
  setActiveMessageId: (messageId: string | null) => void
}) {
  const status = deriveChatStatusUpdateForMessage(
    useChatStore.getState().messages,
    assistantMessageId
  )
  if (!status) {
    setActiveMessageId(null)
    clearStatus()
    return
  }
  setActiveMessageId(assistantMessageId)
  setStatus(status)
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

function extractAssistantMetaBlocks(responseBody: Record<string, unknown>): MessageBlock[] {
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
  return Array.isArray(metaInfo?.blocks)
    ? ((metaInfo.blocks as unknown[]).filter(isValidBlock) as MessageBlock[])
    : []
}

export function extractAssistantResponseToolBlocks(responseBody: Record<string, unknown>): MessageBlock[] {
  return extractAssistantMetaBlocks(responseBody).filter(
    (block) => block.type === "tool_call" || block.type === "tool_result"
  )
}

function finalResponseBlockKey(block: MessageBlock): string {
  const record = { ...(block as unknown as Record<string, unknown>) }
  delete record.id
  delete record.streamState
  delete record.displayMode
  return JSON.stringify(record)
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
  const metaBlocks = extractAssistantMetaBlocks(responseBody)
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

  const responseHasOnlyText = responseBlocks.every((block) => block.type === "text")
  if (!responseHasOnlyText) {
    if (!receivedStructuredBlocks) return true
    const currentBlockKeys = new Set(currentBlocks.map(finalResponseBlockKey))
    return responseBlocks.some((block) => !currentBlockKeys.has(finalResponseBlockKey(block)))
  }

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

function formatChatRuntimeErrorMessage(
  t: (key: string) => string,
  message: string,
  errorCode?: string | null
) {
  switch ((errorCode || "").trim()) {
    case "IMAGE_AGENT_INPUT_REQUIRED":
      return t("error.imageAgentInputRequired")
    case "IMAGE_AGENT_INPUT_LIMIT_EXCEEDED":
      return t("error.imageAgentInputLimitExceeded")
    case "IMAGE_AGENT_UPSTREAM_INPUT_LIMIT_EXCEEDED":
      return t("error.imageAgentUpstreamInputLimitExceeded")
    case "IMAGE_AGENT_INPUT_RESOLUTION_FAILED":
      return t("error.imageAgentInputResolutionFailed")
    default:
      return message
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function extractWorkflowRunIdFromBlocks(blocks: MessageBlock[]): string | null {
  const executionTreeBlock = extractExecutionTreeBlockFromBlocks(blocks)
  if (executionTreeBlock?.type === "ui") {
    const runId = extractWorkflowRunIdFromExecutionTree(
      executionTreeBlock.payload && typeof executionTreeBlock.payload === "object"
        ? (executionTreeBlock.payload as Record<string, unknown>)
        : null
    )
    if (runId) return runId
  }

  for (const block of blocks) {
    if (block.type === "tool_result") {
      const result = asRecord(block.result)
      const runId = asTrimmedString(result?.workflow_run_id)
      if (runId) return runId
    }

    if (block.type === "ui") {
      const metadata = asRecord(block.metadata)
      const runId = asTrimmedString(metadata?.workflow_run_id)
      if (runId) return runId
    }
  }

  return null
}

export function buildStatusRepeatKey(stage: string | null, code: string | null) {
  return `${stage ?? "unknown_stage"}::${code ?? "unknown_code"}`
}

export function shouldEmitStatusRepeat(repeatCount: number) {
  if (repeatCount <= 3) return true
  if (repeatCount <= 10) return repeatCount % 2 === 0
  return repeatCount % 5 === 0
}

function getAssistantBlocksForCandidate(message: Message): MessageBlock[] {
  if (Array.isArray(message.blocks) && message.blocks.length > 0) {
    return message.blocks as MessageBlock[]
  }
  const executionBlocks = buildExecutionLifecycleBlocksFromMessage(message, {
    id: `${message.id}-execution-tree`,
    title: "Delegated Execution",
    displayMode: "bubble",
    streamState: "completed",
  })
  if (executionBlocks.length > 0) return executionBlocks
  return []
}

function getAssistantShadowContentForCandidate(message: Message): string {
  return extractAssistantTextFromBlocks(getAssistantBlocksForCandidate(message))
}

export function useChatMessagingService() {
  const t = useI18n("chat")
  const locale = useLanguageStore((state) => state.language)
  const cancelRef = useRef<(() => void) | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const activeRequestRouteRef = useRef<"local_gateway" | null>(null)
  const activeAssistantMessageIdRef = useRef<string | null>(null)
  const interruptedMessageIdsRef = useRef<Set<string>>(new Set())
  const statusRepeatRef = useRef<{ key: string; repeatCount: number }>({
    key: "",
    repeatCount: 0,
  })
  const openedWorkflowRunIdsRef = useRef<Set<string>>(new Set())
  const pendingTakeoverDispatchingRef = useRef(false)
  const {
    sessionId,
    isLoading,
    statusCode,
    pendingTakeover,
    pendingTakeoverRequestedAction,
    setSessionId,
    setIsLoading,
    setErrorMessage,
    setStatus,
    clearStatus,
    setPendingTakeover,
    setPendingTakeoverRequestedAction,
    clearPendingTakeover,
    interruptedMessageId,
    setInterruptedMessageId,
    setActiveMessageId,
    resetSession: resetRuntimeSession,
    loadHistory: loadRuntimeHistory,
    setHistoryState,
  } = useChatRuntimeStore()
  const {
    input,
    attachments,
    selectedKnowledgeFileIds,
    pageContext,
    messages,
    config,
    models,
    streamEnabled,
    setInput,
    setSelectedKnowledgeFileIds,
    clearAttachments,
    clearPageContext,
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
  } = useChatStore()
  const openWorkspaceView = useWorkspaceStore((state) => state.openView)

  const isTauriRuntime = useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  )

  const openWorkflowRun = useCallback((runId: string) => {
    const normalizedRunId = runId.trim()
    if (!normalizedRunId) return
    if (openedWorkflowRunIdsRef.current.has(normalizedRunId)) return

    openedWorkflowRunIdsRef.current.add(normalizedRunId)
    openWorkspaceView({
      id: `workflow-${normalizedRunId}`,
      type: "native-canvas",
      title: "Workflow",
      keepAlive: true,
      content: {
        viewType: "workflow",
        runId: normalizedRunId,
      },
    })
  }, [openWorkspaceView])

  const loadHistoryBySession = useCallback(async (sessionId: string) => {
    if (!sessionId) return
    await loadRuntimeHistory(sessionId)
  }, [loadRuntimeHistory])

  const resetSession = useCallback(() => {
    resetRuntimeSession()
  }, [resetRuntimeSession])

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
      const page = await loadConversationHistoryPage(sessionId, {
        cursor: historyCursor ?? undefined,
        limit: 30,
        isTauriRuntime,
        onAttachmentResolutionError: () => {
          if (!isTauriRuntime) {
            setErrorMessage("i18n:input.image.errorSign")
          }
        },
      })
      const currentMessages = useChatStore.getState().messages
      setMessages([...page.messages, ...currentMessages])
      setHistoryState({
        cursor: page.nextCursor,
        hasMore: page.hasMore,
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
      setInterruptedMessageId(activeAssistantMessageId)
    }
    cancelRef.current?.()
    cancelRef.current = null
    requestIdRef.current = null
    activeAssistantMessageIdRef.current = null
    setActiveMessageId(null)
    setIsLoading(false)
    clearStatus()
    if (!requestId) return
    try {
      await cancelDesktopLocalChatCompletion(requestId)
    } catch {
      // ignore cancel errors
    } finally {
      activeRequestRouteRef.current = null
    }
  }, [clearStatus, setActiveMessageId, setInterruptedMessageId, setIsLoading])

  const findModelByValue = useCallback((value?: string | null) => {
    if (!value) return null
    return (
      models.find((model) => model.provider_model_id === value || model.id === value) ?? null
    )
  }, [models])

  const resolveCurrentSessionId = useCallback((sessionStorageKey: string, fallback?: string | null) => {
    let resolved = fallback ?? useChatRuntimeStore.getState().sessionId ?? sessionId
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
    trackActiveRequest = false,
    errorBlockIdBase,
    onBlocks,
    onTraceId,
    onSessionResolved,
    onStatusEvent,
    getCurrentBlocks,
    onRequestError,
  }: {
    payload: Parameters<typeof streamDesktopLocalChatCompletion>[0]
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
    statusRepeatRef.current = { key: "", repeatCount: 0 }
    let receivedStructuredBlocks = false
    const streamedText = await streamDesktopLocalChatCompletion(
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
              const stage = streamMessage.stage ?? null
              const code = streamMessage.code ?? null
              const incomingMeta =
                typeof streamMessage.meta === "object" && streamMessage.meta
                  ? (streamMessage.meta as Record<string, unknown>)
                  : null
              const statusKey = buildStatusRepeatKey(stage, code)
              if (statusRepeatRef.current.key === statusKey) {
                statusRepeatRef.current = {
                  key: statusKey,
                  repeatCount: statusRepeatRef.current.repeatCount + 1,
                }
              } else {
                statusRepeatRef.current = {
                  key: statusKey,
                  repeatCount: 1,
                }
              }
              const repeatCount = statusRepeatRef.current.repeatCount
              const shouldEmit = shouldEmitStatusRepeat(repeatCount)
              if (shouldEmit) {
                onStatusEvent?.({
                  stage,
                  code,
                  meta: incomingMeta
                    ? { ...incomingMeta, repeat_count: repeatCount }
                    : { repeat_count: repeatCount },
                })
              }
              if (streamMessage.trace_id) {
                onTraceId?.(streamMessage.trace_id)
              }
              return
            }
            if (streamMessage.type === "error") {
              const message = streamMessage.message || "Request failed"
              const localizedMessage = formatChatRuntimeErrorMessage(
                t,
                message,
                streamMessage.error_code ?? null
              )
              onBlocks([createErrorBlock(errorBlockIdBase, localizedMessage)])
              onRequestError(localizedMessage, streamMessage.error_code ?? null)
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
                    preferLocalRoute: true,
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

          const responseToolBlocks = extractAssistantResponseToolBlocks(responseBody)
          if (responseToolBlocks.length > 0) {
            onBlocks(responseToolBlocks)
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
        : undefined,
      locale ?? undefined
    )

    const latestBlocks = getCurrentBlocks()
    if (
      streamedText.trim().length > 0 &&
      !hasRenderableTextBlock(latestBlocks) &&
      !hasRenderableNonToolBlocks(latestBlocks)
    ) {
      onBlocks([{ type: "text", content: streamedText } as MessageBlock])
    }
  }, [streamEnabled, t])

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

  const composerMatchesDraft = useCallback((draft: PendingTakeoverDispatchDraft) => {
    const currentState = useChatStore.getState()
    const normalizedCurrent = normalizePendingTakeoverDraft({
      input: currentState.input,
      attachments: currentState.attachments,
      selectedKnowledgeFileIds: currentState.selectedKnowledgeFileIds,
      pageContext: currentState.pageContext,
    })
    const normalizedDraft = normalizePendingTakeoverDraft(draft)
    if (!normalizedCurrent || !normalizedDraft) return false
    if (normalizedCurrent.input !== normalizedDraft.input) return false
    if (normalizedCurrent.attachments.length !== normalizedDraft.attachments.length) return false
    if (
      normalizedCurrent.attachments.some((attachment, index) => {
        const nextAttachment = normalizedDraft.attachments[index]
        return (
          attachment.id !== nextAttachment?.id ||
          attachment.fileId !== nextAttachment?.fileId ||
          attachment.sha256 !== nextAttachment?.sha256 ||
          attachment.url !== nextAttachment?.url
        )
      })
    ) {
      return false
    }
    if (
      normalizedCurrent.selectedKnowledgeFileIds.length !==
      normalizedDraft.selectedKnowledgeFileIds.length
    ) {
      return false
    }
    if (!normalizedCurrent.selectedKnowledgeFileIds.every(
      (value, index) => value === normalizedDraft.selectedKnowledgeFileIds[index]
    )) {
      return false
    }
    return pageContextsMatch(normalizedCurrent.pageContext, normalizedDraft.pageContext)
  }, [])

  const clearComposer = useCallback(() => {
    setInput("")
    clearAttachments()
    setSelectedKnowledgeFileIds([])
    clearPageContext()
  }, [setInput, clearAttachments, setSelectedKnowledgeFileIds, clearPageContext])

  const dispatchDraft = useCallback(async ({
    draft,
    sessionIdOverride,
    clearComposerMode = "never",
    explicitTaskAgentIdOverride,
  }: {
    draft: PendingTakeoverDispatchDraft
    sessionIdOverride?: string | null
    clearComposerMode?: "always" | "if_matching_draft" | "never"
    explicitTaskAgentIdOverride?: string
  }) => {
    const trimmedInput = draft.input.trim()
    if (!trimmedInput && draft.attachments.length === 0) return false

    // ==========================================
    // 如果当前请求仍在运行，先取消它再派发新的消息。
    if (useChatRuntimeStore.getState().isLoading) {
      console.log("[ChatRuntime] Interrupting active request for new message");
      await cancelActiveRequest();
    }

    const currentMessages = useChatStore.getState().messages
    let dispatchedToConversation = false
    const selectedModel =
      models.find((model) => matchesChatModelSelectionValue(model, config.model)) ??
      models[0]
    if (!isTauriRuntime) return false
    const modelSelectionMode = isDesktopLocalModel(selectedModel) ? ("pool" as const) : undefined
    if (!selectedModel) return false

    const { sessionStorageKey } = resolveChatRequestContext({
      isTauriRuntime,
    })

    let effectiveInput = trimmedInput
    let explicitTaskAgentId = explicitTaskAgentIdOverride?.trim() || undefined
    let displayInput = trimmedInput
    if (isTauriRuntime && !explicitTaskAgentId) {
      const localAgents = await listCustomTaskAgents()
      const resolvedMention = resolveLeadingTaskAgentMention(
        trimmedInput,
        localAgents.map((agent) => ({ id: agent.id, name: agent.name })),
      )
      if (resolvedMention) {
        if (!resolvedMention.mention.prompt.trim()) {
          setErrorMessage("Task agent mention requires a prompt")
          return false
        }
        if (!resolvedMention.agent) {
          setErrorMessage(
            `Task agent '${resolvedMention.mention.agentName}' not found`,
          )
          return false
        }
        explicitTaskAgentId = resolvedMention.agent.id
        effectiveInput = resolvedMention.mention.prompt.trim()
        displayInput = trimmedInput
      }
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: effectiveInput,
      attachments: draft.attachments.length ? draft.attachments : undefined,
      createdAt: Date.now(),
      metaInfo: {
        ...(displayInput !== effectiveInput
          ? {
              display_content: displayInput,
            }
          : {}),
        ...(draft.pageContext
          ? {
              page_context: {
                title: draft.pageContext.title,
                url: draft.pageContext.url,
                host: draft.pageContext.host,
              },
            }
          : {}),
      },
    }
    if (userMessage.metaInfo && Object.keys(userMessage.metaInfo).length === 0) {
      delete userMessage.metaInfo
    }
    let outgoingUserMessage = userMessage
    if (draft.attachments.length) {
      try {
        const [resolvedUserMessage] = await resolveMessageAttachments([userMessage], isTauriRuntime)
        if (resolvedUserMessage) {
          outgoingUserMessage = resolvedUserMessage
        }
      } catch (error) {
        console.warn("resolve_current_message_attachments_failed", error)
      }
    }
    const assistantMessageId = createMessageId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }
    activeAssistantMessageIdRef.current = assistantMessageId
    setInterruptedMessageId(null)
    clearAllCompareStates()

    // 先把用户消息和占位助手消息写入 UI，后续流式块会追加到该助手消息。
    setMessages([...currentMessages, outgoingUserMessage, assistantMessage])
    dispatchedToConversation = true
    if (
      clearComposerMode === "always" ||
      (clearComposerMode === "if_matching_draft" && composerMatchesDraft(draft))
    ) {
      clearComposer()
    }
    setIsLoading(true)
    setActiveMessageId(assistantMessageId)
    clearStatus()

    const resolvedSessionId = resolveCurrentSessionId(sessionStorageKey, sessionIdOverride)
    try {
      if (!resolvedSessionId) {
        throw new Error("Session not found")
      }

      // Local route: Rust orchestrator injects assistant persona; skip frontend prepend to avoid duplication.
      const requestMessages = buildChatMessages(
        [...currentMessages, outgoingUserMessage],
        draft.pageContext ? buildChatPageContextSystemPrompt(draft.pageContext) : undefined,
      )
      const payload = {
        model: selectedModel.id,
        model_selection_mode: modelSelectionMode,
        provider_model_id:
          selectedModel.provider_model_id ?? undefined,
        explicit_task_agent_id: explicitTaskAgentId,
        messages: requestMessages,
        temperature: config.temperatureEnabled ? config.temperature : undefined,
        max_tokens: undefined,
        reasoning_enabled: config.reasoningEnabled,
        reasoning_effort: config.reasoningEnabled ? config.reasoningEffort : undefined,
        request_id: createRequestId(),
        session_id: resolvedSessionId ?? undefined,
        metadata: buildKnowledgeSelectionMetadata(draft.selectedKnowledgeFileIds),
      }
      requestIdRef.current = payload.request_id ?? null
      activeRequestRouteRef.current = "local_gateway"

      await runStreamedRequest({
        payload: {
          ...payload,
          session_id: resolvedSessionId ?? undefined,
        },
        trackActiveRequest: true,
        errorBlockIdBase: assistantMessageId,
        onBlocks: (blocks) => {
          appendMessageBlocks(assistantMessageId, blocks)
          const latestMessage = useChatStore
            .getState()
            .messages.find((message) => message.id === assistantMessageId)
          const workflowRunId = latestMessage
            ? extractWorkflowRunIdFromMessage(latestMessage)
            : extractWorkflowRunIdFromBlocks(blocks)
          if (workflowRunId) {
            openWorkflowRun(workflowRunId)
          }
        },
        onTraceId: (traceId) => mergeMessageMeta(assistantMessageId, { trace_id: traceId }),
        onSessionResolved: (nextSessionId) => setSessionId(nextSessionId),
        onStatusEvent: (status) => {
          setStatus({ ...status, messageId: assistantMessageId })
          if (status.code === "upstream.response" && status.meta) {
            mergeMessageMeta(assistantMessageId, { runtime_metrics: status.meta })
          }
        },
        getCurrentBlocks: () => {
          const latest = useChatStore.getState().messages.find((message) => message.id === assistantMessageId)
          return Array.isArray(latest?.blocks) ? (latest.blocks as MessageBlock[]) : []
        },
        onRequestError: (message, errorCode) => {
          setErrorMessage(formatChatRuntimeErrorMessage(t, message, errorCode))
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
      // 只允许当前活跃的助手消息收尾，避免旧请求的 finally 清掉新请求状态。
      if (activeAssistantMessageIdRef.current === assistantMessageId) {
        setIsLoading(false)
        syncAssistantActivityStatus({
          assistantMessageId,
          setStatus,
          clearStatus,
          setActiveMessageId,
        })
        cancelRef.current = null
        requestIdRef.current = null
        activeRequestRouteRef.current = null
        activeAssistantMessageIdRef.current = null
      }
      interruptedMessageIdsRef.current.delete(assistantMessageId)
    }
    return dispatchedToConversation
  }, [
    config,
    models,
    isTauriRuntime,
    setMessages,
    mergeMessageMeta,
    appendMessageBlocks,
    openWorkflowRun,
    setSessionId,
    setIsLoading,
    setErrorMessage,
    setStatus,
    clearStatus,
    clearAllCompareStates,
    resolveCurrentSessionId,
    runStreamedRequest,
    composerMatchesDraft,
    clearComposer,
    t,
  ])

  const sendMessage = useCallback(async (sessionIdOverride?: string | null) => {
    await dispatchDraft({
      draft: {
        input,
        attachments,
        selectedKnowledgeFileIds,
        pageContext,
      },
      sessionIdOverride,
      clearComposerMode: "always",
    })
  }, [dispatchDraft, input, attachments, selectedKnowledgeFileIds, pageContext])

  const dispatchRenderRefresh = useCallback(async (refreshSpec: HtmlRuntimeRefreshSpec) => {
    if (refreshSpec.kind !== "chat_replay") return false
    const payload =
      refreshSpec.input && typeof refreshSpec.input === "object"
        ? (refreshSpec.input as Record<string, unknown>)
        : null
    const inputValue =
      typeof payload?.message === "string" ? payload.message.trim() : ""
    if (!inputValue) return false

    const explicitTaskAgentId =
      typeof payload?.explicit_task_agent_id === "string"
        ? payload.explicit_task_agent_id.trim()
        : ""
    const refreshKnowledgeFileIds = Array.isArray(payload?.selected_knowledge_file_ids)
      ? payload.selected_knowledge_file_ids
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : []

    return dispatchDraft({
      draft: {
        input: inputValue,
        attachments: [],
        selectedKnowledgeFileIds: refreshKnowledgeFileIds,
        pageContext: null,
      },
      clearComposerMode: "never",
      explicitTaskAgentIdOverride: explicitTaskAgentId || undefined,
    })
  }, [dispatchDraft])

  const queuePendingTakeoverFromCurrentDraft = useCallback((
    requestedAction?: PendingTakeoverRequestedAction | null
  ) => {
    const currentState = useChatStore.getState()
    const normalizedDraft = normalizePendingTakeoverDraft({
      input: currentState.input,
      attachments: currentState.attachments,
      selectedKnowledgeFileIds: currentState.selectedKnowledgeFileIds,
      pageContext: currentState.pageContext,
    })
    if (!normalizedDraft) return
    setPendingTakeover(normalizedDraft)
    if (requestedAction) {
      setPendingTakeoverRequestedAction(requestedAction)
    }
  }, [setPendingTakeover, setPendingTakeoverRequestedAction])

  const cancelPendingTakeover = useCallback(() => {
    clearPendingTakeover()
  }, [clearPendingTakeover])

  const markPendingTakeoverForDeferredSend = useCallback(() => {
    setPendingTakeoverRequestedAction("send_after_step")
  }, [setPendingTakeoverRequestedAction])

  const stopAndSendPendingTakeover = useCallback(async () => {
    const currentPendingTakeover = useChatRuntimeStore.getState().pendingTakeover
    if (!currentPendingTakeover) return

    pendingTakeoverDispatchingRef.current = true
    setPendingTakeoverRequestedAction(null)
    try {
      await cancelActiveRequest()
      const dispatched = await dispatchDraft({
        draft: buildPendingTakeoverDispatchDraft(currentPendingTakeover),
        clearComposerMode: "if_matching_draft",
      })
      if (dispatched) {
        clearPendingTakeover()
      }
    } finally {
      pendingTakeoverDispatchingRef.current = false
    }
  }, [
    cancelActiveRequest,
    clearPendingTakeover,
    dispatchDraft,
    setPendingTakeoverRequestedAction,
  ])

  const regenerateMessage = useCallback(async (targetMessageId: string) => {
    // Cancel the current request before starting a regeneration pass.
    if (useChatRuntimeStore.getState().isLoading) {
      await cancelActiveRequest()
    }

    // Find the assistant message being regenerated.
    const currentMessages = useChatStore.getState().messages
    const targetIndex = currentMessages.findIndex(
      (m) => m.id === targetMessageId && m.role === "assistant"
    )
    if (targetIndex < 0) return
    const targetMessage = currentMessages[targetIndex]

    const selectedModel =
      models.find((model) => matchesChatModelSelectionValue(model, config.model)) ??
      models[0]
    if (!isTauriRuntime) return
    const modelSelectionMode = isDesktopLocalModel(selectedModel) ? ("pool" as const) : undefined
    if (!selectedModel) return

    const { sessionStorageKey } = resolveChatRequestContext({
      isTauriRuntime,
    })

    // Replace the old assistant message with a fresh placeholder.
    const messagesBeforeTarget = currentMessages.slice(0, targetIndex)
    const assistantMessageId = createMessageId()
    const newAssistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }
    activeAssistantMessageIdRef.current = assistantMessageId
    setInterruptedMessageId(null)
    clearAllCompareStates()

    setMessages([...messagesBeforeTarget, newAssistantMessage])
    setIsLoading(true)
    setActiveMessageId(assistantMessageId)
    clearStatus()

    // Rebuild the request from the conversation state before the deleted assistant reply.
    const resolvedSessionId = resolveCurrentSessionId(sessionStorageKey)
    try {
      if (!resolvedSessionId) {
        throw new Error("Session not found")
      }

      const requestMessages = buildChatMessages(
        messagesBeforeTarget,
        undefined,
      )
      const latestUserMessage = [...messagesBeforeTarget]
        .reverse()
        .find((message) => message.role === "user")
      const displayInput =
        typeof latestUserMessage?.metaInfo?.display_content === "string"
          ? latestUserMessage.metaInfo.display_content.trim()
          : ""
      const explicitTaskAgentId = displayInput
        ? await resolveExplicitTaskAgentIdForInput(displayInput)
        : undefined
      const payload = {
        model: selectedModel.id,
        model_selection_mode: modelSelectionMode,
        provider_model_id:
          selectedModel.provider_model_id ?? undefined,
        explicit_task_agent_id: explicitTaskAgentId,
        messages: requestMessages,
        temperature: config.temperatureEnabled ? config.temperature : undefined,
        max_tokens: undefined,
        reasoning_enabled: config.reasoningEnabled,
        reasoning_effort: config.reasoningEnabled ? config.reasoningEffort : undefined,
        request_id: createRequestId(),
        session_id: resolvedSessionId ?? undefined,
        regenerate: true,
        metadata: buildRequestMetadata(
          selectedKnowledgeFileIds,
          resolveExecutionRootForFollowup(targetMessage)
        ),
      }
      requestIdRef.current = payload.request_id ?? null
      activeRequestRouteRef.current = "local_gateway"

      await runStreamedRequest({
        payload: {
          ...payload,
          session_id: resolvedSessionId ?? undefined,
        },
        trackActiveRequest: true,
        errorBlockIdBase: assistantMessageId,
        onBlocks: (blocks) => {
          appendMessageBlocks(assistantMessageId, blocks)
          const latestMessage = useChatStore
            .getState()
            .messages.find((message) => message.id === assistantMessageId)
          const workflowRunId = latestMessage
            ? extractWorkflowRunIdFromMessage(latestMessage)
            : extractWorkflowRunIdFromBlocks(blocks)
          if (workflowRunId) {
            openWorkflowRun(workflowRunId)
          }
        },
        onTraceId: (traceId) => mergeMessageMeta(assistantMessageId, { trace_id: traceId }),
        onSessionResolved: (nextSessionId) => setSessionId(nextSessionId),
        onStatusEvent: (status) => setStatus({ ...status, messageId: assistantMessageId }),
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
      // 濞寸姴鎳庡﹢顏囥亹閹惧啿顤呮繛鎴濈墛娴煎懏绂掑鍡樞︽繛鑼额嚙婵晝鎷犻柨瀣勾闁哄啳鍩栫粩濠氭偠閸℃寮块悘鐐╁亾闁绘鍩栭埀?
      if (activeAssistantMessageIdRef.current === assistantMessageId) {
        setIsLoading(false)
        syncAssistantActivityStatus({
          assistantMessageId,
          setStatus,
          clearStatus,
          setActiveMessageId,
        })
        cancelRef.current = null
        requestIdRef.current = null
        activeRequestRouteRef.current = null
        activeAssistantMessageIdRef.current = null
      }
      interruptedMessageIdsRef.current.delete(assistantMessageId)
    }
  }, [
    config,
    models,
    selectedKnowledgeFileIds,
    cancelActiveRequest,
    setMessages,
    mergeMessageMeta,
    appendMessageBlocks,
    openWorkflowRun,
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
    const baselineBlocks = getAssistantBlocksForCandidate(targetMessage)
    const baselineCandidate: CompareCandidate = {
      modelKey: baselineModelKey,
      modelId: baselineModel.id,
      providerModelId: baselineModel.provider_model_id ?? undefined,
      content: getAssistantShadowContentForCandidate(targetMessage),
      blocks: baselineBlocks,
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

    const { sessionStorageKey } = resolveChatRequestContext({
      isTauriRuntime,
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
      blocks:
        existingCandidate?.blocks ??
        buildExecutionLifecycleBlocksFromMessage(targetMessage, {
          id: `${targetMessageId}-${compareModelKey}-execution-tree`,
          title: "Delegated Execution",
          displayMode: "bubble",
          streamState: "completed",
        }),
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
          model_selection_mode: "exact_provider",
          provider_model_id: selectedCompareModel.provider_model_id ?? undefined,
          messages: requestMessages,
          temperature: config.temperatureEnabled ? config.temperature : undefined,
          request_id: createRequestId(),
          session_id: resolvedSessionId,
          compare_only: true,
          metadata: buildKnowledgeSelectionMetadata(selectedKnowledgeFileIds),
        },
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
          const localizedMessage = formatChatRuntimeErrorMessage(t, message, errorCode)
          const currentCandidate = useChatStore.getState().compareByMessageId[targetMessageId]?.candidates[compareModelKey]
          upsertCompareCandidate(targetMessageId, {
            modelKey: compareModelKey,
            modelId: selectedCompareModel.id,
            providerModelId: selectedCompareModel.provider_model_id ?? undefined,
            content: currentCandidate?.content ?? "",
            blocks: currentCandidate?.blocks ?? [],
            loading: false,
            traceId: currentCandidate?.traceId,
            errorMessage: localizedMessage,
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
    selectedKnowledgeFileIds,
    resolveCurrentSessionId,
    upsertCompareCandidate,
    runStreamedRequest,
    appendCompareCandidateBlocks,
    t,
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
      const executionTree =
        extractExecutionTreeFromMessage({
          blocks: candidate.blocks,
          metaInfo: {
            execution_tree: candidate.blocks.length > 0 ? undefined : undefined,
          },
        }) ??
        extractExecutionTreeFromMessage({
          blocks: normalized?.blocks,
          metaInfo: normalized?.metaInfo,
        }) ??
        extractExecutionTreeFromMessage(currentMessage)

      replaceAssistantMessage(targetMessageId, {
        ...(normalized ?? currentMessage),
        content: "",
        blocks: candidate.blocks,
        metaInfo: {
          ...(normalized?.metaInfo ?? currentMessage.metaInfo ?? {}),
          ...(executionTree ? { execution_tree: executionTree } : {}),
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
    clearCompareState,
    isTauriRuntime,
    replaceAssistantMessage,
    resolveCurrentSessionId,
    setCompareFinalizing,
    setErrorMessage,
    setSessionId,
  ])

  const hasInterruptedGeneration = useMemo(() => {
    if (!interruptedMessageId) return false
    return messages.some(
      (message) =>
        message.id === interruptedMessageId && message.role === "assistant"
    )
  }, [interruptedMessageId, messages])

  const continueInterruptedGeneration = useCallback(async () => {
    const targetMessageId = interruptedMessageId
    if (!targetMessageId) return
    const targetMessage = useChatStore
      .getState()
      .messages.find(
        (message) =>
          message.id === targetMessageId && message.role === "assistant"
      )
    if (!targetMessage) {
      setInterruptedMessageId(null)
      return
    }
    setInterruptedMessageId(null)
    await regenerateMessage(targetMessageId)
  }, [interruptedMessageId, regenerateMessage, setInterruptedMessageId])

  useEffect(() => {
    if (!pendingTakeover || pendingTakeoverRequestedAction !== "send_after_step") {
      return
    }
    if (pendingTakeoverDispatchingRef.current) {
      return
    }

    const activeAssistantBlocks = activeAssistantMessageIdRef.current
      ? (
          useChatStore
            .getState()
            .messages.find((message) => message.id === activeAssistantMessageIdRef.current)?.blocks ?? []
        ) as MessageBlock[]
      : []

    if (
      !isPendingTakeoverSafeBoundary({
        isLoading,
        statusCode,
        assistantBlocks: activeAssistantBlocks,
      })
    ) {
      return
    }

    pendingTakeoverDispatchingRef.current = true

    void dispatchDraft({
      draft: buildPendingTakeoverDispatchDraft(pendingTakeover),
      clearComposerMode: "if_matching_draft",
    })
      .then((dispatched) => {
        if (dispatched) {
          clearPendingTakeover()
          return
        }
        setPendingTakeoverRequestedAction(null)
      })
      .finally(() => {
      pendingTakeoverDispatchingRef.current = false
    })
  }, [
    pendingTakeover,
    pendingTakeoverRequestedAction,
    isLoading,
    statusCode,
    messages,
    clearPendingTakeover,
    dispatchDraft,
    setPendingTakeoverRequestedAction,
  ])

  return {
    sendMessage,
    dispatchRenderRefresh,
    pendingTakeover,
    pendingTakeoverRequestedAction,
    queuePendingTakeoverFromCurrentDraft,
    stopAndSendPendingTakeover,
    markPendingTakeoverForDeferredSend,
    cancelPendingTakeover,
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
