import type { MessageBlock, ToolResultBlock } from "@/lib/chat/message-protocol"

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
    const toolCall = normalized[toolCallIndex] as MessageBlock & { status?: string }
    normalized[toolCallIndex] = {
      ...toolCall,
      status: block.status === "error" ? "error" : "success",
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
      id: (block as { id?: string }).id || `${messageId}-block-${startIndex + index}`,
      streamState: (block as { streamState?: string }).streamState || "completed",
      displayMode: (block as { displayMode?: string }).displayMode || "bubble",
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
