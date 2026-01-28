"use client"

/**
 * chat-state-store.ts - 兼容层
 *
 * 此文件保留用于向后兼容。新代码应直接使用 @/store/chat-store
 *
 * @deprecated 请使用 @/store/chat-store
 */

import { useChatStore, type Message, type MessageRole, type ChatAssistant } from "./chat-store"

// 重新导出类型
export type { Message, MessageRole, ChatAssistant }

/**
 * @deprecated 请使用 useChatStore
 */
export const useChatStateStore = () => {
  const store = useChatStore()

  return {
    // 消息相关
    messages: store.messages,
    setMessages: store.setMessages,
    addMessage: store.addMessage,
    updateMessage: store.updateMessage,
    clearMessages: store.clearMessages,

    // 输入相关
    input: store.input,
    setInput: store.setInput,

    // 附件相关
    attachments: store.attachments,
    setAttachments: store.setAttachments,
    addAttachments: store.addAttachments,
    removeAttachment: store.removeAttachment,
    clearAttachments: store.clearAttachments,

    // 配置相关
    config: store.config,
    setConfig: store.setConfig,

    // 代理和模型
    assistants: store.agent ? [store.agent] : [],
    models: store.models,
    setAssistants: (assistants: ChatAssistant[]) => {
      if (assistants.length > 0) {
        store.setAgent(assistants[0])
      }
    },
    setModels: store.setModels,

    // 活跃状态
    activeAssistantId: store.agentId,
    setActiveAssistantId: (assistantId?: string) => {
      if (assistantId) {
        store.switchAgent(assistantId, store.agent)
      }
    },

    // 流式设置
    streamEnabled: store.streamEnabled,
    setStreamEnabled: store.setStreamEnabled,
  }
}
