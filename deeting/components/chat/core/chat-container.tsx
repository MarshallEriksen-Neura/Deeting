"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useChatStore } from "@/store/chat-store"
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"
import { ChatLayout } from "./chat-layout"
import { ChatContent } from "./chat-content"
import { ChatErrorBoundary } from "./chat-error-boundary"

/**
 * ChatContainer - 聊天容器组件（重构版 v2）
 *
 * 架构原则：
 * 1. 组件只负责调用 store.initSession() 一次
 * 2. Store 内部处理所有数据获取和状态管理
 * 3. 没有 useEffect 链式依赖，不会产生无限循环
 *
 * 数据流：
 * props.agentId + URL.sessionId → store.initSession() → 渲染
 */

interface ChatContainerProps {
  agentId: string
}

export function ChatContainer({ agentId }: ChatContainerProps) {
  const searchParams = useSearchParams()

  // 从 store 获取状态和 action
  const initSession = useChatStore((state) => state.initSession)
  const selectedAssistant = useChatStore((state) => state.selectedAssistant)
  const initialized = useChatStore((state) => state.initialized)

  // 环境检测
  const isTauriRuntime = detectTauriRuntime()

  // 获取 sessionId（稳定计算，不依赖 state）
  const sessionId = React.useMemo(() => {
    const querySessionId = searchParams?.get("session")?.trim()
    if (querySessionId) return querySessionId
    return null
  }, [searchParams])

  // 使用 ref 追踪是否已调用 initSession，避免重复调用
  const initCalledRef = React.useRef<string | null>(null)

  // 唯一的 Effect：初始化会话
  // 只在 agentId 或 sessionId 变化时调用
  React.useEffect(() => {
    const runtimeAgentId = isTauriRuntime ? "" : agentId
    const initKey = `${runtimeAgentId}:${sessionId ?? ""}`
    if (initCalledRef.current === initKey) return

    initCalledRef.current = initKey
    void initSession(isTauriRuntime ? "" : agentId, sessionId, null)
  }, [agentId, sessionId, isTauriRuntime, initSession])

  // 显示加载状态
  const showLoading = !initialized

  return (
    <ChatErrorBoundary>
      <ChatLayout
        agent={selectedAssistant ?? undefined}
        isLoadingAssistants={showLoading}
        allowMissingAgent
      >
        <ChatContent agent={selectedAssistant ?? undefined} />
      </ChatLayout>
    </ChatErrorBoundary>
  )
}
