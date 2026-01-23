"use client"

import * as React from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/store/chat-store"
import { ChatControllerMemo } from "@/components/chat/controller/chat-controller"

/**
 * ChatRouteClient - 聊天路由客户端组件
 * 
 * 功能：
 * - 解析路由参数（agentId）
 * - 管理助手 ID 的优先级（路径 > 查询参数 > 存储）
 * - 渲染 ChatController
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useMemo 缓存计算值
 */
function ChatRouteClient() {
  const router = useRouter()
  const params = useParams<{ agentId?: string | string[] }>()
  const searchParams = useSearchParams()
  const storedAgentId = useChatStore((state) => state.activeAssistantId)
  const [resolvedAgentId, setResolvedAgentId] = React.useState<string | null>(null)

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
  React.useEffect(() => {
    const nextId = pathAgentId || queryAgentId || storedAgentId || null
    setResolvedAgentId(nextId)
  }, [pathAgentId, queryAgentId, storedAgentId])

  // Logic controller (Headless)
  return <ChatControllerMemo agentId={resolvedAgentId || ""} />
}

// 使用 React.memo 优化，避免不必要的重渲染
export const ChatRouteClientMemo = React.memo(ChatRouteClient)
