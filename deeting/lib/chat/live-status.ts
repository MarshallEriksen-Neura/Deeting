"use client"

import { deriveAssistantActivityState } from "@/lib/chat/assistant-activity"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import type { Message } from "@/store/chat-store"

export type ChatStatusUpdate = {
  messageId: string
  stage: string | null
  code: string | null
  meta: Record<string, unknown> | null
}

export function deriveChatStatusUpdateForMessage(
  messages: Message[],
  messageId: string | null | undefined
): ChatStatusUpdate | null {
  const normalizedMessageId =
    typeof messageId === "string" && messageId.trim().length > 0
      ? messageId.trim()
      : null
  if (!normalizedMessageId) return null

  const blocks =
    messages.find((candidate) => candidate.id === normalizedMessageId)?.blocks ?? []
  const activity = deriveAssistantActivityState(blocks as MessageBlock[])
  if (!activity.isActive) return null

  return {
    messageId: normalizedMessageId,
    stage: activity.statusStage,
    code: activity.statusCode,
    meta: activity.statusMeta,
  }
}
