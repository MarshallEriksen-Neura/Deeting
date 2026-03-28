"use client"

import * as React from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { ChatContainer } from "@/components/chat/core"
import { fetchConversationSessions } from "@/lib/api/conversations"
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"
import { ChatRouteFallback } from "./chat-route-fallback"

/**
 * ChatRouteClient - 聊天路由客户端组件
 * 
 * 功能：
 * - 解析历史聊天路由参数（agentId）
 * - 在桌面端忽略旧助手路由参数并统一回到 `/chat`
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
  const isTauriRuntime = detectTauriRuntime()
  const [isResolvingDesktopSession, setIsResolvingDesktopSession] = React.useState(false)
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
  const querySessionId = React.useMemo(
    () => searchParams?.get("session")?.trim() || null,
    [searchParams]
  )
  const searchParamsKey = React.useMemo(() => searchParams?.toString() ?? "", [searchParams])

  const redirectedRef = React.useRef(false)
  const desktopRestoreKeyRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!isTauriRuntime) return
    if ((pathAgentId || queryAgentId) && !redirectedRef.current) {
      redirectedRef.current = true
      router.replace(`/chat`)
    }
  }, [isTauriRuntime, pathAgentId, queryAgentId, router])

  React.useEffect(() => {
    if (!isTauriRuntime) return
    if (pathAgentId || queryAgentId) return
    if (querySessionId) return

    const restoreKey = searchParamsKey
    if (desktopRestoreKeyRef.current === restoreKey) return

    desktopRestoreKeyRef.current = restoreKey
    let cancelled = false
    setIsResolvingDesktopSession(true)

    void (async () => {
      try {
        const page = await fetchConversationSessions({ size: 1, status: "active" })
        const latestSessionId = page.items?.[0]?.session_id?.trim()
        if (cancelled) return

        if (latestSessionId) {
          const nextParams = new URLSearchParams(searchParamsKey)
          nextParams.delete("agentId")
          nextParams.set("session", latestSessionId)
          const query = nextParams.toString()
          router.replace(query ? `/chat?${query}` : "/chat")
          return
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("desktop latest chat session restore failed", error)
        }
      } finally {
        if (!cancelled) {
          setIsResolvingDesktopSession(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isTauriRuntime, pathAgentId, queryAgentId, querySessionId, router, searchParamsKey])

  if (isTauriRuntime && ((pathAgentId || queryAgentId) || isResolvingDesktopSession)) {
    return <ChatRouteFallback />
  }

  return <ChatContainer agentId="" />
}

// 使用 React.memo 优化，避免不必要的重渲染
export const ChatRouteClientMemo = React.memo(ChatRouteClient)
