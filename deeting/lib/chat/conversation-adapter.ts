import { parseMessageContent } from "@/lib/chat/message-content"
import { normalizeMessage } from "@/lib/chat/message-normalizer"
import type { ConversationMessage } from "@/lib/api/conversations"
import type { Message, MessageMetaInfo, ToolCall } from "@/lib/chat/message-types"
import type { MessageBlock } from "@/lib/chat/message-protocol"

const DEFAULT_ROLES = ["user", "assistant"] as const

const normalizeRole = (role: unknown): "user" | "assistant" | "system" | "" => {
  if (typeof role !== "string") return ""
  const normalized = role.trim().toLowerCase()
  if (normalized === "assistant") return "assistant"
  if (normalized === "system") return "system"
  if (normalized === "user") return "user"
  return ""
}

const isToolCallArray = (value: unknown): value is ToolCall[] =>
  Array.isArray(value)

const isBlockArray = (value: unknown): value is MessageBlock[] =>
  Array.isArray(value) && value.every((item) => item && typeof item === "object" && "type" in item)

const normalizeBlocks = (blocks: MessageBlock[], messageId: string): MessageBlock[] => {
  return blocks.map((block, index) => ({
    ...block,
    id: block.id || `${messageId}-block-${index}`,
    streamState: block.streamState || 'completed',
    displayMode: block.displayMode || 'bubble',
  }))
}

const readContentCandidate = (message: ConversationMessage): unknown => {
  if (message.content !== undefined && message.content !== null) {
    return message.content
  }
  const meta = message.meta_info as MessageMetaInfo | undefined
  if (meta && "content" in meta) {
    return meta.content
  }
  return null
}

export function normalizeConversationMessages(
  messages: ConversationMessage[],
  options: {
    idPrefix?: string
    includeRoles?: Array<"user" | "assistant" | "system">
  } = {}
): Message[] {
  const roleSet = new Set(options.includeRoles ?? DEFAULT_ROLES)
  const filtered = messages.filter((msg) => {
    const normalizedRole = normalizeRole(msg.role)
    return normalizedRole ? roleSet.has(normalizedRole) : false
  })
  const total = filtered.length
  return filtered.map((msg, index) => {
    const normalizedRole = normalizeRole(msg.role)
    const candidate = readContentCandidate(msg)
    const parsed = parseMessageContent(candidate)
    const metaInfo = msg.meta_info as MessageMetaInfo | undefined
    const toolCalls = isToolCallArray(metaInfo?.tool_calls)
      ? metaInfo?.tool_calls
      : undefined
    const toolCallId =
      typeof metaInfo?.tool_call_id === "string" ? metaInfo.tool_call_id : undefined
    const blocks = isBlockArray(metaInfo?.blocks)
      ? normalizeBlocks(metaInfo.blocks, `${options.idPrefix ?? "conv"}-${msg.turn_index ?? index}`)
      : normalizeMessage(parsed.text)
    return {
      id: `${options.idPrefix ?? "conv"}-${msg.turn_index ?? index}`,
      role: normalizedRole === "assistant" ? "assistant" : normalizedRole === "system" ? "system" : "user",
      content: parsed.text,
      attachments: parsed.attachments.length ? parsed.attachments : undefined,
      createdAt: Date.now() - (total - index) * 1000,
      metaInfo,
      toolCalls,
      toolCallId,
      blocks,
    }
  })
}
