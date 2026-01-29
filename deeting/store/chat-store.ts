"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { ChatImageAttachment } from "@/lib/chat/message-content"
import type { Message, MessageRole } from "@/lib/chat/message-types"
import type { ModelInfo } from "@/lib/api/models"
import { normalizeConversationMessages } from "@/lib/chat/conversation-adapter"
import { fetchConversationHistory } from "@/lib/api/conversations"
import { fetchAssistantInstalls, type AssistantInstallItem } from "@/lib/api/assistants"

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
  maxTokens: number
}

// ============== 工具函数 ==============

const COLOR_PRESETS = [
  "from-indigo-500 to-purple-500",
  "from-sky-500 to-cyan-500",
  "from-emerald-500 to-green-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-fuchsia-500 to-purple-500",
]

const hashToIndex = (value: string, modulo: number) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % modulo
  }
  return hash
}

const normalizeAssistantId = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  if (value && typeof value === "object") {
    const candidate = value as { id?: unknown; assistant_id?: unknown; assistantId?: unknown }
    const rawId =
      (typeof candidate.id === "string" && candidate.id) ||
      (typeof candidate.assistant_id === "string" && candidate.assistant_id) ||
      (typeof candidate.assistantId === "string" && candidate.assistantId) ||
      ""
    const trimmed = rawId.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

function mapInstallToAssistant(item: AssistantInstallItem): ChatAssistant {
  const color = COLOR_PRESETS[hashToIndex(item.assistant_id, COLOR_PRESETS.length)]
  const version = item.assistant.version
  return {
    id: item.assistant_id,
    name: version?.name || "Assistant",
    desc: version?.description || item.assistant.summary || "",
    color,
    systemPrompt: version?.system_prompt ?? undefined,
    ownerUserId: item.assistant.owner_user_id,
  }
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

// ============== Store 接口 ==============

interface ChatStore {
  // === 会话状态 ===
  sessionId: string | null
  agentId: string | null
  agent: ChatAssistant | null
  initialized: boolean // 新增：标记是否已初始化
  isLoading: boolean
  globalLoading: boolean

  // === 消息状态 ===
  messages: Message[]

  // === 输入状态 ===
  input: string
  attachments: ChatImageAttachment[]

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
  initSession: (agentId: string, sessionId: string | null, localAgent?: ChatAssistant | null) => Promise<void>

  // === 同步 Actions ===
  setSessionId: (sessionId: string | null) => void
  setAgent: (agent: ChatAssistant | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (role: MessageRole, content: string, attachments?: ChatImageAttachment[]) => void
  updateMessage: (id: string, content: string) => void
  clearMessages: () => void
  setInput: (input: string) => void
  setAttachments: (attachments: ChatImageAttachment[]) => void
  addAttachments: (attachments: ChatImageAttachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void
  setConfig: (config: Partial<ChatConfig>) => void
  setStreamEnabled: (enabled: boolean) => void
  setModels: (models: ModelInfo[]) => void
  setIsLoading: (loading: boolean) => void
  setGlobalLoading: (loading: boolean) => void
  setStatus: (status: { stage?: string | null; code?: string | null; meta?: Record<string, unknown> | null }) => void
  clearStatus: () => void
  setErrorMessage: (error: string | null) => void

  // === 兼容性 Actions（逐步废弃）===
  loadHistory: (sessionId: string) => Promise<void>
  switchAgent: (agentId: string, agent: ChatAssistant | null) => void
  resetChat: () => void
  resetSession: () => void
}

// ============== Store 实现 ==============

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // === 会话状态初始值 ===
      sessionId: null,
      agentId: null,
      agent: null,
      initialized: false,
      isLoading: false,
      globalLoading: false,

      // === 消息状态初始值 ===
      messages: [],

      // === 输入状态初始值 ===
      input: "",
      attachments: [],

      // === 配置状态初始值 ===
      config: {
        model: "gpt-4o",
        temperature: 0.7,
        topP: 1.0,
        maxTokens: 2048,
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
      initSession: async (agentId: string, sessionId: string | null, localAgent?: ChatAssistant | null) => {
        const normalizedAgentId = normalizeAssistantId(agentId)
        if (!normalizedAgentId) {
          console.warn("initSession skipped due to invalid agentId", agentId)
          return
        }
        const state = get()

        // 防止重复初始化同一个 agent + session
        if (state.initialized && state.agentId === normalizedAgentId && state.sessionId === sessionId) {
          return
        }

        // 如果是新的 agentId 或 sessionId，需要重置状态
        const isNewAgent = state.agentId !== normalizedAgentId
        const isNewSession = state.sessionId !== sessionId
        const shouldReset = isNewAgent || isNewSession

        // 先设置基础状态
        set({
          agentId: normalizedAgentId,
          sessionId,
          initialized: true,
          isLoading: true,
          // 如果是新 agent，清空消息
          ...(shouldReset ? {
            messages: [],
            input: "",
            attachments: [],
            errorMessage: null,
            statusStage: null,
            statusCode: null,
            statusMeta: null,
            historyCursor: null,
            historyHasMore: false,
          } : {}),
        })

        try {
          // Step 1: 获取 agent 数据
          let agent: ChatAssistant | null = localAgent ?? null

          if (!agent) {
            // 从 API 获取 assistant 列表
            try {
              const installPage = await fetchAssistantInstalls({ size: 100 })
              const found = installPage.items.find((item) => item.assistant_id === normalizedAgentId)
              if (found) {
                agent = mapInstallToAssistant(found)
              }
            } catch (error) {
              console.error("Failed to fetch assistant:", error)
            }
          }

          // Step 2: 加载历史消息（如果有 sessionId 且是新 agent 或新 session）
          let messages: Message[] = shouldReset ? [] : state.messages
          let historyCursor: number | null = null
          let historyHasMore = false

          if (sessionId && shouldReset) {
            try {
              const response = await fetchConversationHistory(sessionId, { limit: 30 })
              messages = normalizeConversationMessages(response.messages || [], {
                idPrefix: sessionId,
              })
              historyCursor = response.next_cursor ?? null
              historyHasMore = Boolean(response.has_more)
            } catch (error) {
              console.error("Failed to load history:", error)
              messages = []
            }
          }

          // Step 3: 一次性更新所有状态（避免多次触发渲染）
          set({
            agent,
            messages,
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

      setAgent: (agent) => {
        // 防止相同 agent 重复设置（避免无限循环）
        const current = get().agent
        if (current?.id === agent?.id) return
        set({ agent })
      },

      setMessages: (messages) => set({ messages }),

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

      updateMessage: (id, content) =>
        set((state) => ({
          messages: state.messages.map((msg) => (msg.id === id ? { ...msg, content } : msg)),
        })),

      clearMessages: () => set({ messages: [] }),

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

      setConfig: (newConfig) =>
        set((state) => ({ config: { ...state.config, ...newConfig } })),

      setStreamEnabled: (enabled) => set({ streamEnabled: enabled }),

      setModels: (models) => set({ models }),

      setIsLoading: (isLoading) => set({ isLoading }),

      setGlobalLoading: (globalLoading) => set({ globalLoading }),

      setStatus: (status) =>
        set((state) => ({
          statusStage: status.stage !== undefined ? status.stage : state.statusStage,
          statusCode: status.code !== undefined ? status.code : state.statusCode,
          statusMeta: status.meta !== undefined ? status.meta : state.statusMeta,
        })),

      clearStatus: () =>
        set({
          statusStage: null,
          statusCode: null,
          statusMeta: null,
        }),

      setErrorMessage: (errorMessage) => set({ errorMessage }),

      // === 兼容性 Actions（逐步废弃，保留给旧代码使用）===

      loadHistory: async (sessionId: string) => {
        const state = get()
        if (state.isLoading) return

        set({ isLoading: true, sessionId })

        try {
          const response = await fetchConversationHistory(sessionId, { limit: 30 })
          const mapped = normalizeConversationMessages(response.messages || [], {
            idPrefix: sessionId,
          })

          set({
            messages: mapped,
            historyCursor: response.next_cursor ?? null,
            historyHasMore: Boolean(response.has_more),
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

      switchAgent: (agentId: string, agent: ChatAssistant | null) => {
        const normalizedAgentId = normalizeAssistantId(agentId)
        if (!normalizedAgentId) {
          console.warn("switchAgent skipped due to invalid agentId", agentId)
          return
        }
        const current = get()

        if (current.agentId === normalizedAgentId) {
          if (agent && current.agent?.id !== agent.id) {
            set({ agent })
          }
          return
        }

        set({
          agentId: normalizedAgentId,
          agent,
          messages: [],
          input: "",
          attachments: [],
          initialized: false, // 重置初始化状态
          sessionId: null,
          errorMessage: null,
          statusStage: null,
          statusCode: null,
          statusMeta: null,
          historyCursor: null,
          historyHasMore: false,
        })
      },

      resetChat: () =>
        set({
          messages: [],
          input: "",
          attachments: [],
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
          agentId: null,
          agent: null,
          messages: [],
          input: "",
          attachments: [],
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
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        // 只持久化配置，不持久化会话数据
        config: state.config,
        streamEnabled: state.streamEnabled,
      }),
    }
  )
)

// ============== 选择器 Hooks（优化重渲染）==============

/** 获取消息列表 */
export const useChatMessages = () => useChatStore((state) => state.messages)

/** 获取加载状态 */
export const useChatLoading = () => useChatStore((state) => state.isLoading)

/** 获取当前 Agent */
export const useChatAgent = () => useChatStore((state) => state.agent)

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
    setInput: state.setInput,
    setAttachments: state.setAttachments,
    addAttachments: state.addAttachments,
    removeAttachment: state.removeAttachment,
    clearAttachments: state.clearAttachments,
  }))
