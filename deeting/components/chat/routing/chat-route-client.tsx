"use client"

import * as React from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
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
  const isTauriRuntime = React.useMemo(
    () =>
      process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window),
    []
  )
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

  const redirectedRef = React.useRef(false)

  React.useEffect(() => {
    if (!isTauriRuntime) return
    if ((pathAgentId || queryAgentId) && !redirectedRef.current) {
      redirectedRef.current = true
      router.replace(`/chat`)
    }
  }, [isTauriRuntime, pathAgentId, queryAgentId, router])

  return <ChatContainer agentId="" />
}

// 使用 React.memo 优化，避免不必要的重渲染
export const ChatRouteClientMemo = React.memo(ChatRouteClient)
