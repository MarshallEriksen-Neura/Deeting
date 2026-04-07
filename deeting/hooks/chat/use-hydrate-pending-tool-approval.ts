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
  const queuedApprovalTokenKey = useBridgeApprovalStore((state) =>
    state.queue.map((item) => item.approval_token).join("|")
  )
  const recentApprovedCallId = useBridgeApprovalStore(
    (state) => state.recentApprovedExecution?.call_id ?? null
  )
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
    if (!isTauriRuntime()) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const snapshots = await listPendingMcpApprovals(normalizedSessionId)
        if (cancelled || snapshots.length === 0) return

        const eligibleSnapshots = snapshots.filter((candidate) => {
          const callId = typeof candidate.call_id === "string" ? candidate.call_id.trim() : ""
          return !callId || callId !== recentApprovedCallId
        })
        if (eligibleSnapshots.length === 0) return

        const approvalKey = eligibleSnapshots
          .map((snapshot) =>
            typeof snapshot.approval_token === "string" ? snapshot.approval_token.trim() : ""
          )
          .filter((value) => value.length > 0)
          .join("|")
        if (!approvalKey || lastHydratedKeyRef.current === `${normalizedSessionId}:${approvalKey}`) {
          return
        }

        for (const snapshot of eligibleSnapshots) {
          const resolvedMessageId =
            (typeof snapshot.call_id === "string"
              ? callIdToMessageId.get(snapshot.call_id)
              : undefined) ?? findMessageIdForToolCall(messages, snapshot.call_id)
          if (!resolvedMessageId && messages.length === 0) {
            continue
          }
          const approval = buildBridgeToolApprovalFromPendingSnapshot(snapshot, {
            messageId: resolvedMessageId,
          })
          if (!approval || cancelled) continue
          enqueueBridgeToolApproval(approval)
        }
        lastHydratedKeyRef.current = `${normalizedSessionId}:${approvalKey}`
      } catch (error) {
        console.error("[useHydratePendingToolApproval] failed to restore pending approval", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [callIdToMessageId, messages, queuedApprovalTokenKey, recentApprovedCallId, sessionId])
}
