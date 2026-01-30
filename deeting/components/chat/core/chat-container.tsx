"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useChatStore, type ChatAssistant } from "@/store/chat-store"
import { useMarketStore } from "@/store/market-store"
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // 从 store 获取状态和 action
  const initSession = useChatStore((state) => state.initSession)
  const agent = useChatStore((state) => state.agent)
  const isLoading = useChatStore((state) => state.isLoading)
  const initialized = useChatStore((state) => state.initialized)
  const storeAgentId = useChatStore((state) => state.agentId)

  // 环境检测
  const isTauriRuntime = React.useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  )

  const chatRootPath = React.useMemo(() => {
    if (!pathname) return "/chat"
    const index = pathname.indexOf("/chat")
    if (index === -1) return "/chat"
    return pathname.slice(0, index + 5)
  }, [pathname])

  // Tauri 本地代理
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants)
  const marketLoaded = useMarketStore((state) => state.loaded)

  const localAgent = React.useMemo<ChatAssistant | null>(
    () => installedAgents.find((a) => a.id === agentId) ?? null,
    [installedAgents, agentId]
  )

  // 获取 sessionId（稳定计算，不依赖 state）
  const sessionId = React.useMemo(() => {
    const querySessionId = searchParams?.get("session")?.trim()
    if (querySessionId) return querySessionId
    return null
  }, [searchParams, agentId])

  // 使用 ref 追踪是否已调用 initSession，避免重复调用
  const initCalledRef = React.useRef<string | null>(null)

  // 唯一的 Effect：初始化会话
  // 只在 agentId 或 sessionId 变化时调用
  React.useEffect(() => {
    // 生成唯一 key，避免重复初始化
    const initKey = `${agentId}:${sessionId ?? ""}`
    if (initCalledRef.current === initKey) return
    initCalledRef.current = initKey

    // Tauri 环境：使用本地 agent
    if (isTauriRuntime) {
      if (!marketLoaded) return // 等待市场数据加载
      void initSession(agentId, sessionId, localAgent)
    } else {
      // 云端环境：store 内部会获取 agent 数据
      void initSession(agentId, sessionId, null)
    }
  }, [agentId, sessionId, isTauriRuntime, marketLoaded, localAgent, initSession])

  // 同步 sessionId 到 localStorage
  React.useEffect(() => {
    const querySessionId = searchParams?.get("session")?.trim()
    if (querySessionId && typeof window !== "undefined") {
      localStorage.setItem(`deeting-chat-session:${agentId}`, querySessionId)
    }
  }, [searchParams, agentId])

  // Tauri 环境：加载本地 assistants
  React.useEffect(() => {
    if (!isTauriRuntime || marketLoaded) return
    void loadLocalAssistants()
  }, [isTauriRuntime, marketLoaded, loadLocalAssistants])

  // 路由检查：如果 agent 不存在，重定向到 chat 根路径
  React.useEffect(() => {
    if (pathname?.includes("/chat/create/assistant")) return
    if (!isTauriRuntime) return

    if (marketLoaded && !localAgent && pathname !== chatRootPath) {
      router.replace(chatRootPath)
    }
  }, [isTauriRuntime, marketLoaded, localAgent, pathname, chatRootPath, router])

  // 显示加载状态
  const showLoading = !initialized || (isLoading && !agent)

  return (
    <ChatErrorBoundary>
      <ChatLayout
        agent={agent ?? undefined}
        isLoadingAssistants={showLoading}
        allowMissingAgent={!isTauriRuntime}
      >
        <ChatContent agent={agent ?? undefined} />
      </ChatLayout>
    </ChatErrorBoundary>
  )
}
