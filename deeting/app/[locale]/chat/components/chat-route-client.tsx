"use client"

import * as React from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/store/chat-store"
import { ChatController } from "./chat-controller"

export function ChatRouteClient() {
  const router = useRouter()
  const params = useParams<{ agentId?: string | string[] }>()
  const searchParams = useSearchParams()
  const storedAgentId = useChatStore((state) => state.activeAssistantId)
  const [resolvedAgentId, setResolvedAgentId] = React.useState<string | null>(null)

  const pathAgentId = React.useMemo(() => {
    const value = params?.agentId
    return Array.isArray(value) ? value[0] : value
  }, [params?.agentId])

  const queryAgentId = React.useMemo(
    () => searchParams?.get("agentId")?.trim() || null,
    [searchParams]
  )

  React.useEffect(() => {
    const nextId = pathAgentId || queryAgentId || storedAgentId || null
    setResolvedAgentId(nextId)
  }, [pathAgentId, queryAgentId, storedAgentId])

  // Logic controller (Headless)
  return <ChatController agentId={resolvedAgentId || ""} />
}
