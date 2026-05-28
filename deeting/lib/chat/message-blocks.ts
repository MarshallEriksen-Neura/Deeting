import type { MessageBlock, ToolCallBlock, ToolResultBlock } from "@/lib/chat/message-protocol"
import { mergeActivityTimelineBlock } from "@/lib/chat/runtime-activity"
import { isToolApprovalResultBlock } from "@/lib/chat/assistant-activity"
import { extractRootExecutionIdFromBlock } from "@/lib/chat/execution-tree"

type InternalMessageBlock = MessageBlock & {
  __insertedBeforeActiveToolChain?: boolean
}

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

function isToolVisualBlock(block: MessageBlock): boolean {
  return (
    block.type === "tool_call" ||
    block.type === "tool_result" ||
    (block.type === "ui" &&
      typeof block.callId === "string" &&
      block.callId.trim().length > 0)
  )
}

function isUiBlock(block: MessageBlock): block is Extract<MessageBlock, { type: "ui" }> {
  return block.type === "ui"
}

function stringifyBlockValue(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return "[unserializable]"
  }
}

function getUiBlockSignature(block: MessageBlock): string | null {
  if (!isUiBlock(block)) return null
  const callId = typeof block.callId === "string" ? block.callId.trim() : ""
  const viewType = typeof block.viewType === "string" ? block.viewType.trim() : ""
  if (!callId || !viewType) return null
  return [
    callId,
    viewType,
    typeof block.title === "string" ? block.title : "",
    stringifyBlockValue(block.metadata ?? null),
    stringifyBlockValue(block.payload ?? null),
  ].join("::")
}

function isActiveToolCallStatus(status: ToolCallBlock["status"] | undefined) {
  return status === "running" || status === "requires_approval"
}

function isTerminalToolStatus(status: string | undefined) {
  return status === "success" || status === "error"
}

function hasTerminalToolOutcomeForCall(
  blocks: InternalMessageBlock[],
  callId: string,
  blockType?: "tool_call" | "tool_result"
) {
  return blocks.some((candidate) => {
    if (candidate.callId !== callId) return false
    if (blockType && candidate.type !== blockType) return false
    if (candidate.type !== "tool_call" && candidate.type !== "tool_result") return false
    return isTerminalToolStatus(candidate.status)
  })
}

function isNarrativeBlock(
  block: MessageBlock,
): block is Extract<MessageBlock, { type: "text" | "thought" | "error" }> {
  return block.type === "text" || block.type === "thought" || block.type === "error"
}

function findNarrativeInsertionIndex(blocks: MessageBlock[]): number {
  const activeToolCallIds = new Set(
    blocks.flatMap((block) => {
      if (block.type !== "tool_call") return []
      const callId = typeof block.callId === "string" ? block.callId.trim() : ""
      return callId && isActiveToolCallStatus(block.status) ? [callId] : []
    }),
  )

  if (activeToolCallIds.size === 0) {
    return blocks.length
  }

  let insertionIndex = blocks.length

  while (insertionIndex > 0) {
    const candidate = blocks[insertionIndex - 1]
    if (!isToolVisualBlock(candidate)) {
      break
    }

    if (candidate.type === "tool_call") {
      const callId = typeof candidate.callId === "string" ? candidate.callId.trim() : ""
      if (!callId || !activeToolCallIds.has(callId)) {
        break
      }
      insertionIndex -= 1
      continue
    }

    const callId = typeof candidate.callId === "string" ? candidate.callId.trim() : ""
    if (!callId || !activeToolCallIds.has(callId)) {
      break
    }
    insertionIndex -= 1
  }

  return insertionIndex
}

function insertOrMergeNarrativeBlock(
  next: InternalMessageBlock[],
  block: Extract<InternalMessageBlock, { type: "text" | "thought" }>,
): void {
  const insertionIndex = findNarrativeInsertionIndex(next)
  const previous = next[insertionIndex - 1]
  const insertedBeforeActiveToolChain = insertionIndex < next.length

  if (previous?.type === block.type) {
    next[insertionIndex - 1] = {
      ...previous,
      content: `${previous.content}${block.content}`,
      __insertedBeforeActiveToolChain:
        previous.__insertedBeforeActiveToolChain || insertedBeforeActiveToolChain,
    }
    return
  }

  next.splice(insertionIndex, 0, {
    ...block,
    __insertedBeforeActiveToolChain: insertedBeforeActiveToolChain || undefined,
  })
}

function upsertToolBlock(next: InternalMessageBlock[], block: InternalMessageBlock): boolean {
  if (block.type !== "tool_call" && block.type !== "tool_result") return false
  const callId = typeof block.callId === "string" ? block.callId.trim() : ""
  if (!callId) return false

  if (block.status === "requires_approval") {
    const hasTerminalSameType = hasTerminalToolOutcomeForCall(next, callId, block.type)
    const hasTerminalResult = hasTerminalToolOutcomeForCall(next, callId, "tool_result")
    if (hasTerminalSameType || (block.type === "tool_call" && hasTerminalResult)) {
      return true
    }
  }

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

function upsertExecutionLifecycleBlock(next: InternalMessageBlock[], block: InternalMessageBlock): boolean {
  if (block.type !== "ui") return false
  const rootExecutionId = extractRootExecutionIdFromBlock(block)
  if (!rootExecutionId) return false

  const existingIndex = next.findIndex(
    (candidate) => extractRootExecutionIdFromBlock(candidate) === rootExecutionId
  )
  if (existingIndex < 0) return false

  const existing = next[existingIndex]
  if (!existing || existing.type !== "ui") return false
  next[existingIndex] = {
    ...existing,
    ...block,
    id: existing.id || block.id,
  }
  return true
}

function upsertUiBlock(next: InternalMessageBlock[], block: InternalMessageBlock): boolean {
  if (block.type !== "ui") return false
  const signature = getUiBlockSignature(block)
  if (!signature) return false

  const existingIndex = next.findIndex(
    (candidate) => candidate.type === "ui" && getUiBlockSignature(candidate) === signature,
  )
  if (existingIndex < 0) return false

  const existing = next[existingIndex]
  if (!existing || existing.type !== "ui") return false
  next[existingIndex] = {
    ...existing,
    ...block,
    id: existing.id || block.id,
  }
  return true
}

function upsertActivityTimelineBlock(
  next: InternalMessageBlock[],
  block: InternalMessageBlock,
): boolean {
  if (block.type !== "activity_timeline") return false
  const existingIndex = next.findIndex(
    (candidate) => candidate.type === "activity_timeline",
  )
  if (existingIndex < 0) return false
  const existing = next[existingIndex]
  if (!existing || existing.type !== "activity_timeline") return false
  next[existingIndex] = mergeActivityTimelineBlock(existing, block)
  return true
}

function upsertDitingThinkFrameBlock(
  next: InternalMessageBlock[],
  block: InternalMessageBlock,
): boolean {
  if (block.type !== "diting_think_frame") return false
  const existingIndex = next.findIndex(
    (candidate) => candidate.type === "diting_think_frame",
  )
  if (existingIndex < 0) return false
  const existing = next[existingIndex]
  if (!existing || existing.type !== "diting_think_frame") return false
  next[existingIndex] = {
    ...existing,
    ...block,
    id: existing.id || block.id,
  }
  return true
}

function applyToolResultStatuses(blocks: InternalMessageBlock[]): InternalMessageBlock[] {
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

function resolveDeferredNarrativePlacement(
  blocks: InternalMessageBlock[],
  index: number,
): { callId: string; sawLinkedToolVisual: boolean } | null {
  let sawLinkedToolVisual = false

  for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
    const candidate = blocks[cursor]
    if (!candidate) return null
    if (isNarrativeBlock(candidate)) {
      return null
    }
    if (candidate.type === "tool_call") {
      const callId = typeof candidate.callId === "string" ? candidate.callId.trim() : ""
      return callId ? { callId, sawLinkedToolVisual } : null
    }
    if (isToolVisualBlock(candidate)) {
      sawLinkedToolVisual = true
      continue
    }
    return null
  }

  return null
}

export function canonicalizeMessageBlockOrder(blocks: MessageBlock[]): MessageBlock[] {
  const normalized = applyToolResultStatuses(blocks as InternalMessageBlock[])
  const callIdsWithAnchors = new Set(
    normalized.flatMap((block) => {
      if (block.type !== "tool_call") return []
      const callId = typeof block.callId === "string" ? block.callId.trim() : ""
      return callId ? [callId] : []
    }),
  )

  const linkedResultIndices = new Set<number>()
  const linkedUiIndices = new Set<number>()
  const linkedResultsByCallId = new Map<string, InternalMessageBlock[]>()
  const linkedUiByCallId = new Map<string, InternalMessageBlock[]>()
  const linkedUiSignaturesByCallId = new Map<string, Set<string>>()

  normalized.forEach((block, index) => {
    const callId = typeof block.callId === "string" ? block.callId.trim() : ""
    if (!callId || !callIdsWithAnchors.has(callId)) return

    if (block.type === "tool_result") {
      linkedResultIndices.add(index)
      const existing = linkedResultsByCallId.get(callId) ?? []
      existing.push(block)
      linkedResultsByCallId.set(callId, existing)
      return
    }

    if (block.type === "ui") {
      const signature = getUiBlockSignature(block)
      if (!signature) return
      const seenSignatures = linkedUiSignaturesByCallId.get(callId) ?? new Set<string>()
      if (seenSignatures.has(signature)) {
        linkedUiIndices.add(index)
        return
      }
      seenSignatures.add(signature)
      linkedUiSignaturesByCallId.set(callId, seenSignatures)
      linkedUiIndices.add(index)
      const existing = linkedUiByCallId.get(callId) ?? []
      existing.push(block)
      linkedUiByCallId.set(callId, existing)
    }
  })

  const deferredNarrativeIndices = new Set<number>()
  const deferredNarrativesByCallId = new Map<string, InternalMessageBlock[]>()

  normalized.forEach((block, index) => {
    if (!isNarrativeBlock(block)) {
      return
    }

    const deferredPlacement = resolveDeferredNarrativePlacement(normalized, index)
    if (!deferredPlacement) {
      return
    }

    const shouldDefer =
      block.__insertedBeforeActiveToolChain || deferredPlacement.sawLinkedToolVisual
    if (!shouldDefer) {
      return
    }

    const anchor = normalized.find(
      (candidate): candidate is InternalMessageBlock & { type: "tool_call" } =>
        candidate.type === "tool_call" && candidate.callId === deferredPlacement.callId,
    )
    if (!anchor || isActiveToolCallStatus(anchor.status)) {
      return
    }

    deferredNarrativeIndices.add(index)
    const existing = deferredNarrativesByCallId.get(deferredPlacement.callId) ?? []
    existing.push({
      ...block,
      __insertedBeforeActiveToolChain: undefined,
    })
    deferredNarrativesByCallId.set(deferredPlacement.callId, existing)
  })

  const reordered: InternalMessageBlock[] = []

  normalized.forEach((block, index) => {
    if (deferredNarrativeIndices.has(index)) {
      return
    }

    if (linkedResultIndices.has(index) || linkedUiIndices.has(index)) {
      return
    }

    reordered.push(block)

    if (block.type !== "tool_call") {
      return
    }

    const callId = typeof block.callId === "string" ? block.callId.trim() : ""
    if (!callId) {
      return
    }

    const linkedResults = linkedResultsByCallId.get(callId) ?? []
    const linkedUi = linkedUiByCallId.get(callId) ?? []
    const deferredNarratives = deferredNarrativesByCallId.get(callId) ?? []

    reordered.push(...linkedResults, ...linkedUi, ...deferredNarratives)
  })

  return reordered
}

export function replaceMessageBlocks(messageId: string, blocks: MessageBlock[]): MessageBlock[] {
  return canonicalizeMessageBlockOrder(
    normalizeIncomingBlocks(messageId, Array.isArray(blocks) ? blocks : []),
  )
}

export function appendMessageBlocks(
  messageId: string,
  existingBlocks: MessageBlock[] | undefined,
  incomingBlocks: MessageBlock[]
): MessageBlock[] {
  const next = (Array.isArray(existingBlocks) ? [...existingBlocks] : []) as InternalMessageBlock[]
  const normalizedIncoming = normalizeIncomingBlocks(
    messageId,
    Array.isArray(incomingBlocks) ? incomingBlocks : [],
    next.length,
  ) as InternalMessageBlock[]

  for (const block of normalizedIncoming) {
    if (block.type === "text") {
      insertOrMergeNarrativeBlock(next, block)
      continue
    }

    if (block.type === "thought") {
      insertOrMergeNarrativeBlock(next, block)
      continue
    }

    if (upsertToolBlock(next, block)) {
      continue
    }

    if (upsertExecutionLifecycleBlock(next, block)) {
      continue
    }

    if (upsertUiBlock(next, block)) {
      continue
    }

    if (upsertActivityTimelineBlock(next, block)) {
      continue
    }

    if (upsertDitingThinkFrameBlock(next, block)) {
      continue
    }

    next.push(block)
  }

  return canonicalizeMessageBlockOrder(next)
}

export function upsertToolResultBlock(
  messageId: string,
  existingBlocks: MessageBlock[] | undefined,
  incomingBlock: ToolResultBlock
): MessageBlock[] {
  const next = (Array.isArray(existingBlocks) ? [...existingBlocks] : []) as InternalMessageBlock[]
  const [normalized] = normalizeIncomingBlocks(messageId, [incomingBlock], next.length) as InternalMessageBlock[]

  if (!normalized || normalized.type !== "tool_result") {
    return canonicalizeMessageBlockOrder(next)
  }

  const callId = normalized.callId
  if (typeof callId === "string" && callId.trim().length > 0) {
    const existingIndex = next.findIndex(
      (block) => block.type === "tool_result" && block.callId === callId,
    )
    if (existingIndex >= 0) {
      const existing = next[existingIndex]
      if (!existing || existing.type !== "tool_result") {
        return canonicalizeMessageBlockOrder(next)
      }
      next[existingIndex] = {
        ...existing,
        ...normalized,
        id: existing.id || normalized.id,
      }
      return canonicalizeMessageBlockOrder(next)
    }
  }

  next.push(normalized)
  return canonicalizeMessageBlockOrder(next)
}
