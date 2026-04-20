"use client"

import * as React from "react"
import { ChatMessagesProvider } from "./chat-messages-context"
import { ChatUIStateProvider } from "./chat-ui-state-context"
import { ChatConfigProvider } from "./chat-config-context"

/**
 * ChatProvider - 组合所有聊天相关的 Context Providers
 * 
 * 这个组件将三个独立的 Context Provider 组合在一起：
 * 1. ChatMessagesProvider - 消息数据
 * 2. ChatUIStateProvider - UI 状态
 * 3. ChatConfigProvider - 配置和会话状态
 * 
 * 使用拆分的 Context 可以：
 * - 减少不必要的重渲染（组件只订阅需要的 Context）
 * - 提高代码可维护性（职责分离）
 * - 更好的性能优化（每个 Context 独立缓存）
 * 
 * @example
 * ```tsx
 * function ChatPage() {
 *   return (
 *     <ChatProvider>
 *       <ChatLayout>
 *         <MessageList />
 *         <ChatInput />
 *       </ChatLayout>
 *     </ChatProvider>
 *   )
 * }
 * ```
 */
interface ChatProviderProps {
  children: React.ReactNode
}

export function ChatProvider({ children }: ChatProviderProps) {
  return (
    <ChatConfigProvider>
      <ChatMessagesProvider>
        <ChatUIStateProvider>
          {children}
        </ChatUIStateProvider>
      </ChatMessagesProvider>
    </ChatConfigProvider>
  )
}
