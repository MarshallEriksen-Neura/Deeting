"use client"

import * as React from "react"
import { useChatStateStore } from "@/store/chat-state-store"
import { useChatSessionStore } from "@/store/chat-session-store"
import type { Message, MessageRole } from "@/store/chat-state-store"
import type { ChatImageAttachment } from "@/lib/chat/message-content"

/**
 * ChatMessagesContext - 管理聊天消息数据
 * 
 * 职责：
 * - 消息列表的读取和更新
 * - 消息的添加、更新操作
 * - 加载状态（isTyping）
 * 
 * 使用场景：
 * - 消息列表组件需要读取和显示消息
 * - 需要添加新消息或更新现有消息
 * - 需要检查是否正在输入/加载
 * 
 * @example
 * ```tsx
 * function MessageList() {
 *   const { messages, isTyping } = useChatMessages()
 *   return (
 *     <div>
 *       {messages.map(msg => <Message key={msg.id} {...msg} />)}
 *       {isTyping && <TypingIndicator />}
 *     </div>
 *   )
 * }
 * ```
 */
export interface ChatMessagesContextValue {
  /** 消息列表 */
  messages: Message[]
  
  /** 是否正在输入/加载中 */
  isTyping: boolean
  
  /** 添加新消息 */
  addMessage: (role: MessageRole, content: string, attachments?: ChatImageAttachment[]) => void
  
  /** 更新指定消息的内容 */
  updateMessage: (id: string, content: string) => void
  
  /** 清空所有消息 */
  clearMessages: () => void
}

const ChatMessagesContext = React.createContext<ChatMessagesContextValue | null>(null)

/**
 * 使用聊天消息 Context
 * 
 * @throws {Error} 如果在 ChatMessagesProvider 外部使用
 */
export function useChatMessages(): ChatMessagesContextValue {
  const context = React.useContext(ChatMessagesContext)
  if (!context) {
    throw new Error("useChatMessages must be used within a ChatMessagesProvider")
  }
  return context
}

interface ChatMessagesProviderProps {
  children: React.ReactNode
}

/**
 * ChatMessagesProvider - 提供消息数据的 Context Provider
 * 
 * 从 Zustand store 读取消息状态并通过 Context 传递给子组件
 */
export function ChatMessagesProvider({ children }: ChatMessagesProviderProps) {
  const {
    messages,
    addMessage,
    updateMessage,
    clearMessages,
  } = useChatStateStore()
  
  // 从 session store 获取加载状态
  const isTyping = useChatSessionStore((state) => state.isLoading)

  const contextValue = React.useMemo<ChatMessagesContextValue>(
    () => ({
      messages,
      isTyping,
      addMessage,
      updateMessage,
      clearMessages,
    }),
    [messages, isTyping, addMessage, updateMessage, clearMessages]
  )

  return (
    <ChatMessagesContext.Provider value={contextValue}>
      {children}
    </ChatMessagesContext.Provider>
  )
}
