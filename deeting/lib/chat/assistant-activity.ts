import type { MessageBlock, ToolResultBlock } from "@/lib/chat/message-protocol"

export type AssistantActivityState = {
  isActive: boolean
  statusStage: string | null
  statusCode: string | null
  statusMeta: Record<string, unknown> | null
}

const INACTIVE_ACTIVITY: AssistantActivityState = {
  isActive: false,
  statusStage: null,
  statusCode: null,
  statusMeta: null,
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isRequiresApprovalPayload(result: unknown) {
  const payload = toRecord(result)
  const status = typeof payload?.status === "string" ? payload.status.trim().toUpperCase() : ""
  return status === "REQUIRES_APPROVAL"
}

export function isToolApprovalResultBlock(
  block: MessageBlock | null | undefined
): block is MessageBlock & { type: "tool_result" } {
  if (!block || block.type !== "tool_result") return false
  if (typeof block.status === "string" && block.status.trim().toLowerCase() === "requires_approval") {
    return true
  }
  return isRequiresApprovalPayload(block.result)
}

function isTerminalToolResultBlock(
  block: MessageBlock
): block is ToolResultBlock {
  return block.type === "tool_result" && !isToolApprovalResultBlock(block)
}

export function deriveAssistantActivityState(
  blocks: MessageBlock[] | undefined
): AssistantActivityState {
  const safeBlocks = Array.isArray(blocks) ? blocks : []
  if (safeBlocks.length === 0) return INACTIVE_ACTIVITY

  for (let index = safeBlocks.length - 1; index >= 0; index -= 1) {
    const block = safeBlocks[index]
    if (!isToolApprovalResultBlock(block)) continue
    const toolName = typeof block.toolName === "string" ? block.toolName.trim() : ""
    const callId = typeof block.callId === "string" ? block.callId.trim() : ""
    return {
      isActive: true,
      statusStage: "render",
      statusCode: "approval.required",
      statusMeta: {
        ...(toolName ? { tool_name: toolName } : {}),
        ...(callId ? { call_id: callId } : {}),
      },
    }
  }

  const resolvedCallIds = new Set(
    safeBlocks
      .filter(isTerminalToolResultBlock)
      .map((block) => (typeof block.callId === "string" ? block.callId.trim() : ""))
      .filter((callId) => callId.length > 0)
  )

  for (let index = safeBlocks.length - 1; index >= 0; index -= 1) {
    const block = safeBlocks[index]
    if (block.type !== "tool_call") continue
    if (block.status !== "running") continue
    const callId = typeof block.callId === "string" ? block.callId.trim() : ""
    if (callId && resolvedCallIds.has(callId)) continue
    const toolName = typeof block.toolName === "string" ? block.toolName.trim() : ""
    return {
      isActive: true,
      statusStage: "render",
      statusCode: "approval.executing",
      statusMeta: {
        ...(toolName ? { tool_name: toolName } : {}),
        ...(callId ? { call_id: callId } : {}),
      },
    }
  }

  return INACTIVE_ACTIVITY
}
