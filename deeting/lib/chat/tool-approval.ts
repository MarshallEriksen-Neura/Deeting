"use client"

import type { MessageBlock, ToolResultBlock } from "@/lib/chat/message-protocol"
import {
  createBridgeToolApproval,
  type BridgeToolPendingApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"

type ToolApprovalPayload = {
  approval_token: string
  tool_id?: string
  tool_name?: string
  arguments?: Record<string, unknown>
  description?: string
  risk_level?: string
  risk_reasons?: string[]
  expires_in_ms?: number
}

type ToolApprovalContext = BridgeToolPendingApproval["meta"]

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

export function extractToolApprovalPayload(result: unknown): ToolApprovalPayload | null {
  const payload = toRecord(result)
  if (!payload) return null
  if (asTrimmedString(payload.status) !== "REQUIRES_APPROVAL") return null

  const approvalToken = asTrimmedString(payload.approval_token)
  if (!approvalToken) return null

  const rawArguments = toRecord(payload.arguments)
  return {
    approval_token: approvalToken,
    tool_id: asTrimmedString(payload.tool_id) ?? undefined,
    tool_name: asTrimmedString(payload.tool_name) ?? undefined,
    arguments: rawArguments ?? undefined,
    description: asTrimmedString(payload.description) ?? undefined,
    risk_level: asTrimmedString(payload.risk_level) ?? undefined,
    risk_reasons: asStringArray(payload.risk_reasons),
    expires_in_ms:
      typeof payload.expires_in_ms === "number" && Number.isFinite(payload.expires_in_ms)
        ? payload.expires_in_ms
        : undefined,
  }
}

export function buildBridgeToolApprovalFromResult(
  result: unknown,
  fallback: {
    tool_id?: string
    tool_name?: string
    arguments?: Record<string, unknown>
    description?: string
    meta: ToolApprovalContext
  }
): BridgeToolPendingApproval | null {
  const payload = extractToolApprovalPayload(result)
  if (!payload) return null

  const toolName = payload.tool_name ?? fallback.tool_name
  if (!toolName) return null

  return createBridgeToolApproval({
    approval_token: payload.approval_token,
    tool_id: payload.tool_id ?? fallback.tool_id,
    tool_name: toolName,
    arguments: payload.arguments ?? fallback.arguments ?? {},
    description: payload.description ?? fallback.description,
    risk_level: payload.risk_level,
    risk_reasons: payload.risk_reasons,
    expires_in_ms: payload.expires_in_ms,
    meta: fallback.meta,
  })
}

export function buildBridgeToolApprovalFromMessageBlock(
  block: MessageBlock,
  context: {
    messageId: string
  }
): BridgeToolPendingApproval | null {
  if (block.type !== "tool_result") return null
  if (!block.callId || block.callId.trim().length === 0) return null

  return buildBridgeToolApprovalFromResult(block.result, {
    tool_name: block.toolName,
    meta: {
      call_id: block.callId,
      message_id: context.messageId,
    },
  })
}

export function findLatestMessageToolApproval(
  blocks: MessageBlock[],
  context: {
    messageId: string
  }
): BridgeToolPendingApproval | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const approval = buildBridgeToolApprovalFromMessageBlock(blocks[index], context)
    if (approval) return approval
  }
  return null
}

export function enqueueBridgeToolApproval(approval: BridgeToolPendingApproval): boolean {
  const current = useBridgeApprovalStore.getState().pending
  if (current?.approval_token === approval.approval_token) {
    return false
  }
  useBridgeApprovalStore.getState().setPending(approval)
  return true
}

export function createApprovedToolResultBlock(
  approval: BridgeToolPendingApproval,
  result: unknown
): ToolResultBlock | null {
  const callId = approval.meta.call_id?.trim()
  if (!callId) return null
  return {
    id: `${callId}-approved`,
    type: "tool_result",
    callId,
    toolName: approval.tool_name,
    status: "success",
    result,
  }
}

export function createRejectedToolResultBlock(
  approval: BridgeToolPendingApproval,
  errorMessage = "User rejected tool execution"
): ToolResultBlock | null {
  const callId = approval.meta.call_id?.trim()
  if (!callId) return null
  return {
    id: `${callId}-rejected`,
    type: "tool_result",
    callId,
    toolName: approval.tool_name,
    status: "error",
    result: { error: errorMessage },
  }
}

export function extractLocalChatApprovalResume(result: unknown): {
  approved_tool_result: unknown
  continuation_blocks: MessageBlock[]
  error?: string
} | null {
  const payload = toRecord(result)
  if (!payload) return null
  const status = asTrimmedString(payload.status)
  if (status !== "LOCAL_CHAT_RESUMED" && status !== "LOCAL_CHAT_RESUME_FAILED") {
    return null
  }

  const continuationBlocks = Array.isArray(payload.continuation_blocks)
    ? (payload.continuation_blocks.filter(
        (block): block is MessageBlock =>
          Boolean(block && typeof block === "object" && "type" in (block as Record<string, unknown>))
      ) as MessageBlock[])
    : []

  return {
    approved_tool_result: payload.approved_tool_result,
    continuation_blocks: continuationBlocks,
    error: asTrimmedString(payload.error) ?? undefined,
  }
}

export function createLocalChatResumeErrorBlock(
  approval: BridgeToolPendingApproval,
  errorMessage: string
): MessageBlock {
  return {
    id: `${approval.meta.call_id}-resume-error`,
    type: "error",
    message: errorMessage,
  }
}
