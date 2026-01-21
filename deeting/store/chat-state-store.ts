"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { ChatImageAttachment } from "@/lib/chat/message-content"
import type { ModelInfo } from "@/lib/api/models"

export type MessageRole = "user" | "assistant" | "system"

export interface Message {
  id: string
  role: MessageRole
  content: string
  attachments?: ChatImageAttachment[]
  createdAt: number
}

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

// 基础状态 Store
interface ChatStateStore {
  // 消息相关
  messages: Message[]
  setMessages: (messages: Message[]) => void
  addMessage: (role: MessageRole, content: string, attachments?: ChatImageAttachment[]) => void
  updateMessage: (id: string, content: string) => void
  clearMessages: () => void

  // 输入相关
  input: string
  setInput: (input: string) => void
  
  // 附件相关
  attachments: ChatImageAttachment[]
  setAttachments: (attachments: ChatImageAttachment[]) => void
  addAttachments: (attachments: ChatImageAttachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void

  // 配置相关
  config: ChatConfig
  setConfig: (config: Partial<ChatConfig>) => void

  // 代理和模型
  assistants: ChatAssistant[]
  models: ModelInfo[]
  setAssistants: (assistants: ChatAssistant[]) => void
  setModels: (models: ModelInfo[]) => void

  // 活跃状态
  activeAssistantId?: string
  setActiveAssistantId: (assistantId?: string) => void

  // 流式设置
  streamEnabled: boolean
  setStreamEnabled: (enabled: boolean) => void
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

export const useChatStateStore = create<ChatStateStore>()(
  persist(
    (set, get) => ({
      // 消息相关
      messages: [],
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

      // 输入相关
      input: "",
      setInput: (input) => set({ input }),

      // 附件相关
      attachments: [],
      setAttachments: (attachments) => set({ attachments }),
      
      addAttachments: (attachments) =>
        set((state) => ({
          attachments: [...state.attachments, ...attachments],
        })),

      removeAttachment: (attachmentId) =>
        set((state) => ({
          attachments: state.attachments.filter((attachment) => attachment.id !== attachmentId),
        })),

      clearAttachments: () => set({ attachments: [] }),

      // 配置相关
      config: {
        model: "gpt-4o",
        temperature: 0.7,
        topP: 1.0,
        maxTokens: 2048,
      },
      setConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),

      // 代理和模型
      assistants: [],
      models: [],
      setAssistants: (assistants) => set({ assistants }),
      setModels: (models) => set({ models }),

      // 活跃状态
      activeAssistantId: undefined,
      setActiveAssistantId: (assistantId) => set({ activeAssistantId: assistantId }),

      // 流式设置
      streamEnabled: false,
      setStreamEnabled: (enabled) => set({ streamEnabled: enabled }),
    }),
    {
      name: "deeting-chat-state-store",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        messages: state.messages.map(({ attachments, ...rest }) => rest),
        config: state.config,
        activeAssistantId: state.activeAssistantId,
        streamEnabled: state.streamEnabled,
      }),
    }
  )
)