"use client"

import { useEffect, useMemo, useRef } from "react"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import { refreshBridgePendingApprovalsFromCanonical } from "@/lib/chat/canonical-approval-refresh"
import type { Message } from "@/lib/chat/message-types"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

export function useHydratePendingToolApproval(
  sessionId: string | null | undefined,
  messages: Message[]
) {
  const recentApprovedCallId = useBridgeApprovalStore(
    (state) => state.recentApprovedExecution?.call_id ?? null
  )
  const lastHydratedKeyRef = useRef<string | null>(null)

  const messageSignature = useMemo(
    () =>
      messages
        .map((message) => {
          const callIds = Array.isArray(message.blocks)
            ? message.blocks
                .map((block) =>
                  (block.type === "tool_call" || block.type === "tool_result") && block.callId
                    ? block.callId
                    : ""
                )
                .filter((callId) => callId.length > 0)
                .join(",")
            : ""
          return `${message.id}:${callIds}`
        })
        .join("|"),
    [messages]
  )

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
        const bridgeApprovalState = useBridgeApprovalStore.getState()
        const { approvalKey } = await refreshBridgePendingApprovalsFromCanonical({
          sessionId: normalizedSessionId,
          messages,
          excludeCallIds: recentApprovedCallId ? [recentApprovedCallId] : [],
          preferredApprovalToken: bridgeApprovalState.pending?.approval_token ?? null,
          currentApprovalKey: bridgeApprovalState.queue
            .map((item) => item.approval_token)
            .join("|"),
        })
        if (cancelled || !approvalKey) return
        if (!approvalKey || lastHydratedKeyRef.current === `${normalizedSessionId}:${approvalKey}`) {
          return
        }
        lastHydratedKeyRef.current = `${normalizedSessionId}:${approvalKey}`
      } catch (error) {
        console.error("[useHydratePendingToolApproval] failed to restore pending approval", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    messageSignature,
    messages,
    recentApprovedCallId,
    sessionId,
  ])
}
