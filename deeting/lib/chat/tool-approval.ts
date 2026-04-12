"use client"

import type { MessageBlock, ToolResultBlock } from "@/lib/chat/message-protocol"
import type { Message } from "@/lib/chat/message-types"
import {
  type BridgeToolPendingApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import { createBridgeToolApproval as createRawBridgeToolApproval } from "@/lib/chat/bridge-approval-store"

type ToolApprovalPayload = {
  approval_token: string
  tool_id?: string
  tool_name?: string
  arguments?: Record<string, unknown>
  description?: string
  risk_level?: string
  risk_reasons?: string[]
  recovered?: boolean
  recovery_reason?: string
  attempts?: number
  expires_in_ms?: number
  execution_graph_execution_id?: string
  execution_graph_gate_node_id?: string
  execution_graph_tool_node_id?: string
}

export type PendingToolApprovalSnapshot = {
  status?: string
  approval_token?: string
  tool_id?: string
  tool_name?: string
  arguments?: Record<string, unknown>
  description?: string
  risk_level?: string
  risk_reasons?: string[]
  recovered?: boolean
  recovery_reason?: string
  attempts?: number
  expires_in_ms?: number
  call_id?: string
  execution_token?: string
  session_id?: string
  execution_graph_execution_id?: string
  execution_graph_gate_node_id?: string
  execution_graph_tool_node_id?: string
  approval_status?: string
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

function hasExplicitResolvedToolResultStatus(block: ToolResultBlock) {
  const normalizedStatus =
    typeof block.status === "string" ? block.status.trim().toLowerCase() : ""
  return normalizedStatus === "success" || normalizedStatus === "error"
}

function describeBrowserTarget(value: unknown): string {
  const target = toRecord(value)
  if (!target) return "the targeted element in the browser"

  const text = asTrimmedString(target.text)
  if (text) {
    return `the "${text}" element in the browser`
  }

  const selector = asTrimmedString(target.selector)
  if (selector) {
    return `the element matching selector "${selector}"`
  }

  const role = asTrimmedString(target.role)
  if (role) {
    return `the ${role} element in the browser`
  }

  const tagName =
    asTrimmedString(target.tag_name) ?? asTrimmedString(target.tagName)
  if (tagName) {
    return `the <${tagName}> element in the browser`
  }

  const index = typeof target.index === "number" ? target.index : null
  if (index != null && Number.isFinite(index)) {
    return `targeted browser element #${index + 1}`
  }

  return "the targeted element in the browser"
}

export function deriveApprovalDescription(
  toolName: string,
  argumentsValue: Record<string, unknown>,
  explicitDescription?: string
): string | undefined {
  const provided = asTrimmedString(explicitDescription)
  if (provided) return provided

  switch (toolName) {
    case "browser_open_tab": {
      const url = asTrimmedString(argumentsValue.url)
      return url ? `Open a new browser tab to "${url}".` : "Open a new browser tab."
    }
    case "browser_get_page_snapshot": {
      const tabId =
        typeof argumentsValue.tab_id === "number"
          ? argumentsValue.tab_id
          : typeof argumentsValue.tabId === "number"
            ? argumentsValue.tabId
            : null
      return tabId != null
        ? `Read the current page content from browser tab #${tabId}.`
        : "Read the current page content from the browser."
    }
    case "browser_click":
      return `Click ${describeBrowserTarget(argumentsValue.target)}.`
    case "browser_type": {
      const text = asTrimmedString(argumentsValue.text)
      const target = describeBrowserTarget(argumentsValue.target)
      return text
        ? `Type "${text}" into ${target}.`
        : `Type into ${target}.`
    }
    case "browser_agent_status":
      return "Check the local browser bridge connection state."
    default:
      return undefined
  }
}

export function createBridgeToolApproval(
  approval: Omit<BridgeToolPendingApproval, "kind">
): BridgeToolPendingApproval {
  return createRawBridgeToolApproval({
    ...approval,
    description: deriveApprovalDescription(
      approval.tool_name,
      approval.arguments,
      approval.description
    ),
  })
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
    recovered: payload.recovered === true ? true : undefined,
    recovery_reason: asTrimmedString(payload.recovery_reason) ?? undefined,
    attempts:
      typeof payload.attempts === "number" && Number.isFinite(payload.attempts)
        ? payload.attempts
        : undefined,
    expires_in_ms:
      typeof payload.expires_in_ms === "number" && Number.isFinite(payload.expires_in_ms)
        ? payload.expires_in_ms
        : undefined,
    execution_graph_execution_id:
      asTrimmedString(payload.execution_graph_execution_id) ?? undefined,
    execution_graph_gate_node_id:
      asTrimmedString(payload.execution_graph_gate_node_id) ?? undefined,
    execution_graph_tool_node_id:
      asTrimmedString(payload.execution_graph_tool_node_id) ?? undefined,
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
    recovered: payload.recovered,
    recovery_reason: payload.recovery_reason,
    attempts: payload.attempts,
    expires_in_ms: payload.expires_in_ms,
    meta: {
      ...fallback.meta,
      execution_graph_execution_id:
        payload.execution_graph_execution_id ??
        fallback.meta.execution_graph_execution_id,
      execution_graph_gate_node_id:
        payload.execution_graph_gate_node_id ??
        fallback.meta.execution_graph_gate_node_id,
      execution_graph_tool_node_id:
        payload.execution_graph_tool_node_id ??
        fallback.meta.execution_graph_tool_node_id,
    },
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
  if (hasExplicitResolvedToolResultStatus(block)) return null

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

function isApprovalToolResultBlock(
  block: MessageBlock | null | undefined
): block is ToolResultBlock {
  if (!block || block.type !== "tool_result") return false
  if (typeof block.status === "string" && block.status.trim().toLowerCase() === "requires_approval") {
    return true
  }
  if (hasExplicitResolvedToolResultStatus(block)) {
    return false
  }
  return extractToolApprovalPayload(block.result) !== null
}

export function findUnresolvedToolApprovals(
  messages: Message[]
): BridgeToolPendingApproval[] {
  const resolvedCallIds = new Set<string>()
  const approvals: BridgeToolPendingApproval[] = []
  const seenApprovalTokens = new Set<string>()

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message.role !== "assistant" || !Array.isArray(message.blocks)) continue

    for (let blockIndex = message.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.blocks[blockIndex]
      if (block.type !== "tool_result") continue

      const callId = asTrimmedString(block.callId)
      if (!callId) continue

      if (isApprovalToolResultBlock(block)) {
        if (resolvedCallIds.has(callId)) continue
        const approval = buildBridgeToolApprovalFromMessageBlock(block, {
          messageId: message.id,
        })
        if (approval && !seenApprovalTokens.has(approval.approval_token)) {
          approvals.push(approval)
          seenApprovalTokens.add(approval.approval_token)
        }
        continue
      }

      resolvedCallIds.add(callId)
    }
  }

  return approvals
}

export function findLatestUnresolvedToolApproval(
  messages: Message[]
): BridgeToolPendingApproval | null {
  return findUnresolvedToolApprovals(messages)[0] ?? null
}

export function enqueueBridgeToolApproval(approval: BridgeToolPendingApproval): boolean {
  const state = useBridgeApprovalStore.getState()
  if (state.queue.some((item) => item.approval_token === approval.approval_token)) {
    return false
  }
  state.enqueuePending(approval)
  return true
}

export function findMessageIdForToolCall(
  messages: Message[],
  callId: string | null | undefined
): string | undefined {
  const normalizedCallId = typeof callId === "string" ? callId.trim() : ""
  if (!normalizedCallId) return undefined

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message.role !== "assistant" || !Array.isArray(message.blocks)) continue
    const hasMatchingCall = message.blocks.some((block) => {
      if ((block.type !== "tool_call" && block.type !== "tool_result") || !block.callId) {
        return false
      }
      return block.callId === normalizedCallId
    })
    if (hasMatchingCall) {
      return message.id
    }
  }

  return undefined
}

export function buildBridgeToolApprovalFromPendingSnapshot(
  snapshot: PendingToolApprovalSnapshot,
  fallback?: {
    messageId?: string
  }
): BridgeToolPendingApproval | null {
  const payload = extractToolApprovalPayload(snapshot)
  if (!payload) return null

  const callId = asTrimmedString(snapshot.call_id)
  const toolName = payload.tool_name
  if (!callId || !toolName) return null

  return createBridgeToolApproval({
    approval_token: payload.approval_token,
    tool_id: payload.tool_id,
    tool_name: toolName,
    arguments: payload.arguments ?? {},
    description: payload.description,
    risk_level: payload.risk_level,
    risk_reasons: payload.risk_reasons,
    recovered: payload.recovered,
    recovery_reason: payload.recovery_reason,
    attempts: payload.attempts,
    expires_in_ms: payload.expires_in_ms,
    meta: {
      call_id: callId,
      execution_token: asTrimmedString(snapshot.execution_token) ?? undefined,
      message_id: fallback?.messageId,
      execution_graph_execution_id:
        payload.execution_graph_execution_id ??
        asTrimmedString(snapshot.execution_graph_execution_id) ??
        undefined,
      execution_graph_gate_node_id:
        payload.execution_graph_gate_node_id ??
        asTrimmedString(snapshot.execution_graph_gate_node_id) ??
        undefined,
      execution_graph_tool_node_id:
        payload.execution_graph_tool_node_id ??
        asTrimmedString(snapshot.execution_graph_tool_node_id) ??
        undefined,
    },
  })
}

export function createOptimisticApprovalExecutionBlocks(
  approval: BridgeToolPendingApproval,
  blocks: MessageBlock[]
): MessageBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks

  const callId = approval.meta.call_id?.trim()
  if (!callId) return blocks

  let changed = false
  const next: MessageBlock[] = []

  for (const block of blocks) {
    if (block.type === "tool_result" && block.callId === callId) {
      if (isApprovalToolResultBlock(block)) {
        changed = true
        continue
      }
    }

    if (block.type === "tool_call" && block.callId === callId && block.status !== "running") {
      changed = true
      next.push({
        ...block,
        status: "running",
      })
      continue
    }

    next.push(block)
  }

  return changed ? next : blocks
}

export function createApprovedToolResultBlock(
  approval: BridgeToolPendingApproval,
  result: unknown
): ToolResultBlock | null {
  const callId = approval.meta.call_id?.trim()
  if (!callId) return null
  const resultRecord = toRecord(result)
  return {
    id: `${callId}-approved`,
    type: "tool_result",
    callId,
    toolName: approval.tool_name,
    status: "success",
    result: resultRecord
      ? {
          ...resultRecord,
          ...(approval.meta.execution_graph_execution_id
            ? {
                execution_graph_execution_id:
                  approval.meta.execution_graph_execution_id,
              }
            : {}),
          ...(approval.meta.execution_graph_gate_node_id
            ? {
                execution_graph_gate_node_id:
                  approval.meta.execution_graph_gate_node_id,
              }
            : {}),
          ...(approval.meta.execution_graph_tool_node_id
            ? {
                execution_graph_tool_node_id:
                  approval.meta.execution_graph_tool_node_id,
              }
            : {}),
        }
      : result,
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
    result: {
      error: errorMessage,
      ...(approval.meta.execution_graph_execution_id
        ? {
            execution_graph_execution_id:
              approval.meta.execution_graph_execution_id,
          }
        : {}),
      ...(approval.meta.execution_graph_gate_node_id
        ? {
            execution_graph_gate_node_id:
              approval.meta.execution_graph_gate_node_id,
          }
        : {}),
      ...(approval.meta.execution_graph_tool_node_id
        ? {
            execution_graph_tool_node_id:
              approval.meta.execution_graph_tool_node_id,
          }
        : {}),
    },
  }
}

export type LocalChatApprovalResume = {
  status: "LOCAL_CHAT_WAITING_APPROVAL" | "LOCAL_CHAT_RESUMED" | "LOCAL_CHAT_RESUME_FAILED"
  approval_token: string
  resolved_gate_node_id?: string
  resolved_call_id?: string
  approved_tool_result: unknown
  continuation_blocks: MessageBlock[]
  execution_graph?: Record<string, unknown>
  execution_graph_execution_id?: string
  pending_approval_gate_ids: string[]
  next_pending_approval_tokens: string[]
  error_code?: string
  error?: string
  retryable?: boolean
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
}

function extractNodeStatusById(
  executionGraph: Record<string, unknown> | undefined,
  nodeId: string | undefined
): string | undefined {
  const normalizedNodeId = typeof nodeId === "string" ? nodeId.trim() : ""
  if (!normalizedNodeId) return undefined
  const nodes = Array.isArray(executionGraph?.nodes) ? executionGraph.nodes : []
  const matched = nodes.find((node) => {
    if (!node || typeof node !== "object") return false
    return (node as Record<string, unknown>).node_id === normalizedNodeId
  }) as Record<string, unknown> | undefined
  return typeof matched?.status === "string" ? matched.status.trim() : undefined
}

export function extractLocalChatApprovalResume(result: unknown): LocalChatApprovalResume | null {
  const payload = toRecord(result)
  if (!payload) return null
  const status = asTrimmedString(payload.status)
  if (
    status !== "LOCAL_CHAT_WAITING_APPROVAL" &&
    status !== "LOCAL_CHAT_RESUMED" &&
    status !== "LOCAL_CHAT_RESUME_FAILED"
  ) {
    return null
  }

  const approvalToken = asTrimmedString(payload.approval_token)
  if (!approvalToken) return null

  const continuationBlocks = Array.isArray(payload.continuation_blocks)
    ? (payload.continuation_blocks.filter(
        (block): block is MessageBlock =>
          Boolean(block && typeof block === "object" && "type" in (block as Record<string, unknown>))
      ) as MessageBlock[])
    : []

  const executionGraph = toRecord(payload.execution_graph) ?? undefined
  const resolvedGateNodeId = asTrimmedString(payload.resolved_gate_node_id) ?? undefined
  const pendingApprovalGateIds = normalizeStringArray(payload.pending_approval_gate_ids)
  const nextPendingApprovalTokens = normalizeStringArray(payload.next_pending_approval_tokens)

  if (status === "LOCAL_CHAT_WAITING_APPROVAL") {
    const resolvedGateStatus = extractNodeStatusById(executionGraph, resolvedGateNodeId)
    if (resolvedGateNodeId && resolvedGateStatus?.toLowerCase() === "waiting_approval") {
      return {
        status: "LOCAL_CHAT_RESUME_FAILED",
        approval_token: approvalToken,
        resolved_gate_node_id: resolvedGateNodeId,
        resolved_call_id: asTrimmedString(payload.resolved_call_id) ?? undefined,
        approved_tool_result: payload.approved_tool_result,
        continuation_blocks: continuationBlocks,
        execution_graph: executionGraph,
        execution_graph_execution_id:
          asTrimmedString(payload.execution_graph_execution_id) ?? undefined,
        pending_approval_gate_ids: pendingApprovalGateIds,
        next_pending_approval_tokens: nextPendingApprovalTokens,
        error_code: "APPROVAL_GRAPH_NOT_ADVANCED",
        error:
          "Approval completed, but the resolved approval gate is still waiting_approval in the returned graph.",
        retryable: true,
      }
    }

    if (pendingApprovalGateIds.length === 0 && nextPendingApprovalTokens.length === 0) {
      return {
        status: "LOCAL_CHAT_RESUME_FAILED",
        approval_token: approvalToken,
        resolved_gate_node_id: resolvedGateNodeId,
        resolved_call_id: asTrimmedString(payload.resolved_call_id) ?? undefined,
        approved_tool_result: payload.approved_tool_result,
        continuation_blocks: continuationBlocks,
        execution_graph: executionGraph,
        execution_graph_execution_id:
          asTrimmedString(payload.execution_graph_execution_id) ?? undefined,
        pending_approval_gate_ids: pendingApprovalGateIds,
        next_pending_approval_tokens: nextPendingApprovalTokens,
        error_code: "APPROVAL_NEXT_GATE_MISSING",
        error:
          "Approval reported waiting_approval, but no next pending approval gate was present in the returned payload.",
        retryable: true,
      }
    }
  }

  return {
    status,
    approval_token: approvalToken,
    resolved_gate_node_id: resolvedGateNodeId,
    resolved_call_id: asTrimmedString(payload.resolved_call_id) ?? undefined,
    approved_tool_result: payload.approved_tool_result,
    continuation_blocks: continuationBlocks,
    execution_graph: executionGraph,
    execution_graph_execution_id:
      asTrimmedString(payload.execution_graph_execution_id) ?? undefined,
    pending_approval_gate_ids: pendingApprovalGateIds,
    next_pending_approval_tokens: nextPendingApprovalTokens,
    error_code: asTrimmedString(payload.error_code) ?? undefined,
    error: asTrimmedString(payload.error) ?? undefined,
    retryable: payload.retryable === true,
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
