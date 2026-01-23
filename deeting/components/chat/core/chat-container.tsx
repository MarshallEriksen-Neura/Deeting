"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useChatService } from "@/hooks/use-chat-service"
import { useChatStateStore } from "@/store/chat-state-store"
import { useChatSessionStore } from "@/store/chat-session-store"
import { useChatAgent } from "@/hooks/chat/use-chat-agent"
import { useChatHistory } from "@/hooks/chat/use-chat-history"
import { useChatSession } from "@/hooks/chat/use-chat-session"
import { ChatProvider } from "./chat-provider"
import { ChatLayout } from "./chat-layout"
import { ChatContent } from "./chat-content"
import { ChatErrorBoundary } from "./chat-error-boundary"

/**
 * ChatContainer - 聊天容器组件
 * 
 * 职责：
 * - 管理聊天会话的生命周期
 * - 协调数据获取（云端/本地）
 * - 处理路由和导航
 * - 提供错误边界保护
 * 
 * 数据流：
 * 1. 根据运行环境（Tauri/Web）选择数据源
 * 2. 通过 SWR Hooks 获取助手和模型数据
 * 3. 管理会话状态和历史记录
 * 4. 将数据传递给子组件渲染
 * 
 * 性能优化：
 * - 使用 useCallback 缓存事件处理函数
 * - 使用 useMemo 缓存计算结果
 * - 通过 Context 拆分减少不必要的重渲染
 * 
 * @example
 * ```tsx
 * // 在页面中使用
 * <ChatContainer agentId="assistant-123" />
 * ```
 * 
 * @see {@link ChatProvider} - Context 提供者
 * @see {@link ChatLayout} - 布局组件
 * @see {@link ChatContent} - 内容组件
 * 
 * Requirements: 1.1, 3.3, 11.1
 */

interface ChatContainerProps {
  /** 助手 ID，用于标识当前聊天的助手 */
  agentId: string
}

export function ChatContainer({ agentId }: ChatContainerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  
  const { setMessages, setInput } = useChatStateStore()
  const { setErrorMessage } = useChatSessionStore()

  // 环境检测（运行时安全的浏览器开发）
  // 使用 useMemo 缓存环境检测结果，避免每次渲染都重新计算
  const isTauriRuntime = React.useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  )

  // 云端服务 hook - 使用 SWR 获取数据
  const {
    assistant: cloudAssistant,
    models: cloudModels,
    modelGroups: cloudModelGroups,
    isLoadingAssistants,
    isLoadingModels,
    loadHistory,
  } = useChatService({ assistantId: agentId, enabled: !isTauriRuntime })

  // 代理管理 - 合并云端/本地代理
  const { agent, marketLoaded } = useChatAgent({
    agentId,
    isTauriRuntime,
    cloudAssistant,
  })

  // 会话管理 - 处理新聊天和会话存储
  const { handleNewChat } = useChatSession({ agentId })

  // 历史记录管理 - 加载和同步历史消息
  const { historyLoaded } = useChatHistory({
    agentId,
    agent,
    isTauriRuntime,
    loadHistory,
  })

  // 初始化和同步 - 清理状态
  // 使用 useCallback 缓存清理函数，避免依赖变化导致重复执行
  const resetChatState = React.useCallback(() => {
    setErrorMessage(null)
    setMessages([])
    setInput("")
  }, [setErrorMessage, setMessages, setInput])

  React.useEffect(() => {
    resetChatState()
  }, [agentId, resetChatState])

  // 路由检查 - 处理助手不存在的情况
  // 使用 useCallback 缓存路由检查逻辑
  const checkAndRedirect = React.useCallback(() => {
    // 跳过创建助手页面
    if (pathname?.includes("/chat/create/assistant")) return
    
    if (isTauriRuntime) {
      // 桌面端：等待市场数据加载完成
      if (!marketLoaded) return
      // 如果助手不存在，重定向到选择页
      if (!agent) router.replace("/chat")
      return
    }
    
    // Web 端：等待助手数据加载完成
    // 不强制重定向，避免在助手信息未加载完时产生跳转循环
    if (isLoadingAssistants) return
  }, [agent, marketLoaded, router, isTauriRuntime, isLoadingAssistants, pathname])

  React.useEffect(() => {
    checkAndRedirect()
  }, [checkAndRedirect])

  // 新聊天处理器 - 清理会话并更新 URL
  // 使用 useCallback 缓存处理函数，避免每次渲染都创建新函数
  const handleNewChatWithNavigation = React.useCallback(() => {
    handleNewChat()
    
    // 清理 URL 中的 session 参数
    const params = new URLSearchParams(searchParams?.toString())
    params.delete("session")
    const query = params.toString()
    const url = query ? `${pathname}?${query}` : pathname
    router.replace(url || "/chat")
  }, [handleNewChat, searchParams, pathname, router])

  // 使用 useMemo 缓存 ChatContent 的 props，减少不必要的重渲染
  const chatContentProps = React.useMemo(
    () => ({
      agent: agent || undefined,
      cloudModels,
      cloudModelGroups,
      isLoadingModels,
      isTauriRuntime,
      onNewChat: handleNewChatWithNavigation,
    }),
    [
      agent,
      cloudModels,
      cloudModelGroups,
      isLoadingModels,
      isTauriRuntime,
      handleNewChatWithNavigation,
    ]
  )

  return (
    <ChatErrorBoundary>
      <ChatProvider>
        <ChatLayout agent={agent || undefined} isLoadingAssistants={isLoadingAssistants}>
          {agent && <ChatContent {...chatContentProps} />}
        </ChatLayout>
      </ChatProvider>
    </ChatErrorBoundary>
  )
}
