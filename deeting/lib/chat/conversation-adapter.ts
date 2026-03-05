import { parseMessageContent } from "@/lib/chat/message-content"
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

const hasRenderableBlocks = (blocks: MessageBlock[]) =>
  blocks.some((block) => {
    if (block.type === "text") {
      return typeof block.content === "string" && block.content.trim().length > 0
    }
    if (block.type === "thought") {
      return true
    }
    if (block.type === "tool_call") {
      return Boolean(block.toolName || block.toolArgs || block.status)
    }
    if (block.type === "tool_result") {
      return Boolean(block.callId || block.toolName || block.result !== undefined)
    }
    if (block.type === "error") {
      return typeof block.message === "string" && block.message.trim().length > 0
    }
    if (block.type === "ui") {
      return typeof block.viewType === "string" && block.viewType.trim().length > 0
    }
    if (block.type === "execution_section") {
      return typeof block.title === "string" && block.title.trim().length > 0
    }
    if (block.type === "console_log") {
      return typeof block.content === "string" && block.content.trim().length > 0
    }
    if (block.type === "flight_offer" || block.type === "file_preview") {
      return true
    }
    return false
  })

const normalizeLineBreaks = (text: string) => text.replace(/\r\n?/g, "\n")

const decodeEscapedNewlines = (text: string) => {
  if (text.includes("\n")) return text
  if (!text.includes("\\n")) return text
  return text.replace(/\\n/g, "\n")
}

const normalizeTextValue = (value: string) =>
  decodeEscapedNewlines(normalizeLineBreaks(value))

const extractAssistantTextFromBlocks = (blocks: MessageBlock[]): string =>
  blocks.reduce((acc, block) => {
    if (block.type !== "text") return acc
    if (typeof block.content !== "string") return acc
    return `${acc}${block.content}`
  }, "")

const normalizeBlocks = (blocks: MessageBlock[], messageId: string): MessageBlock[] => {
  return blocks.map((block, index) => {
    const normalizedBase = {
      ...block,
      id: block.id || `${messageId}-block-${index}`,
      streamState: block.streamState || "completed",
      displayMode: block.displayMode || "bubble",
    }

    if (block.type === "text") {
      return {
        ...normalizedBase,
        content: normalizeTextValue(
          typeof block.content === "string" ? block.content : String(block.content ?? "")
        ),
      }
    }

    if (block.type === "thought") {
      return {
        ...normalizedBase,
        content: normalizeTextValue(
          typeof block.content === "string" ? block.content : String(block.content ?? "")
        ),
      }
    }

    if (block.type === "tool_call") {
      return {
        ...normalizedBase,
        toolName: typeof block.toolName === "string" ? block.toolName : undefined,
        toolArgs:
          typeof block.toolArgs === "string"
            ? normalizeTextValue(block.toolArgs)
            : undefined,
      }
    }

    if (block.type === "tool_result") {
      const debug =
        block.debug && typeof block.debug === "object"
          ? (block.debug as Record<string, unknown>)
          : undefined
      return {
        ...normalizedBase,
        callId: typeof block.callId === "string" ? block.callId : undefined,
        toolName: typeof block.toolName === "string" ? block.toolName : undefined,
        status:
          block.status === "success" || block.status === "error"
            ? block.status
            : undefined,
        result:
          typeof block.result === "string"
            ? normalizeTextValue(block.result)
            : block.result,
        ui: block.ui,
        debug,
      }
    }

    if (block.type === "error") {
      return {
        ...normalizedBase,
        message: normalizeTextValue(
          typeof block.message === "string" ? block.message : String(block.message ?? "")
        ),
      }
    }

    return normalizedBase
  })
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

const resolveCreatedAt = (
  message: ConversationMessage,
  index: number,
  total: number
): number => {
  if (typeof message.created_at === "string" && message.created_at.trim()) {
    const parsed = Date.parse(message.created_at)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return Date.now() - (total - index) * 1000
}

/** Re-order blocks so each tool_result follows its matching tool_call (by callId). */
const interleaveToolBlocks = (blocks: MessageBlock[]): MessageBlock[] => {
  const resultsByCallId = new Map<string, MessageBlock>()
  const callIdSet = new Set<string>()

  for (const block of blocks) {
    if (block.type === "tool_call" && block.callId) {
      callIdSet.add(block.callId)
    }
  }
  for (const block of blocks) {
    if (block.type === "tool_result" && block.callId && callIdSet.has(block.callId)) {
      resultsByCallId.set(block.callId, block)
    }
  }

  if (resultsByCallId.size === 0) return blocks

  const result: MessageBlock[] = []
  for (const block of blocks) {
    if (block.type === "tool_result" && block.callId && resultsByCallId.has(block.callId)) {
      continue
    }
    result.push(block)
    if (block.type === "tool_call" && block.callId && resultsByCallId.has(block.callId)) {
      result.push(resultsByCallId.get(block.callId)!)
    }
  }
  return result
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
    const normalizedText = normalizeTextValue(parsed.text)
    const metaInfo = msg.meta_info as MessageMetaInfo | undefined
    const toolCalls = isToolCallArray(metaInfo?.tool_calls)
      ? metaInfo?.tool_calls
      : undefined
    const toolCallId =
      typeof metaInfo?.tool_call_id === "string" ? metaInfo.tool_call_id : undefined
    const messageId = `${options.idPrefix ?? "conv"}-${msg.turn_index ?? index}`
    const assistantBlocks = isBlockArray(metaInfo?.blocks)
      ? interleaveToolBlocks(normalizeBlocks(metaInfo.blocks, messageId))
      : []
    const resolvedAssistantBlocks =
      assistantBlocks.length > 0 && hasRenderableBlocks(assistantBlocks)
        ? assistantBlocks
        : []
    const assistantText = extractAssistantTextFromBlocks(resolvedAssistantBlocks)
    const resolvedBlocks =
      normalizedRole === "assistant" ? resolvedAssistantBlocks : undefined
    const resolvedContent =
      normalizedRole === "assistant" ? assistantText : normalizedText
    return {
      id: messageId,
      role: normalizedRole === "assistant" ? "assistant" : normalizedRole === "system" ? "system" : "user",
      content: resolvedContent,
      attachments: parsed.attachments.length ? parsed.attachments : undefined,
      createdAt: resolveCreatedAt(msg, index, total),
      metaInfo,
      toolCalls,
      toolCallId,
      fromHistory: true,
      ...(resolvedBlocks !== undefined ? { blocks: resolvedBlocks } : {}),
    }
  })
}
