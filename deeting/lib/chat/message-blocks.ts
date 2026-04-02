import type { MessageBlock, ToolCallBlock, ToolResultBlock } from "@/lib/chat/message-protocol"
import { isToolApprovalResultBlock } from "@/lib/chat/assistant-activity"
import { extractRootExecutionIdFromBlock } from "@/lib/chat/execution-tree"

export function extractAssistantTextFromBlocks(blocks?: MessageBlock[]): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ""
  return blocks.reduce((acc, block) => {
    if (block.type !== "text") return acc
    if (typeof block.content !== "string") return acc
    return `${acc}${block.content}`
  }, "")
}

function isEmptyTextLikeBlock(block: MessageBlock): boolean {
  if (block.type === "text" || block.type === "thought") {
    return typeof block.content !== "string" || block.content.trim().length === 0
  }
  if (block.type === "error") {
    return typeof block.message !== "string" || block.message.trim().length === 0
  }
  return false
}

function upsertToolBlock(next: MessageBlock[], block: MessageBlock): boolean {
  if (block.type !== "tool_call" && block.type !== "tool_result") return false
  const callId = typeof block.callId === "string" ? block.callId.trim() : ""
  if (!callId) return false

  const existingIndex = next.findIndex(
    (candidate) => candidate.type === block.type && candidate.callId === callId
  )
  if (existingIndex < 0) return false

  const existing = next[existingIndex]
  if (block.type === "tool_call" && existing.type === "tool_call") {
    next[existingIndex] = {
      ...existing,
      ...block,
      id: existing.id || block.id,
    }
    return true
  }

  if (block.type === "tool_result" && existing.type === "tool_result") {
    next[existingIndex] = {
      ...existing,
      ...block,
      id: existing.id || block.id,
    }
    return true
  }

  return true
}

function upsertExecutionLifecycleBlock(next: MessageBlock[], block: MessageBlock): boolean {
  const rootExecutionId = extractRootExecutionIdFromBlock(block)
  if (!rootExecutionId) return false

  const existingIndex = next.findIndex(
    (candidate) => extractRootExecutionIdFromBlock(candidate) === rootExecutionId
  )
  if (existingIndex < 0) return false

  const existing = next[existingIndex]
  next[existingIndex] = {
    ...existing,
    ...block,
    id: existing.id || block.id,
  }
  return true
}

function applyToolResultStatuses(blocks: MessageBlock[]): MessageBlock[] {
  const normalized = [...blocks]
  for (const block of normalized) {
    if (block.type !== "tool_result") continue
    const callId = (block as { callId?: unknown }).callId
    if (typeof callId !== "string" || !callId) continue
    const toolCallIndex = normalized.findIndex(
      (candidate) => candidate.type === "tool_call" && (candidate as { callId?: unknown }).callId === callId
    )
    if (toolCallIndex < 0) continue
    const toolCall: ToolCallBlock | undefined =
      normalized[toolCallIndex]?.type === "tool_call"
        ? normalized[toolCallIndex]
        : undefined
    if (!toolCall || toolCall.type !== "tool_call") continue
    normalized[toolCallIndex] = {
      ...toolCall,
      status: block.status === "error" ? "error" : isToolApprovalResultBlock(block) ? "requires_approval" : "success",
    }
  }
  return normalized
}

function normalizeIncomingBlocks(messageId: string, blocks: MessageBlock[], startIndex = 0): MessageBlock[] {
  return blocks
    .filter((block): block is MessageBlock => Boolean(block && typeof block === "object" && "type" in block))
    .filter((block) => !isEmptyTextLikeBlock(block))
    .map((block, index) => ({
      ...block,
      id: block.id || `${messageId}-block-${startIndex + index}`,
      streamState: block.streamState || "completed",
      displayMode: block.displayMode || "bubble",
    }))
}

export function replaceMessageBlocks(messageId: string, blocks: MessageBlock[]): MessageBlock[] {
  return applyToolResultStatuses(normalizeIncomingBlocks(messageId, Array.isArray(blocks) ? blocks : []))
}

export function appendMessageBlocks(
  messageId: string,
  existingBlocks: MessageBlock[] | undefined,
  incomingBlocks: MessageBlock[]
): MessageBlock[] {
  const next = Array.isArray(existingBlocks) ? [...existingBlocks] : []
  const normalizedIncoming = normalizeIncomingBlocks(messageId, Array.isArray(incomingBlocks) ? incomingBlocks : [], next.length)

  for (const block of normalizedIncoming) {
    if (block.type === "text") {
      const last = next[next.length - 1]
      if (last?.type === "text") {
        next[next.length - 1] = { ...last, content: `${last.content}${block.content}` }
      } else {
        next.push(block)
      }
      continue
    }

    if (block.type === "thought") {
      const last = next[next.length - 1]
      if (last?.type === "thought") {
        next[next.length - 1] = { ...last, content: `${last.content}${block.content}` }
      } else {
        next.push(block)
      }
      continue
    }

    if (upsertToolBlock(next, block)) {
      continue
    }

    if (upsertExecutionLifecycleBlock(next, block)) {
      continue
    }

    next.push(block)
  }

  return applyToolResultStatuses(next)
}

export function upsertToolResultBlock(
  messageId: string,
  existingBlocks: MessageBlock[] | undefined,
  incomingBlock: ToolResultBlock
): MessageBlock[] {
  const next = Array.isArray(existingBlocks) ? [...existingBlocks] : []
  const [normalized] = normalizeIncomingBlocks(messageId, [incomingBlock], next.length)

  if (!normalized || normalized.type !== "tool_result") {
    return applyToolResultStatuses(next)
  }

  const callId = normalized.callId
    if (typeof callId === "string" && callId.trim().length > 0) {
      const existingIndex = next.findIndex(
        (block) => block.type === "tool_result" && block.callId === callId
      )
      if (existingIndex >= 0) {
        const existing = next[existingIndex]
        if (!existing || existing.type !== "tool_result") {
          return applyToolResultStatuses(next)
        }
        next[existingIndex] = {
          ...existing,
          ...normalized,
        id: existing.id || normalized.id,
      }
      return applyToolResultStatuses(next)
    }
  }

  next.push(normalized)
  return applyToolResultStatuses(next)
}
