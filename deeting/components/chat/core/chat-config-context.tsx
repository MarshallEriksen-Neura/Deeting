"use client"

import * as React from "react"
import { useChatStateStore } from "@/store/chat-state-store"
import { useChatSessionStore } from "@/store/chat-session-store"

/**
 * ChatConfigContext - 管理聊天配置和会话状态
 * 
 * 职责：
 * - 流式传输开关
 * - 错误消息管理
 * - 状态信息（stage, code, meta）
 * - 会话重置
 * 
 * 使用场景：
 * - 设置面板需要读取和更新配置
 * - 错误提示组件需要显示错误信息
 * - 状态指示器需要显示当前状态
 * - 需要重置会话
 * 
 * @example
 * ```tsx
 * function ChatSettings() {
 *   const { streamEnabled, setStreamEnabled } = useChatConfig()
 *   
 *   return (
 *     <label>
 *       <input
 *         type="checkbox"
 *         checked={streamEnabled}
 *         onChange={e => setStreamEnabled(e.target.checked)}
 *       />
 *       启用流式传输
 *     </label>
 *   )
 * }
 * 
 * function ErrorDisplay() {
 *   const { errorMessage, setErrorMessage } = useChatConfig()
 *   
 *   if (!errorMessage) return null
 *   
 *   return (
 *     <div className="error">
 *       {errorMessage}
 *       <button onClick={() => setErrorMessage(null)}>关闭</button>
 *     </div>
 *   )
 * }
 * ```
 */
export interface ChatConfigContextValue {
  /** 是否启用流式传输 */
  streamEnabled: boolean
  
  /** 设置流式传输开关 */
  setStreamEnabled: (enabled: boolean) => void
  
  /** 错误消息 */
  errorMessage: string | null
  
  /** 设置错误消息 */
  setErrorMessage: (error: string | null) => void
  
  /** 当前状态阶段 */
  statusStage: string | null
  
  /** 状态码 */
  statusCode: string | null
  
  /** 状态元数据 */
  statusMeta: Record<string, unknown> | null
  
  /** 重置会话（清空错误和状态） */
  resetSession: () => void
}

const ChatConfigContext = React.createContext<ChatConfigContextValue | null>(null)

/**
 * 使用聊天配置 Context
 * 
 * @throws {Error} 如果在 ChatConfigProvider 外部使用
 */
export function useChatConfig(): ChatConfigContextValue {
  const context = React.useContext(ChatConfigContext)
  if (!context) {
    throw new Error("useChatConfig must be used within a ChatConfigProvider")
  }
  return context
}

interface ChatConfigProviderProps {
  children: React.ReactNode
}

/**
 * ChatConfigProvider - 提供配置和状态的 Context Provider
 * 
 * 从 Zustand stores 读取配置和会话状态并通过 Context 传递给子组件
 */
export function ChatConfigProvider({ children }: ChatConfigProviderProps) {
  const { streamEnabled, setStreamEnabled } = useChatStateStore()
  
  const {
    errorMessage,
    statusStage,
    statusCode,
    statusMeta,
    setErrorMessage,
    resetSession,
  } = useChatSessionStore()

  const contextValue = React.useMemo<ChatConfigContextValue>(
    () => ({
      streamEnabled,
      setStreamEnabled,
      errorMessage,
      setErrorMessage,
      statusStage,
      statusCode,
      statusMeta,
      resetSession,
    }),
    [
      streamEnabled,
      setStreamEnabled,
      errorMessage,
      setErrorMessage,
      statusStage,
      statusCode,
      statusMeta,
      resetSession,
    ]
  )

  return (
    <ChatConfigContext.Provider value={contextValue}>
      {children}
    </ChatConfigContext.Provider>
  )
}
