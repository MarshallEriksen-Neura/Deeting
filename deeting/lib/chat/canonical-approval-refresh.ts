"use client"

import { listPendingMcpApprovals } from "@/lib/api/mcp-approvals"
import {
  type BridgeToolPendingApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import {
  buildBridgeToolApprovalFromPendingSnapshot,
  findMessageIdForToolCall,
  findResolvedToolCallIds,
} from "@/lib/chat/tool-approval"
import type { Message } from "@/lib/chat/message-types"

type RefreshBridgePendingApprovalsOptions = {
  sessionId: string | null | undefined
  messages: Message[]
  excludeCallIds?: Array<string | null | undefined>
  excludeApprovalTokens?: Array<string | null | undefined>
  excludeGateNodeIds?: Array<string | null | undefined>
  preferredApprovalToken?: string | null | undefined
  currentApprovalKey?: string | null | undefined
  forceReplace?: boolean
}

type RefreshBridgePendingApprovalsResult = {
  approvals: BridgeToolPendingApproval[]
  approvalKey: string
}

function normalizeToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function buildCallIdToMessageIdIndex(messages: Message[]) {
  const index = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.blocks)) continue
    for (const block of message.blocks) {
      if ((block.type === "tool_call" || block.type === "tool_result") && block.callId) {
        index.set(block.callId, message.id)
      }
    }
  }
  return index
}

function orderApprovalsForQueue(
  approvals: BridgeToolPendingApproval[],
  preferredApprovalToken?: string | null
) {
  const normalizedPreferredToken = normalizeToken(preferredApprovalToken)
  if (!normalizedPreferredToken) return approvals

  const preferredIndex = approvals.findIndex(
    (approval) => approval.approval_token === normalizedPreferredToken
  )
  if (preferredIndex <= 0) return approvals

  const nextQueue = [...approvals]
  const [preferredApproval] = nextQueue.splice(preferredIndex, 1)
  nextQueue.unshift(preferredApproval)
  return nextQueue
}

export async function refreshBridgePendingApprovalsFromCanonical({
  sessionId,
  messages,
  excludeCallIds = [],
  excludeApprovalTokens = [],
  excludeGateNodeIds = [],
  preferredApprovalToken,
  currentApprovalKey,
  forceReplace = false,
}: RefreshBridgePendingApprovalsOptions): Promise<RefreshBridgePendingApprovalsResult> {
  const normalizedSessionId = normalizeToken(sessionId)
  if (!normalizedSessionId) {
    return {
      approvals: [],
      approvalKey: "",
    }
  }

  const callIdToMessageId = buildCallIdToMessageIdIndex(messages)
  // Chat history is the durable replay truth for a completed tool call.
  // If the message stream already contains a terminal result for the same call_id,
  // do not resurrect a stale runtime approval snapshot back into the dialog queue.
  const resolvedCallIds = findResolvedToolCallIds(messages)
  const excludedCallIds = new Set(
    excludeCallIds.map((callId) => normalizeToken(callId)).filter((callId) => callId.length > 0)
  )
  const excludedApprovalTokens = new Set(
    excludeApprovalTokens
      .map((approvalToken) => normalizeToken(approvalToken))
      .filter((approvalToken) => approvalToken.length > 0)
  )
  const excludedGateNodeIds = new Set(
    excludeGateNodeIds
      .map((gateNodeId) => normalizeToken(gateNodeId))
      .filter((gateNodeId) => gateNodeId.length > 0)
  )

  const snapshotList = await listPendingMcpApprovals(normalizedSessionId)
  const snapshots = Array.isArray(snapshotList) ? snapshotList : []
  const approvals: BridgeToolPendingApproval[] = []
  const seenTokens = new Set<string>()

  for (const snapshot of snapshots) {
    const callId = normalizeToken(snapshot.call_id)
    if (callId && excludedCallIds.has(callId)) continue
    if (callId && resolvedCallIds.has(callId)) continue

    const resolvedMessageId =
      (callId ? callIdToMessageId.get(callId) : undefined) ??
      findMessageIdForToolCall(messages, snapshot.call_id)
    if (!resolvedMessageId && messages.length === 0) {
      continue
    }

    const approval = buildBridgeToolApprovalFromPendingSnapshot(snapshot, {
      messageId: resolvedMessageId,
    })
    if (!approval) continue

    const approvalToken = normalizeToken(approval.approval_token)
    if (!approvalToken || seenTokens.has(approvalToken)) continue
    if (excludedApprovalTokens.has(approvalToken)) continue
    const gateNodeId = normalizeToken(approval.meta.execution_graph_gate_node_id)
    if (gateNodeId && excludedGateNodeIds.has(gateNodeId)) continue
    seenTokens.add(approvalToken)
    approvals.push(approval)
  }

  const orderedApprovals = orderApprovalsForQueue(approvals, preferredApprovalToken)
  const approvalKey = orderedApprovals.map((approval) => approval.approval_token).join("|")
  if (forceReplace || approvalKey !== normalizeToken(currentApprovalKey)) {
    useBridgeApprovalStore.getState().replaceQueue(orderedApprovals)
  }

  return {
    approvals: orderedApprovals,
    approvalKey,
  }
}
