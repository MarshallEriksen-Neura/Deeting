"use client"

import { useEffect, useMemo } from "react"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import {
  enqueueBridgeToolApproval,
  findMessageToolApprovals,
} from "@/lib/chat/tool-approval"

export function useMessageToolApproval(
  messageId: string | null | undefined,
  blocks: MessageBlock[],
  options?: {
    fromHistory?: boolean
  }
) {
  const fromHistory = options?.fromHistory === true

  const approvals = useMemo(() => {
    if (!messageId || fromHistory) return []
    return findMessageToolApprovals(blocks, { messageId })
  }, [blocks, fromHistory, messageId])

  useEffect(() => {
    if (approvals.length === 0) return
    for (const approval of approvals) {
      enqueueBridgeToolApproval(approval)
    }
  }, [approvals])
}
