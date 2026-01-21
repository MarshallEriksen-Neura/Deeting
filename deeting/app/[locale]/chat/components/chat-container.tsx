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

interface ChatContainerProps {
  agentId: string
}

export function ChatContainer({ agentId }: ChatContainerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  
  const { setMessages, setInput } = useChatStateStore()
  const { setErrorMessage } = useChatSessionStore()

  // 环境检测（运行时安全的浏览器开发）
  const isTauriRuntime =
    process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

  // 云端服务 hook
  const {
    assistant: cloudAssistant,
    models: cloudModels,
    modelGroups: cloudModelGroups,
    isLoadingAssistants,
    isLoadingModels,
    loadHistory,
  } = useChatService({ assistantId: agentId, enabled: !isTauriRuntime })

  // 代理管理
  const { agent, marketLoaded } = useChatAgent({
    agentId,
    isTauriRuntime,
    cloudAssistant,
  })

  // 会话管理
  const { handleNewChat } = useChatSession({ agentId })

  // 历史记录管理
  const { historyLoaded } = useChatHistory({
    agentId,
    agent,
    isTauriRuntime,
    loadHistory,
  })

  // 初始化和同步
  React.useEffect(() => {
    setErrorMessage(null)
    setMessages([])
    setInput("")
  }, [agentId, setErrorMessage, setMessages, setInput])

  // 路由检查
  React.useEffect(() => {
    if (pathname?.includes("/chat/create/assistant")) return
    
    if (isTauriRuntime) {
      if (!marketLoaded) return
      // 桌面端仍保持兜底回到选择页
      if (!agent) router.replace("/chat")
      return
    }
    
    // Web 端不强制重定向，避免在助手信息未加载完时产生跳转循环
    if (isLoadingAssistants) return
  }, [agent, marketLoaded, router, isTauriRuntime, isLoadingAssistants, pathname])

  // 新聊天处理器
  const handleNewChatWithNavigation = React.useCallback(() => {
    handleNewChat()
    const params = new URLSearchParams(searchParams?.toString())
    params.delete("session")
    const query = params.toString()
    const url = query ? `${pathname}?${query}` : pathname
    router.replace(url || "/chat")
  }, [handleNewChat, searchParams, pathname, router])

  return (
    <ChatErrorBoundary>
      <ChatProvider>
        <ChatLayout agent={agent || undefined} isLoadingAssistants={isLoadingAssistants}>
          {agent && (
            <ChatContent
              agent={agent}
              cloudModels={cloudModels}
              cloudModelGroups={cloudModelGroups}
              isLoadingModels={isLoadingModels}
              isTauriRuntime={isTauriRuntime}
              onNewChat={handleNewChatWithNavigation}
            />
          )}
        </ChatLayout>
      </ChatProvider>
    </ChatErrorBoundary>
  )
}