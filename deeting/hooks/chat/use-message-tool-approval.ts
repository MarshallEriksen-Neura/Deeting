"use client"

import { useEffect, useMemo, useRef } from "react"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import {
  enqueueBridgeToolApproval,
  findLatestMessageToolApproval,
} from "@/lib/chat/tool-approval"

export function useMessageToolApproval(
  messageId: string | null | undefined,
  blocks: MessageBlock[],
  options?: {
    fromHistory?: boolean
  }
) {
  const lastQueuedTokenRef = useRef<string | null>(null)
  const fromHistory = options?.fromHistory === true

  const approval = useMemo(() => {
    if (!messageId || fromHistory) return null
    return findLatestMessageToolApproval(blocks, { messageId })
  }, [blocks, fromHistory, messageId])

  useEffect(() => {
    if (!approval) return
    if (lastQueuedTokenRef.current === approval.approval_token) return
    enqueueBridgeToolApproval(approval)
    lastQueuedTokenRef.current = approval.approval_token
  }, [approval])
}
