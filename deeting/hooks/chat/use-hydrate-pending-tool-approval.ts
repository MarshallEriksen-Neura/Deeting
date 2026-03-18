"use client"

import { useEffect, useMemo, useRef } from "react"
import { listPendingMcpApprovals } from "@/lib/api/mcp-approvals"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import {
  buildBridgeToolApprovalFromPendingSnapshot,
  enqueueBridgeToolApproval,
  findMessageIdForToolCall,
} from "@/lib/chat/tool-approval"
import type { Message } from "@/lib/chat/message-types"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

export function useHydratePendingToolApproval(
  sessionId: string | null | undefined,
  messages: Message[]
) {
  const pendingToken = useBridgeApprovalStore((state) => state.pending?.approval_token ?? null)
  const lastHydratedKeyRef = useRef<string | null>(null)

  const callIdToMessageId = useMemo(() => {
    const index = new Map<string, string>()
    for (const message of messages) {
      if (message.role !== "assistant" || !Array.isArray(message.blocks)) continue
      for (const block of message.blocks) {
        if ((block.type === "tool_call" || block.type === "tool_result") && block.callId) {
          index.set(block.callId, message.id)
        }
      }
    }
    return index
  }, [messages])

  useEffect(() => {
    const normalizedSessionId =
      typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : null
    if (!normalizedSessionId) {
      lastHydratedKeyRef.current = null
      return
    }
    if (!isTauriRuntime() || pendingToken) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const snapshots = await listPendingMcpApprovals(normalizedSessionId)
        if (cancelled || snapshots.length === 0) return

        const snapshot = snapshots[0]
        const approvalKey =
          typeof snapshot.approval_token === "string" && snapshot.approval_token.trim().length > 0
            ? `${normalizedSessionId}:${snapshot.approval_token.trim()}`
            : null
        if (!approvalKey || lastHydratedKeyRef.current === approvalKey) return

        const resolvedMessageId =
          (typeof snapshot.call_id === "string" ? callIdToMessageId.get(snapshot.call_id) : undefined) ??
          findMessageIdForToolCall(messages, snapshot.call_id)
        if (!resolvedMessageId && messages.length === 0) {
          return
        }
        const approval = buildBridgeToolApprovalFromPendingSnapshot(snapshot, {
          messageId: resolvedMessageId,
        })
        if (!approval || cancelled) return

        enqueueBridgeToolApproval(approval)
        lastHydratedKeyRef.current = approvalKey
      } catch (error) {
        console.error("[useHydratePendingToolApproval] failed to restore pending approval", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [callIdToMessageId, messages, pendingToken, sessionId])
}
