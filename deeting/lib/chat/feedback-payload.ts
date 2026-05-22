export type ChatFeedbackReasonPayload = {
  comment?: string | null
  tags?: string[] | null
}

export function buildChatFeedbackPayload(
  polarity: "positive" | "negative",
  reasonIds: string[],
  comment: string
): ChatFeedbackReasonPayload {
  const normalizedReasonIds = Array.from(
    new Set(reasonIds.map((value) => value.trim()).filter(Boolean))
  )
  const trimmedComment = comment.trim()
  return {
    comment: trimmedComment.length > 0 ? trimmedComment : null,
    tags: ["chat_feedback", polarity, ...normalizedReasonIds],
  }
}

export function hasActionableFeedbackReason(payload: ChatFeedbackReasonPayload): boolean {
  const hasReasonTag = Array.isArray(payload.tags) && payload.tags.length > 2
  const hasComment = typeof payload.comment === "string" && payload.comment.trim().length > 0
  return hasReasonTag || hasComment
}
