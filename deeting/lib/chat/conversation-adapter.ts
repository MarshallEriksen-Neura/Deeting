import { parseMessageContent } from "@/lib/chat/message-content"
import type { ConversationMessage } from "@/lib/api/conversations"
import type { Message, MessageMetaInfo, MessageRole, ToolCall } from "@/lib/chat/message-types"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import { buildExecutionLifecycleBlock } from "@/lib/chat/execution-tree"
import { canonicalizeMessageBlockOrder } from "@/lib/chat/message-blocks"

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRenderableBlock = (block: MessageBlock) => {
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
  if (block.type === "diting_think_frame") {
    if (typeof block.intent === "string" && block.intent.trim().length > 0) return true
    const hasItems = (value: unknown) => Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.trim().length > 0)
    return (
      hasItems(block.facts) ||
      hasItems(block.assumptions) ||
      hasItems(block.verificationTargets) ||
      hasItems(block.rules)
    )
  }
  return false
}

const hasRenderableBlocks = (blocks: MessageBlock[]) =>
  blocks.some(isRenderableBlock)

const hasRenderableNonThoughtBlocks = (blocks: MessageBlock[]) =>
  blocks.some((block) => block.type !== "thought" && isRenderableBlock(block))

const isThoughtOnlyBlockList = (blocks: MessageBlock[]) =>
  blocks.length > 0 && blocks.every((block) => block.type === "thought")

const isPendingApprovalAssistantMessage = (message: Message) => {
  if (message.role !== "assistant" || !Array.isArray(message.blocks) || message.blocks.length === 0) {
    return false
  }

  let hasRequiresApproval = false
  let hasResolvedContent = false

  for (const block of message.blocks) {
    if (block.type === "text" && typeof block.content === "string" && block.content.trim().length > 0) {
      hasResolvedContent = true
    }
    if (block.type === "error") {
      hasResolvedContent = true
    }
    if (block.type === "tool_result") {
      if (block.status === "requires_approval") {
        hasRequiresApproval = true
      }
      if (block.status === "success" || block.status === "error") {
        hasResolvedContent = true
      }
    }
  }

  return hasRequiresApproval && !hasResolvedContent
}

const dropStalePendingApprovalAssistantMessages = (messages: Message[]) => {
  let seenLaterResolvedAssistant = false
  const kept: Message[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === "assistant" && !isPendingApprovalAssistantMessage(message)) {
      seenLaterResolvedAssistant = true
    }
    if (seenLaterResolvedAssistant && isPendingApprovalAssistantMessage(message)) {
      continue
    }
    kept.push(message)
  }

  kept.reverse()
  return kept
}

const normalizeLineBreaks = (text: string) => text.replace(/\r\n?/g, "\n")

const decodeEscapedNewlines = (text: string) => {
  if (text.includes("\n")) return text
  if (!text.includes("\\n")) return text
  return text.replace(/\\n/g, "\n")
}

const normalizeTextValue = (value: string) =>
  decodeEscapedNewlines(normalizeLineBreaks(value))

const normalizeNonEmptyText = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const normalized = normalizeTextValue(value).trim()
  return normalized.length > 0 ? normalized : null
}

const buildExecutionLifecycleFallbackBlock = (
  metaInfo: MessageMetaInfo | undefined,
  messageId: string,
): MessageBlock | null => {
  const executionTree =
    metaInfo && typeof metaInfo.execution_tree === "object" && metaInfo.execution_tree !== null
      ? (metaInfo.execution_tree as Record<string, unknown>)
      : null
  if (!executionTree) return null

  return buildExecutionLifecycleBlock(executionTree, {
    id: `${messageId}-execution-tree`,
    displayMode: "widget",
    streamState: "completed",
  })
}

const normalizeBlocks = (blocks: MessageBlock[], messageId: string): MessageBlock[] => {
  return blocks.map((block, index) => {
    const normalizedBase = {
      id: block.id || `${messageId}-block-${index}`,
      streamState: block.streamState || "completed",
      displayMode: block.displayMode || "bubble",
    }

    if (block.type === "text") {
      return {
        ...block,
        ...normalizedBase,
        content: normalizeTextValue(
          typeof block.content === "string" ? block.content : String(block.content ?? "")
        ),
      }
    }

    if (block.type === "thought") {
      return {
        ...block,
        ...normalizedBase,
        content: normalizeTextValue(
          typeof block.content === "string" ? block.content : String(block.content ?? "")
        ),
      }
    }

    if (block.type === "tool_call") {
      return {
        type: "tool_call" as const,
        ...normalizedBase,
        callId: typeof block.callId === "string" ? block.callId : undefined,
        toolName: typeof block.toolName === "string" ? block.toolName : undefined,
        toolArgs:
          typeof block.toolArgs === "string"
            ? normalizeTextValue(block.toolArgs)
            : undefined,
        status:
          block.status === "running" ||
          block.status === "success" ||
          block.status === "error" ||
          block.status === "requires_approval"
            ? block.status
            : undefined,
      }
    }

    if (block.type === "tool_result") {
      const debug =
        block.debug && typeof block.debug === "object"
          ? (block.debug as Record<string, unknown>)
          : undefined
      return {
        type: "tool_result" as const,
        ...normalizedBase,
        callId: typeof block.callId === "string" ? block.callId : undefined,
        toolName: typeof block.toolName === "string" ? block.toolName : undefined,
        status:
          block.status === "success" ||
          block.status === "error" ||
          block.status === "requires_approval"
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
        ...block,
        ...normalizedBase,
        message: normalizeTextValue(
          typeof block.message === "string" ? block.message : String(block.message ?? "")
        ),
      }
    }

    if (block.type === "diting_think_frame") {
      const candidate = block as unknown as Record<string, unknown>
      const intentValue =
        typeof candidate.intent === "string" && candidate.intent.trim().length > 0
          ? normalizeTextValue(candidate.intent.trim())
          : null
      const toStringArray = (value: unknown): string[] => {
        if (!Array.isArray(value)) return []
        const out: string[] = []
        for (const entry of value) {
          if (typeof entry !== "string") continue
          const trimmed = entry.trim()
          if (!trimmed) continue
          out.push(normalizeTextValue(trimmed))
        }
        return out
      }
      const verificationTargets = toStringArray(
        candidate.verificationTargets ?? candidate.verification_targets,
      )
      const executionStrategy =
        typeof candidate.executionStrategy === "string" && candidate.executionStrategy.trim().length > 0
          ? candidate.executionStrategy.trim()
          : typeof candidate.execution_strategy === "string" && candidate.execution_strategy.trim().length > 0
            ? candidate.execution_strategy.trim()
            : undefined
      const proposedNextPhaseRaw = candidate.proposedNextPhase ?? candidate.proposed_next_phase
      const proposedNextPhase =
        proposedNextPhaseRaw &&
        typeof proposedNextPhaseRaw === "object" &&
        typeof proposedNextPhaseRaw.step_type === "string" &&
        typeof proposedNextPhaseRaw.rationale === "string"
          ? {
              stepType: proposedNextPhaseRaw.step_type.trim(),
              rationale: proposedNextPhaseRaw.rationale.trim(),
              verificationTargetRefs: toStringArray(
                proposedNextPhaseRaw.verificationTargetRefs ?? proposedNextPhaseRaw.verification_target_refs,
              ),
            }
          : undefined
      return {
        type: "diting_think_frame" as const,
        ...normalizedBase,
        intent: intentValue,
        facts: toStringArray(candidate.facts),
        assumptions: toStringArray(candidate.assumptions),
        verificationTargets,
        rules: toStringArray(candidate.rules),
        ...(executionStrategy ? { executionStrategy } : {}),
        ...(proposedNextPhase ? { proposedNextPhase } : {}),
      }
    }

    return {
      ...block,
      ...normalizedBase,
    }
  })
}

const compactAdjacentThoughtBlocks = (blocks: MessageBlock[]): MessageBlock[] => {
  const compacted: MessageBlock[] = []

  for (const block of blocks) {
    const previous = compacted[compacted.length - 1]
    if (
      block.type === "thought" &&
      previous?.type === "thought" &&
      typeof previous.content === "string" &&
      typeof block.content === "string"
    ) {
      compacted[compacted.length - 1] = {
        ...previous,
        content: `${previous.content}${block.content}`,
      }
      continue
    }
    compacted.push(block)
  }

  return compacted
}

const readFinalAnswerFromExecutionGraph = (value: unknown): string | null => {
  if (!isRecord(value)) return null

  const summary = value.summary
  if (isRecord(summary)) {
    const finalAnswer = normalizeNonEmptyText(summary.final_answer ?? summary.finalAnswer)
    if (finalAnswer) return finalAnswer
  }

  if (!Array.isArray(value.nodes)) return null

  for (const node of value.nodes) {
    if (!isRecord(node)) continue
    const nodeType =
      typeof node.node_type === "string"
        ? node.node_type
        : typeof node.nodeType === "string"
          ? node.nodeType
          : ""
    if (nodeType !== "finalize") continue

    const output = normalizeNonEmptyText(node.output_payload ?? node.outputPayload)
    if (output) return output
  }

  return null
}

const readAssistantFinalAnswer = (metaInfo: MessageMetaInfo | undefined): string | null => {
  if (!metaInfo) return null

  const direct = normalizeNonEmptyText(metaInfo.final_answer ?? metaInfo.finalAnswer)
  if (direct) return direct

  if (isRecord(metaInfo.summary)) {
    const summaryAnswer = normalizeNonEmptyText(
      metaInfo.summary.final_answer ?? metaInfo.summary.finalAnswer
    )
    if (summaryAnswer) return summaryAnswer
  }

  return readFinalAnswerFromExecutionGraph(
    metaInfo.execution_graph ?? metaInfo.executionGraph
  )
}

const buildAssistantFinalTextBlock = (
  messageId: string,
  content: string,
): MessageBlock => ({
  type: "text",
  id: `${messageId}-final-answer`,
  streamState: "completed",
  displayMode: "bubble",
  content,
})

const resolveAssistantBlocks = (
  metaInfo: MessageMetaInfo | undefined,
  messageId: string,
): MessageBlock[] => {
  const finalAnswer = readAssistantFinalAnswer(metaInfo)

  if (isBlockArray(metaInfo?.blocks)) {
    const blocks = compactAdjacentThoughtBlocks(
      canonicalizeMessageBlockOrder(normalizeBlocks(metaInfo.blocks, messageId))
    )
    if (!hasRenderableBlocks(blocks)) {
      return finalAnswer ? [buildAssistantFinalTextBlock(messageId, finalAnswer)] : []
    }
    if (isThoughtOnlyBlockList(blocks) || !hasRenderableNonThoughtBlocks(blocks)) {
      return finalAnswer ? [buildAssistantFinalTextBlock(messageId, finalAnswer)] : []
    }
    if (finalAnswer) {
      const existingText = blocks
        .filter((block) => block.type === "text")
        .map((block) => block.content)
        .join("")
        .trim()
      if (existingText !== finalAnswer.trim()) {
        return [...blocks, buildAssistantFinalTextBlock(messageId, finalAnswer)]
      }
    }
    return blocks
  }

  const fallback = buildExecutionLifecycleFallbackBlock(metaInfo, messageId)
  if (fallback) {
    const blocks = [fallback]
    return hasRenderableBlocks(blocks) ? blocks : []
  }

  return finalAnswer ? [buildAssistantFinalTextBlock(messageId, finalAnswer)] : []
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
  const normalized = filtered.map((msg, index) => {
    const normalizedRole = normalizeRole(msg.role)
    const candidate = normalizedRole === "assistant" ? null : readContentCandidate(msg)
    const parsed = parseMessageContent(candidate)
    const normalizedText = normalizeTextValue(parsed.text)
    const metaInfo = msg.meta_info as MessageMetaInfo | undefined
    const toolCalls = isToolCallArray(metaInfo?.tool_calls)
      ? metaInfo?.tool_calls
      : undefined
    const toolCallId =
      typeof metaInfo?.tool_call_id === "string" ? metaInfo.tool_call_id : undefined
    const messageId = `${options.idPrefix ?? "conv"}-${msg.turn_index ?? index}`
    const resolvedBlocks =
      normalizedRole === "assistant" ? resolveAssistantBlocks(metaInfo, messageId) : undefined
    const resolvedContent =
      normalizedRole === "assistant" ? "" : normalizedText
    return {
      id: messageId,
      role: normalizedRole as MessageRole,
      content: resolvedContent,
      ...(typeof msg.turn_index === "number" ? { turnIndex: msg.turn_index } : {}),
      attachments: parsed.attachments.length ? parsed.attachments : undefined,
      createdAt: resolveCreatedAt(msg, index, total),
      metaInfo,
      toolCalls,
      toolCallId,
      fromHistory: true,
      ...(resolvedBlocks !== undefined ? { blocks: resolvedBlocks } : {}),
    }
  })

  return dropStalePendingApprovalAssistantMessages(normalized)
}
