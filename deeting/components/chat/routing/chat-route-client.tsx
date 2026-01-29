"use client"

import * as React from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useChatStateStore } from "@/store/chat-state-store"
import { ChatContainer } from "@/components/chat/core"

/**
 * ChatRouteClient - 聊天路由客户端组件
 * 
 * 功能：
 * - 解析路由参数（agentId）
 * - 管理助手 ID 的优先级（路径 > 查询参数 > 存储）
 * - 渲染 ChatContainer
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useMemo 缓存计算值
 */
function ChatRouteClient() {
  const router = useRouter()
  const params = useParams<{ agentId?: string | string[] }>()
  const searchParams = useSearchParams()
  const storedAgentId = useChatStateStore((state) => state.activeAssistantId)
  // 缓存路径中的 agentId
  const pathAgentId = React.useMemo(() => {
    const value = params?.agentId
    return Array.isArray(value) ? value[0] : value
  }, [params?.agentId])

  // 缓存查询参数中的 agentId
  const queryAgentId = React.useMemo(
    () => searchParams?.get("agentId")?.trim() || null,
    [searchParams]
  )

  // 解析最终的 agentId（优先级：路径 > 查询参数 > 存储）
  const resolvedAgentId = pathAgentId || queryAgentId || storedAgentId || null

  // 处理自动重定向：使用 ref 防止重复调用 router.replace
  const redirectedRef = React.useRef(false)

  React.useEffect(() => {
    if (pathAgentId || queryAgentId) {
      // 已有路由参数，不需要重定向
      redirectedRef.current = false
      return
    }
    if (storedAgentId && !redirectedRef.current) {
      redirectedRef.current = true
      router.replace(`/chat/${storedAgentId}`)
    }
  }, [pathAgentId, queryAgentId, storedAgentId, router])

  // Chat UI container (uses chat-state-store)
  return <ChatContainer agentId={resolvedAgentId || ""} />
}

// 使用 React.memo 优化，避免不必要的重渲染
export const ChatRouteClientMemo = React.memo(ChatRouteClient)
