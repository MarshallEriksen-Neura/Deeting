"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { ChatImageAttachment } from "@/lib/chat/message-content"
import type { Message, MessageRole } from "@/lib/chat/message-types"
import type { ModelInfo } from "@/lib/api/models"
import { loadConversationHistoryPage } from "@/lib/chat/history-loader"
import type { MessageBlock, ToolResultBlock } from "@/lib/chat/message-protocol"
import {
  appendMessageBlocks as appendNormalizedMessageBlocks,
  extractAssistantTextFromBlocks,
  replaceMessageBlocks,
  upsertToolResultBlock,
} from "@/lib/chat/message-blocks"
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"

// ============== 类型定义 ==============

export type { Message, MessageRole }

export interface ChatAssistant {
  id: string
  name: string
  desc: string
  color: string
  systemPrompt?: string
  ownerUserId?: string | null
}

interface ChatConfig {
  model: string
  temperature: number
  topP: number
  maxTokens: number | null
}

const LEGACY_DEFAULT_CHAT_MAX_TOKENS = 2048
const PREVIOUS_DEFAULT_CHAT_MAX_TOKENS = 8192

const resolveChatPersistStorage = () =>
  detectTauriRuntime() ? localStorage : sessionStorage

export interface CompareCandidate {
  modelKey: string
  modelId: string
  providerModelId?: string
  content: string
  blocks: MessageBlock[]
  loading: boolean
  baseline?: boolean
  traceId?: string
  errorMessage?: string | null
  statusStage?: string | null
  statusCode?: string | null
  statusMeta?: Record<string, unknown> | null
}

export interface MessageCompareState {
  messageId: string
  baselineModelKey: string
  activeModelKey: string
  isFinalizing: boolean
  candidates: Record<string, CompareCandidate>
}

export type PendingTakeoverRequestedAction = "immediate_stop" | "send_after_step"

export interface PendingChatTakeover {
  input: string
  attachments: ChatImageAttachment[]
  selectedKnowledgeFileIds: string[]
  createdAt: number
  updatedAt: number
}

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

function filterCompareStateByMessageIds(
  compareByMessageId: Record<string, MessageCompareState>,
  messages: Message[]
) {
  const validIds = new Set(messages.map((message) => message.id))
  return Object.fromEntries(
    Object.entries(compareByMessageId).filter(([messageId]) => validIds.has(messageId))
  )
}

function isStatusMetaEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null
) {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

async function readConversationHistoryState(sessionId: string) {
  const page = await loadConversationHistoryPage(sessionId, {
    limit: 30,
    idPrefix: sessionId,
    isTauriRuntime: detectTauriRuntime(),
  })

  return {
    messages: page.messages,
    historyCursor: page.nextCursor,
    historyHasMore: page.hasMore,
  }
}

// ============== Store 接口 ==============

interface ChatStore {
  // === 会话状态 ===
  sessionId: string | null
  initialized: boolean // 新增：标记是否已初始化
  isLoading: boolean
  globalLoading: boolean

  // === 消息状态 ===
  messages: Message[]
  compareByMessageId: Record<string, MessageCompareState>

  // === 输入状态 ===
  input: string
  attachments: ChatImageAttachment[]
  selectedKnowledgeFileIds: string[]
  pendingTakeover: PendingChatTakeover | null
  pendingTakeoverRequestedAction: PendingTakeoverRequestedAction | null

  // === 配置状态 ===
  config: ChatConfig
  streamEnabled: boolean
  models: ModelInfo[]

  // === 状态信息 ===
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
  errorMessage: string | null

  // === 历史记录分页 ===
  historyCursor: number | null
  historyHasMore: boolean

  // === 核心 Action：初始化会话（一次性调用）===
  initSession: (sessionId: string | null) => Promise<void>

  // === 同步 Actions ===
  setSessionId: (sessionId: string | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (role: MessageRole, content: string, attachments?: ChatImageAttachment[]) => void
  mergeMessageMeta: (id: string, patch: Record<string, unknown>) => void
  setMessageBlocks: (id: string, blocks: MessageBlock[]) => void
  appendMessageBlocks: (id: string, blocks: MessageBlock[]) => void
  upsertMessageToolResult: (id: string, block: ToolResultBlock) => void
  ensureCompareState: (messageId: string, baselineCandidate: CompareCandidate) => void
  upsertCompareCandidate: (messageId: string, candidate: CompareCandidate) => void
  appendCompareCandidateBlocks: (messageId: string, modelKey: string, blocks: MessageBlock[]) => void
  setCompareActiveCandidate: (messageId: string, modelKey: string) => void
  setCompareFinalizing: (messageId: string, isFinalizing: boolean) => void
  clearCompareState: (messageId: string) => void
  clearAllCompareStates: () => void
  clearMessages: () => void
  setInput: (input: string) => void
  setAttachments: (attachments: ChatImageAttachment[]) => void
  addAttachments: (attachments: ChatImageAttachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void
  setSelectedKnowledgeFileIds: (fileIds: string[]) => void
  toggleSelectedKnowledgeFileId: (fileId: string) => void
  clearSelectedKnowledgeFileIds: () => void
  setPendingTakeover: (draft: {
    input: string
    attachments: ChatImageAttachment[]
    selectedKnowledgeFileIds: string[]
  }) => void
  setPendingTakeoverRequestedAction: (
    action: PendingTakeoverRequestedAction | null
  ) => void
  clearPendingTakeover: () => void
  setConfig: (config: Partial<ChatConfig>) => void
  setStreamEnabled: (enabled: boolean) => void
  setModels: (models: ModelInfo[]) => void
  setIsLoading: (loading: boolean) => void
  setGlobalLoading: (loading: boolean) => void
  setStatus: (status: { stage?: string | null; code?: string | null; meta?: Record<string, unknown> | null }) => void
  clearStatus: () => void
  setErrorMessage: (error: string | null) => void
  sendFeedback: (messageId: string, score: number) => Promise<void>

  // === 兼容性 Actions（逐步废弃）===
  loadHistory: (sessionId: string) => Promise<void>
  resetChat: () => void
  resetSession: () => void
}

// ============== Store 实现 ==============

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // === 会话状态初始值 ===
      sessionId: null,
      initialized: false,
      isLoading: false,
      globalLoading: false,

      // === 消息状态初始值 ===
      messages: [],
      compareByMessageId: {},

      // === 输入状态初始值 ===
      input: "",
      attachments: [],
      selectedKnowledgeFileIds: [],
      pendingTakeover: null,
      pendingTakeoverRequestedAction: null,

      // === 配置状态初始值 ===
      config: {
        model: "gpt-4o",
        temperature: 0.7,
        topP: 1.0,
        maxTokens: null,
      },
      streamEnabled: false,
      models: [],

      // === 状态信息初始值 ===
      statusStage: null,
      statusCode: null,
      statusMeta: null,
      errorMessage: null,

      // === 历史记录分页初始值 ===
      historyCursor: null,
      historyHasMore: false,

      // ============================================================
      // 核心 Action：initSession
      //
      // 这是组件应该调用的唯一入口。它会：
      // 1. 检查是否需要初始化（避免重复调用）
      // 2. 切换 agent 时清空旧状态
      // 3. 获取 agent 数据（从 API 或使用传入的 localAgent）
      // 4. 加载历史消息（如果有 sessionId）
      //
      // 所有操作在一个函数内完成，没有循环依赖。
      // ============================================================
      initSession: async (sessionId: string | null) => {
        const state = get()
        if (state.initialized && state.sessionId === sessionId) {
          return
        }

        const isNewSession = state.sessionId !== sessionId
        const shouldReset = isNewSession

        set({
          sessionId,
          initialized: true,
          isLoading: true,
          ...(shouldReset ? {
            messages: [],
            input: "",
            attachments: [],
            selectedKnowledgeFileIds: [],
            pendingTakeover: null,
            pendingTakeoverRequestedAction: null,
            errorMessage: null,
            statusStage: null,
            statusCode: null,
            statusMeta: null,
            compareByMessageId: {},
            historyCursor: null,
            historyHasMore: false,
          } : {}),
        })

        try {
          let messages: Message[] = shouldReset ? [] : state.messages
          let historyCursor: number | null = null
          let historyHasMore = false

          if (sessionId && shouldReset) {
            try {
              const historyState = await readConversationHistoryState(sessionId)
              messages = historyState.messages
              historyCursor = historyState.historyCursor
              historyHasMore = historyState.historyHasMore
            } catch (error) {
              console.error("Failed to load history:", error)
              messages = []
            }
          }

          set({
            messages,
            compareByMessageId: {},
            historyCursor,
            historyHasMore,
            isLoading: false,
          })

        } catch (error) {
          console.error("initSession error:", error)
          set({ isLoading: false, errorMessage: "Failed to initialize session" })
        }
      },

      // === 同步 Actions ===
      setSessionId: (sessionId) => set({ sessionId }),

      setMessages: (messages) =>
        set((state) => ({
          messages,
          compareByMessageId: filterCompareStateByMessageIds(state.compareByMessageId, messages),
        })),

      addMessage: (role, content, attachments) => {
        const newMessage: Message = {
          id: createMessageId(),
          role,
          content,
          attachments,
          createdAt: Date.now(),
        }
        set((state) => ({ messages: [...state.messages, newMessage] }))
      },

      mergeMessageMeta: (id, patch) =>
        set((state) => ({
          messages: state.messages.map((msg) => {
            if (msg.id !== id) return msg
            return {
              ...msg,
              metaInfo: { ...(msg.metaInfo || {}), ...patch },
            }
          }),
        })),

      setMessageBlocks: (id, blocks) =>
        set((state) => ({
          messages: state.messages.map((msg) => {
            if (msg.id !== id) return msg
            const normalized = replaceMessageBlocks(msg.id, blocks)
            if (msg.role !== "assistant") {
              return { ...msg, blocks: normalized }
            }
            return {
              ...msg,
              blocks: normalized,
              content: extractAssistantTextFromBlocks(normalized),
            }
          }),
        })),

      appendMessageBlocks: (id, blocks) =>
        set((state) => ({
          messages: state.messages.map((msg) => {
            if (msg.id !== id) return msg
            const next = appendNormalizedMessageBlocks(msg.id, msg.blocks, blocks)

            if (msg.role !== "assistant") {
              return { ...msg, blocks: next }
            }
            return {
              ...msg,
              blocks: next,
              content: extractAssistantTextFromBlocks(next),
            }
          }),
        })),

      upsertMessageToolResult: (id, block) =>
        set((state) => ({
          messages: state.messages.map((msg) => {
            if (msg.id !== id) return msg
            const next = upsertToolResultBlock(msg.id, msg.blocks, block)

            if (msg.role !== "assistant") {
              return { ...msg, blocks: next }
            }
            return {
              ...msg,
              blocks: next,
              content: extractAssistantTextFromBlocks(next),
            }
          }),
        })),

      ensureCompareState: (messageId, baselineCandidate) =>
        set((state) => {
          const existing = state.compareByMessageId[messageId]
          if (existing) {
            return {
              compareByMessageId: {
                ...state.compareByMessageId,
                [messageId]: {
                  ...existing,
                  candidates: {
                    ...existing.candidates,
                    [baselineCandidate.modelKey]: existing.candidates[baselineCandidate.modelKey] ?? baselineCandidate,
                  },
                },
              },
            }
          }

          return {
            compareByMessageId: {
              ...state.compareByMessageId,
              [messageId]: {
                messageId,
                baselineModelKey: baselineCandidate.modelKey,
                activeModelKey: baselineCandidate.modelKey,
                isFinalizing: false,
                candidates: {
                  [baselineCandidate.modelKey]: baselineCandidate,
                },
              },
            },
          }
        }),

      upsertCompareCandidate: (messageId, candidate) =>
        set((state) => {
          const compareState = state.compareByMessageId[messageId]
          if (!compareState) return state
          return {
            compareByMessageId: {
              ...state.compareByMessageId,
              [messageId]: {
                ...compareState,
                candidates: {
                  ...compareState.candidates,
                  [candidate.modelKey]: {
                    ...(compareState.candidates[candidate.modelKey] ?? {}),
                    ...candidate,
                  },
                },
              },
            },
          }
        }),

      appendCompareCandidateBlocks: (messageId, modelKey, blocks) =>
        set((state) => {
          const compareState = state.compareByMessageId[messageId]
          const candidate = compareState?.candidates[modelKey]
          if (!compareState || !candidate) return state
          const nextBlocks = appendNormalizedMessageBlocks(`${messageId}-${modelKey}`, candidate.blocks, blocks)
          return {
            compareByMessageId: {
              ...state.compareByMessageId,
              [messageId]: {
                ...compareState,
                candidates: {
                  ...compareState.candidates,
                  [modelKey]: {
                    ...candidate,
                    blocks: nextBlocks,
                    content: extractAssistantTextFromBlocks(nextBlocks),
                  },
                },
              },
            },
          }
        }),

      setCompareActiveCandidate: (messageId, modelKey) =>
        set((state) => {
          const compareState = state.compareByMessageId[messageId]
          if (!compareState || !compareState.candidates[modelKey]) return state
          return {
            compareByMessageId: {
              ...state.compareByMessageId,
              [messageId]: {
                ...compareState,
                activeModelKey: modelKey,
              },
            },
          }
        }),

      setCompareFinalizing: (messageId, isFinalizing) =>
        set((state) => {
          const compareState = state.compareByMessageId[messageId]
          if (!compareState) return state
          return {
            compareByMessageId: {
              ...state.compareByMessageId,
              [messageId]: {
                ...compareState,
                isFinalizing,
              },
            },
          }
        }),

      clearCompareState: (messageId) =>
        set((state) => {
          if (!state.compareByMessageId[messageId]) return state
          const next = { ...state.compareByMessageId }
          delete next[messageId]
          return { compareByMessageId: next }
        }),

      clearAllCompareStates: () => set({ compareByMessageId: {} }),

      clearMessages: () => set({ messages: [], compareByMessageId: {} }),

      setInput: (input) => set({ input }),

      setAttachments: (attachments) => set({ attachments }),

      addAttachments: (attachments) =>
        set((state) => ({
          attachments: [...state.attachments, ...attachments],
        })),

      removeAttachment: (attachmentId) =>
        set((state) => ({
          attachments: state.attachments.filter((a) => a.id !== attachmentId),
        })),

      clearAttachments: () => set({ attachments: [] }),

      setSelectedKnowledgeFileIds: (fileIds) =>
        set({
          selectedKnowledgeFileIds: Array.from(
            new Set(
              fileIds
                .map((value) => value.trim())
                .filter((value) => value.length > 0)
            )
          ),
        }),

      toggleSelectedKnowledgeFileId: (fileId) =>
        set((state) => {
          const normalized = fileId.trim()
          if (!normalized) return state
          const exists = state.selectedKnowledgeFileIds.includes(normalized)
          if (exists) {
            return {
              selectedKnowledgeFileIds: state.selectedKnowledgeFileIds.filter(
                (id) => id !== normalized
              ),
            }
          }
          return {
            selectedKnowledgeFileIds: [
              ...state.selectedKnowledgeFileIds,
              normalized,
            ],
          }
        }),

      clearSelectedKnowledgeFileIds: () => set({ selectedKnowledgeFileIds: [] }),

      setPendingTakeover: (draft) =>
        set({
          pendingTakeover: {
            input: draft.input,
            attachments: draft.attachments,
            selectedKnowledgeFileIds: Array.from(
              new Set(
                draft.selectedKnowledgeFileIds
                  .map((value) => value.trim())
                  .filter((value) => value.length > 0)
              )
            ),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          pendingTakeoverRequestedAction: null,
        }),

      setPendingTakeoverRequestedAction: (action) =>
        set((state) => {
          if (!state.pendingTakeover) {
            return {
              pendingTakeoverRequestedAction: null,
            }
          }

          return {
            pendingTakeoverRequestedAction: action,
          }
        }),

      clearPendingTakeover: () =>
        set({
          pendingTakeover: null,
          pendingTakeoverRequestedAction: null,
        }),

      setConfig: (newConfig) =>
        set((state) => ({ config: { ...state.config, ...newConfig } })),

      setStreamEnabled: (enabled) => set({ streamEnabled: enabled }),

      setModels: (models) => set({ models }),

      setIsLoading: (isLoading) => set({ isLoading }),

      setGlobalLoading: (globalLoading) => set({ globalLoading }),

      setStatus: (status) =>
        set((state) => {
          const nextStage = status.stage !== undefined ? status.stage : state.statusStage
          const nextCode = status.code !== undefined ? status.code : state.statusCode
          const nextMeta = status.meta !== undefined ? status.meta : state.statusMeta

          if (
            nextStage === state.statusStage &&
            nextCode === state.statusCode &&
            isStatusMetaEqual(state.statusMeta, nextMeta)
          ) {
            return state
          }

          return {
            statusStage: nextStage,
            statusCode: nextCode,
            statusMeta: nextMeta,
          }
        }),

      clearStatus: () =>
        set({
          statusStage: null,
          statusCode: null,
          statusMeta: null,
        }),

      setErrorMessage: (errorMessage) => set({ errorMessage }),

      sendFeedback: async (messageId: string, score: number) => {
        const { messages } = get()
        const message = messages.find((m) => m.id === messageId)
        if (!message) return

        const traceId = message.metaInfo?.trace_id as string | undefined
        if (!traceId) {
          console.warn("sendFeedback failed: trace_id missing in message meta", messageId)
          return
        }

        try {
          const { createTraceFeedback } = await import("@/lib/api/feedback")
          await createTraceFeedback({
            trace_id: traceId,
            score,
          })

          // 更新本地状态
          const metaInfo = { ...(message.metaInfo || {}), feedback_score: score }
          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId ? { ...m, metaInfo } : m
            ),
          }))
        } catch (error) {
          console.error("Failed to send feedback:", error)
        }
      },

      // === 兼容性 Actions（逐步废弃，保留给旧代码使用）===

      loadHistory: async (sessionId: string) => {
        const state = get()
        if (state.isLoading) return

        set({ isLoading: true, sessionId })

        try {
          const historyState = await readConversationHistoryState(sessionId)

          set({
            messages: historyState.messages,
            compareByMessageId: {},
            historyCursor: historyState.historyCursor,
            historyHasMore: historyState.historyHasMore,
          })
        } catch (error) {
          console.error("Failed to load history:", error)
          set({
            messages: [],
            historyCursor: null,
            historyHasMore: false,
          })
        } finally {
          set({ isLoading: false })
        }
      },

      resetChat: () =>
        set({
          messages: [],
          compareByMessageId: {},
          input: "",
          attachments: [],
          selectedKnowledgeFileIds: [],
          pendingTakeover: null,
          pendingTakeoverRequestedAction: null,
          sessionId: null,
          initialized: false,
          errorMessage: null,
          statusStage: null,
          statusCode: null,
          statusMeta: null,
          historyCursor: null,
          historyHasMore: false,
        }),

      resetSession: () =>
        set({
          sessionId: null,
          messages: [],
          compareByMessageId: {},
          input: "",
          attachments: [],
          selectedKnowledgeFileIds: [],
          pendingTakeover: null,
          pendingTakeoverRequestedAction: null,
          initialized: false,
          isLoading: false,
          globalLoading: false,
          errorMessage: null,
          statusStage: null,
          statusCode: null,
          statusMeta: null,
          historyCursor: null,
          historyHasMore: false,
        }),
    }),
    {
      name: "deeting-chat-store",
      storage: createJSONStorage(resolveChatPersistStorage),
      partialize: (state) => ({
        // 只持久化配置，不持久化会话数据
        config: state.config,
        streamEnabled: state.streamEnabled,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<ChatStore> | undefined) ?? {}
        const persistedConfig = persisted.config ?? currentState.config
        const normalizedMaxTokens =
          persistedConfig.maxTokens === LEGACY_DEFAULT_CHAT_MAX_TOKENS ||
          persistedConfig.maxTokens === PREVIOUS_DEFAULT_CHAT_MAX_TOKENS
            ? null
            : persistedConfig.maxTokens

        return {
          ...currentState,
          ...persisted,
          config: {
            ...currentState.config,
            ...persistedConfig,
            maxTokens:
              typeof normalizedMaxTokens === "number"
                ? normalizedMaxTokens
                : null,
          },
        }
      },
    }
  )
)

// ============== 选择器 Hooks（优化重渲染）==============

/** 获取消息列表 */
export const useChatMessages = () => useChatStore((state) => state.messages)

/** 获取加载状态 */
export const useChatLoading = () => useChatStore((state) => state.isLoading)

/** 获取状态信息 */
export const useChatStatus = () =>
  useChatStore((state) => ({
    statusStage: state.statusStage,
    statusCode: state.statusCode,
    statusMeta: state.statusMeta,
  }))

/** 获取输入相关状态 */
export const useChatInput = () =>
  useChatStore((state) => ({
    input: state.input,
    attachments: state.attachments,
    selectedKnowledgeFileIds: state.selectedKnowledgeFileIds,
    setInput: state.setInput,
    setAttachments: state.setAttachments,
    addAttachments: state.addAttachments,
    removeAttachment: state.removeAttachment,
    clearAttachments: state.clearAttachments,
    setSelectedKnowledgeFileIds: state.setSelectedKnowledgeFileIds,
    toggleSelectedKnowledgeFileId: state.toggleSelectedKnowledgeFileId,
    clearSelectedKnowledgeFileIds: state.clearSelectedKnowledgeFileIds,
  }))
