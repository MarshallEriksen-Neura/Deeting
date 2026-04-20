"use client"

import * as React from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"

import { ChatContainer } from "@/components/chat/core"
import { fetchConversationSessions } from "@/lib/api/conversations"
import { isTauriRuntime as detectTauriRuntime } from "@/lib/runtime/tauri"

import { ChatRouteFallback } from "./chat-route-fallback"

const DESKTOP_SESSION_RESTORE_TIMEOUT_MS = 3000
const DESKTOP_SESSION_RESTORE_TIMEOUT = Symbol("desktop-session-restore-timeout")
const LEGACY_ROUTE_NORMALIZE_TIMEOUT_MS = 1500

function ChatRouteClient() {
  const router = useRouter()
  const params = useParams<{ agentId?: string | string[] }>()
  const searchParams = useSearchParams()
  const isTauriRuntime = detectTauriRuntime()

  const pathAgentId = React.useMemo(() => {
    const value = params?.agentId
    return Array.isArray(value) ? value[0] : value
  }, [params?.agentId])

  const queryAgentId = React.useMemo(
    () => searchParams?.get("agentId")?.trim() || null,
    [searchParams]
  )
  const querySessionId = React.useMemo(
    () => searchParams?.get("session")?.trim() || null,
    [searchParams]
  )
  const searchParamsKey = React.useMemo(() => searchParams?.toString() ?? "", [searchParams])
  const hasLegacyAssistantRoute = Boolean(pathAgentId || queryAgentId)
  const [isNormalizingLegacyRoute, setIsNormalizingLegacyRoute] = React.useState(
    () => isTauriRuntime && hasLegacyAssistantRoute
  )

  const redirectedRef = React.useRef(false)
  const desktopRestoreKeyRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!isTauriRuntime) {
      redirectedRef.current = false
      setIsNormalizingLegacyRoute(false)
      return
    }

    if (!hasLegacyAssistantRoute) {
      redirectedRef.current = false
      setIsNormalizingLegacyRoute(false)
      return
    }

    setIsNormalizingLegacyRoute(true)

    if (!redirectedRef.current) {
      redirectedRef.current = true
      router.replace("/chat")
    }

    const timeoutId = window.setTimeout(() => {
      console.warn(
        "desktop legacy chat route normalization timed out; continuing with in-place session restore",
        {
          pathAgentId: pathAgentId ?? null,
          queryAgentId: queryAgentId ?? null,
        }
      )
      setIsNormalizingLegacyRoute(false)
    }, LEGACY_ROUTE_NORMALIZE_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hasLegacyAssistantRoute, isTauriRuntime, pathAgentId, queryAgentId, router])

  React.useEffect(() => {
    if (!isTauriRuntime) return
    if (hasLegacyAssistantRoute && (!redirectedRef.current || isNormalizingLegacyRoute)) return
    if (querySessionId) return

    const restoreKey = `${pathAgentId ?? ""}|${searchParamsKey}`
    if (desktopRestoreKeyRef.current === restoreKey) return

    desktopRestoreKeyRef.current = restoreKey
    let cancelled = false
    let timeoutId: number | null = null

    void (async () => {
      try {
        const page = await Promise.race([
          fetchConversationSessions({ size: 1, status: "active" }),
          new Promise<typeof DESKTOP_SESSION_RESTORE_TIMEOUT>((resolve) => {
            timeoutId = window.setTimeout(
              () => resolve(DESKTOP_SESSION_RESTORE_TIMEOUT),
              DESKTOP_SESSION_RESTORE_TIMEOUT_MS
            )
          }),
        ])
        if (cancelled) return

        if (page === DESKTOP_SESSION_RESTORE_TIMEOUT) {
          console.warn("desktop latest chat session restore timed out; falling back to empty chat")
          return
        }

        const latestSessionId = page.items?.[0]?.session_id?.trim()

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
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    hasLegacyAssistantRoute,
    isNormalizingLegacyRoute,
    isTauriRuntime,
    pathAgentId,
    querySessionId,
    router,
    searchParamsKey,
  ])

  const shouldBlockChatRender =
    isTauriRuntime &&
    (hasLegacyAssistantRoute && (!redirectedRef.current || isNormalizingLegacyRoute))

  if (shouldBlockChatRender) {
    return <ChatRouteFallback />
  }

  return <ChatContainer agentId="" />
}

export const ChatRouteClientMemo = React.memo(ChatRouteClient)
