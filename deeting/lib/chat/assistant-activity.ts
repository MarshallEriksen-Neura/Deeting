import type { MessageBlock, ToolResultBlock } from "@/lib/chat/message-protocol"
import { extractExecutionTreeFromMessage, extractRootExecutionIdFromExecutionTree } from "@/lib/chat/execution-tree"
import { asExecutionLifecyclePayload, getExecutionLifecycleKind, getExecutionLifecycleTarget } from "@/lib/execution-tree/types"

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

const TERMINAL_EXECUTION_STATUSES = new Set([
  "integrated",
  "failed",
  "cancelled",
  "completed",
  "rejected",
])

const ACTIVE_EXECUTION_STATUSES = new Set([
  "selected",
  "launching",
  "running",
])

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isRequiresApprovalPayload(result: unknown) {
  const payload = toRecord(result)
  const status = typeof payload?.status === "string" ? payload.status.trim().toUpperCase() : ""
  return status === "REQUIRES_APPROVAL"
}

function hasExplicitResolvedToolResultStatus(block: MessageBlock & { type: "tool_result" }) {
  const normalizedStatus =
    typeof block.status === "string" ? block.status.trim().toLowerCase() : ""
  return normalizedStatus === "success" || normalizedStatus === "error"
}

export function isToolApprovalResultBlock(
  block: MessageBlock | null | undefined
): block is MessageBlock & { type: "tool_result" } {
  if (!block || block.type !== "tool_result") return false
  if (typeof block.status === "string" && block.status.trim().toLowerCase() === "requires_approval") {
    return true
  }
  if (hasExplicitResolvedToolResultStatus(block)) {
    return false
  }
  return isRequiresApprovalPayload(block.result)
}

function isTerminalToolResultBlock(
  block: MessageBlock
): block is ToolResultBlock {
  return block.type === "tool_result" && !isToolApprovalResultBlock(block)
}

function hasUnresolvedApprovalEvidence(
  blocks: MessageBlock[],
  resolvedCallIds: Set<string>
) {
  return blocks.some((block) => {
    if (block.type === "tool_call") {
      if (block.status !== "requires_approval") return false
      const callId = typeof block.callId === "string" ? block.callId.trim() : ""
      return !callId || !resolvedCallIds.has(callId)
    }

    if (!isToolApprovalResultBlock(block)) return false
    const callId = typeof block.callId === "string" ? block.callId.trim() : ""
    if (!callId || !resolvedCallIds.has(callId)) return true

    const blockStatus =
      typeof block.status === "string" ? block.status.trim().toLowerCase() : ""
    return blockStatus === "requires_approval"
  })
}

function hasResolvedToolOutcomeEvidence(blocks: MessageBlock[]) {
  return blocks.some((block) => {
    if (block.type === "tool_result") {
      return !isToolApprovalResultBlock(block)
    }

    if (block.type === "tool_call") {
      return block.status === "success" || block.status === "error"
    }

    return false
  })
}

export function deriveAssistantActivityState(
  blocks: MessageBlock[] | undefined
): AssistantActivityState {
  const safeBlocks = Array.isArray(blocks) ? blocks : []
  if (safeBlocks.length === 0) return INACTIVE_ACTIVITY

  const resolvedCallIds = new Set(
    safeBlocks
      .filter(isTerminalToolResultBlock)
      .map((block) => (typeof block.callId === "string" ? block.callId.trim() : ""))
      .filter((callId) => callId.length > 0)
  )

  const executionTree = extractExecutionTreeFromMessage({
    blocks: safeBlocks,
    metaInfo: undefined,
  })
  const executionStatus =
    typeof executionTree?.execution_status === "string"
      ? executionTree.execution_status.trim().toLowerCase()
      : ""
  const hasPendingApprovalEvidence = hasUnresolvedApprovalEvidence(
    safeBlocks,
    resolvedCallIds
  )
  const hasResolvedOutcomeEvidence = hasResolvedToolOutcomeEvidence(safeBlocks)

  if (TERMINAL_EXECUTION_STATUSES.has(executionStatus)) {
    return INACTIVE_ACTIVITY
  }

  if (executionStatus === "waiting_approval") {
    if (hasPendingApprovalEvidence || !hasResolvedOutcomeEvidence) {
      return {
        isActive: true,
        statusStage: "render",
        statusCode: "approval.required",
        statusMeta: {
          execution_status: executionStatus,
          ...(extractRootExecutionIdFromExecutionTree(executionTree)
            ? { root_execution_id: extractRootExecutionIdFromExecutionTree(executionTree) }
            : {}),
        },
      }
    }
  }

  if (ACTIVE_EXECUTION_STATUSES.has(executionStatus)) {
    const payload = asExecutionLifecyclePayload(executionTree)
    const target = getExecutionLifecycleTarget(payload)
    const targetName =
      typeof target?.name === "string" && target.name.trim().length > 0
        ? target.name.trim()
        : ""
    const executionKind = getExecutionLifecycleKind(payload) ?? ""
    const rootExecutionId = extractRootExecutionIdFromExecutionTree(executionTree)
    return {
      isActive: true,
      statusStage: "render",
      statusCode: "execution.running",
      statusMeta: {
        ...(targetName ? { target_name: targetName } : {}),
        ...(executionKind ? { execution_kind: executionKind } : {}),
        ...(rootExecutionId ? { root_execution_id: rootExecutionId } : {}),
        execution_status: executionStatus,
      },
    }
  }

  for (let index = safeBlocks.length - 1; index >= 0; index -= 1) {
    const block = safeBlocks[index]
    if (!isToolApprovalResultBlock(block)) continue
    const toolName = typeof block.toolName === "string" ? block.toolName.trim() : ""
    const callId = typeof block.callId === "string" ? block.callId.trim() : ""
    const blockStatus =
      typeof block.status === "string" ? block.status.trim().toLowerCase() : ""
    if (callId && resolvedCallIds.has(callId) && blockStatus !== "requires_approval") continue
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
