"use client"

import * as React from "react"
import { useChatStateStore } from "@/store/chat-state-store"
import type { ChatImageAttachment } from "@/lib/chat/message-content"

/**
 * ChatUIStateContext - 管理聊天界面的 UI 状态
 * 
 * 职责：
 * - 输入框内容管理
 * - 附件（图片）管理
 * - UI 交互状态
 * 
 * 使用场景：
 * - 输入框组件需要读取和更新输入内容
 * - 附件上传和管理
 * - 需要清空输入状态
 * 
 * @example
 * ```tsx
 * function ChatInput() {
 *   const { input, setInput, attachments, addAttachments } = useChatUIState()
 *   
 *   return (
 *     <div>
 *       <input value={input} onChange={e => setInput(e.target.value)} />
 *       <AttachmentList attachments={attachments} />
 *     </div>
 *   )
 * }
 * ```
 */
export interface ChatUIStateContextValue {
  /** 当前输入框内容 */
  input: string
  
  /** 设置输入框内容 */
  setInput: (input: string) => void
  
  /** 当前附件列表 */
  attachments: ChatImageAttachment[]
  
  /** 添加附件 */
  addAttachments: (attachments: ChatImageAttachment[]) => void
  
  /** 移除指定附件 */
  removeAttachment: (id: string) => void
  
  /** 清空所有附件 */
  clearAttachments: () => void
}

const ChatUIStateContext = React.createContext<ChatUIStateContextValue | null>(null)

/**
 * 使用聊天 UI 状态 Context
 * 
 * @throws {Error} 如果在 ChatUIStateProvider 外部使用
 */
export function useChatUIState(): ChatUIStateContextValue {
  const context = React.useContext(ChatUIStateContext)
  if (!context) {
    throw new Error("useChatUIState must be used within a ChatUIStateProvider")
  }
  return context
}

interface ChatUIStateProviderProps {
  children: React.ReactNode
}

/**
 * ChatUIStateProvider - 提供 UI 状态的 Context Provider
 * 
 * 从 Zustand store 读取 UI 状态并通过 Context 传递给子组件
 */
export function ChatUIStateProvider({ children }: ChatUIStateProviderProps) {
  const {
    input,
    setInput,
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
  } = useChatStateStore()

  const contextValue = React.useMemo<ChatUIStateContextValue>(
    () => ({
      input,
      setInput,
      attachments,
      addAttachments,
      removeAttachment,
      clearAttachments,
    }),
    [input, setInput, attachments, addAttachments, removeAttachment, clearAttachments]
  )

  return (
    <ChatUIStateContext.Provider value={contextValue}>
      {children}
    </ChatUIStateContext.Provider>
  )
}
