"use client";

import { listPendingMcpApprovals } from "@/lib/api/mcp-approvals";
import type {
  MessageBlock,
  ToolResultBlock,
} from "@/lib/chat/message-protocol";
import type { Message } from "@/lib/chat/message-types";
import { extractRootExecutionIdFromMessage } from "@/lib/chat/execution-tree";
import {
  type BridgeToolPendingApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store";
import { createBridgeToolApproval as createRawBridgeToolApproval } from "@/lib/chat/bridge-approval-store";

type ToolApprovalPayload = {
  approval_token: string;
  tool_id?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  description?: string;
  risk_level?: string;
  risk_reasons?: string[];
  recovered?: boolean;
  recovery_reason?: string;
  attempts?: number;
  expires_in_ms?: number;
  execution_graph_execution_id?: string;
  execution_graph_gate_node_id?: string;
  execution_graph_tool_node_id?: string;
};

export type PendingToolApprovalSnapshot = {
  status?: string;
  approval_token?: string;
  tool_id?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  description?: string;
  risk_level?: string;
  risk_reasons?: string[];
  recovered?: boolean;
  recovery_reason?: string;
  attempts?: number;
  expires_in_ms?: number;
  call_id?: string;
  execution_token?: string;
  session_id?: string;
  execution_graph_execution_id?: string;
  execution_graph_gate_node_id?: string;
  execution_graph_tool_node_id?: string;
  approval_status?: string;
};

type ToolApprovalContext = BridgeToolPendingApproval["meta"];
type ApprovalLookupMatch = {
  approvalToken?: string | null;
  callId?: string | null;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function unwrapNestedToolResultEnvelope(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 6; index += 1) {
    const record = toRecord(current);
    if (!record) break;
    const type = asTrimmedString(record.type);
    const looksLikeToolResultEnvelope =
      type === "tool_result" ||
      typeof record.callId === "string" ||
      typeof record.toolName === "string";
    if (
      !looksLikeToolResultEnvelope ||
      !("result" in record) ||
      record.result == null
    ) {
      break;
    }
    current = record.result;
  }
  return current;
}

function hasExplicitResolvedToolResultStatus(block: ToolResultBlock) {
  const normalizedStatus =
    typeof block.status === "string" ? block.status.trim().toLowerCase() : "";
  return normalizedStatus === "success" || normalizedStatus === "error";
}

function describeBrowserTarget(value: unknown): string {
  const target = toRecord(value);
  if (!target) return "the targeted element in the browser";

  const text = asTrimmedString(target.text);
  if (text) {
    return `the "${text}" element in the browser`;
  }

  const selector = asTrimmedString(target.selector);
  if (selector) {
    return `the element matching selector "${selector}"`;
  }

  const role = asTrimmedString(target.role);
  if (role) {
    return `the ${role} element in the browser`;
  }

  const tagName =
    asTrimmedString(target.tag_name) ?? asTrimmedString(target.tagName);
  if (tagName) {
    return `the <${tagName}> element in the browser`;
  }

  const index = typeof target.index === "number" ? target.index : null;
  if (index != null && Number.isFinite(index)) {
    return `targeted browser element #${index + 1}`;
  }

  return "the targeted element in the browser";
}

export function deriveApprovalDescription(
  toolName: string,
  argumentsValue: Record<string, unknown>,
  explicitDescription?: string,
): string | undefined {
  const provided = asTrimmedString(explicitDescription);
  if (provided) return provided;

  switch (toolName) {
    case "browser_open_tab": {
      const url = asTrimmedString(argumentsValue.url);
      return url
        ? `Open a new browser tab to "${url}".`
        : "Open a new browser tab.";
    }
    case "browser_get_page_snapshot": {
      const tabId =
        typeof argumentsValue.tab_id === "number"
          ? argumentsValue.tab_id
          : typeof argumentsValue.tabId === "number"
            ? argumentsValue.tabId
            : null;
      return tabId != null
        ? `Read the current page content from browser tab #${tabId}.`
        : "Read the current page content from the browser.";
    }
    case "browser_navigate_tab": {
      const url = asTrimmedString(argumentsValue.url);
      return url
        ? `Navigate the browser tab to "${url}".`
        : "Navigate the browser tab.";
    }
    case "browser_find_element":
      return `Find ${describeBrowserTarget(argumentsValue.target)}.`;
    case "browser_extract":
      return "Extract structured content from the current browser page.";
    case "browser_region_screenshot":
      return `Capture a screenshot of ${describeBrowserTarget(argumentsValue.target)}.`;
    case "browser_full_page_screenshot":
      return "Capture a full-page browser screenshot.";
    case "browser_wait":
      return "Wait for a browser page condition.";
    case "browser_tabs": {
      const action = asTrimmedString(argumentsValue.action);
      return action
        ? `Run browser tab action "${action}".`
        : "Manage browser tabs.";
    }
    case "browser_click":
      return `Click ${describeBrowserTarget(argumentsValue.target)}.`;
    case "browser_type": {
      const text = asTrimmedString(argumentsValue.text);
      const target = describeBrowserTarget(argumentsValue.target);
      return text ? `Type "${text}" into ${target}.` : `Type into ${target}.`;
    }
    case "browser_fill": {
      const text = asTrimmedString(argumentsValue.text);
      const target = describeBrowserTarget(argumentsValue.target);
      return text ? `Fill ${target} with "${text}".` : `Fill ${target}.`;
    }
    case "browser_key": {
      const key = asTrimmedString(argumentsValue.key);
      return key ? `Send browser key "${key}".` : "Send a browser key.";
    }
    case "browser_select":
      return `Select a value in ${describeBrowserTarget(argumentsValue.target)}.`;
    case "browser_upload_file":
      return `Upload a file through ${describeBrowserTarget(argumentsValue.target)}.`;
    case "browser_downloads":
      return "Inspect browser download state.";
    case "browser_dialog": {
      const action = asTrimmedString(argumentsValue.action);
      return action
        ? `Handle browser dialog with action "${action}".`
        : "Handle a browser dialog.";
    }
    case "browser_console_log":
      return "Read browser console logs.";
    case "browser_network_log":
      return "Read browser network activity.";
    case "browser_storage_read":
      return "Read browser storage values.";
    case "browser_storage_write":
      return "Write browser storage values.";
    case "browser_eval":
      return "Evaluate JavaScript in the browser page context.";
    case "browser_highlight":
      return `Highlight ${describeBrowserTarget(argumentsValue.target)}.`;
    case "browser_accessibility_audit":
      return "Run a browser accessibility audit.";
    case "browser_agent_status":
      return "Check the local browser bridge connection state.";
    default:
      return undefined;
  }
}

export function createBridgeToolApproval(
  approval: Omit<BridgeToolPendingApproval, "kind">,
): BridgeToolPendingApproval {
  return createRawBridgeToolApproval({
    ...approval,
    description: deriveApprovalDescription(
      approval.tool_name,
      approval.arguments,
      approval.description,
    ),
  });
}

export function extractToolApprovalPayload(
  result: unknown,
): ToolApprovalPayload | null {
  const payload = toRecord(result);
  if (!payload) return null;
  if (asTrimmedString(payload.status) !== "REQUIRES_APPROVAL") return null;

  const approvalToken = asTrimmedString(payload.approval_token);
  if (!approvalToken) return null;

  const rawArguments = toRecord(payload.arguments);
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
      typeof payload.expires_in_ms === "number" &&
      Number.isFinite(payload.expires_in_ms)
        ? payload.expires_in_ms
        : undefined,
    execution_graph_execution_id:
      asTrimmedString(payload.execution_graph_execution_id) ?? undefined,
    execution_graph_gate_node_id:
      asTrimmedString(payload.execution_graph_gate_node_id) ?? undefined,
    execution_graph_tool_node_id:
      asTrimmedString(payload.execution_graph_tool_node_id) ?? undefined,
  };
}

export function buildBridgeToolApprovalFromResult(
  result: unknown,
  fallback: {
    tool_id?: string;
    tool_name?: string;
    arguments?: Record<string, unknown>;
    description?: string;
    meta: ToolApprovalContext;
  },
): BridgeToolPendingApproval | null {
  const payload = extractToolApprovalPayload(result);
  if (!payload) return null;

  const toolName = payload.tool_name ?? fallback.tool_name;
  if (!toolName) return null;

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
  });
}

export function buildBridgeToolApprovalFromMessageBlock(
  block: MessageBlock,
  context: {
    messageId: string;
  },
): BridgeToolPendingApproval | null {
  if (block.type !== "tool_result") return null;
  if (!block.callId || block.callId.trim().length === 0) return null;
  if (hasExplicitResolvedToolResultStatus(block)) return null;

  return buildBridgeToolApprovalFromResult(block.result, {
    tool_name: block.toolName,
    meta: {
      call_id: block.callId,
      message_id: context.messageId,
    },
  });
}

export function findLatestMessageToolApproval(
  blocks: MessageBlock[],
  context: {
    messageId: string;
  },
): BridgeToolPendingApproval | null {
  return findMessageToolApprovals(blocks, context).at(-1) ?? null;
}

function matchesApprovalLookup(
  approval: BridgeToolPendingApproval,
  lookup: ApprovalLookupMatch,
) {
  const approvalToken = asTrimmedString(lookup.approvalToken);
  if (approvalToken && approval.approval_token === approvalToken) {
    return true;
  }

  const callId = asTrimmedString(lookup.callId);
  if (callId && approval.meta.call_id === callId) {
    return true;
  }

  return false;
}

export function mergeBridgeToolApproval(
  base: BridgeToolPendingApproval,
  incoming: BridgeToolPendingApproval,
): BridgeToolPendingApproval {
  return {
    ...base,
    ...incoming,
    meta: {
      ...base.meta,
      ...incoming.meta,
    },
  };
}

export function findMessageToolApprovals(
  blocks: MessageBlock[],
  context: {
    messageId: string;
  },
): BridgeToolPendingApproval[] {
  const approvals: BridgeToolPendingApproval[] = [];
  for (const block of blocks) {
    const approval = buildBridgeToolApprovalFromMessageBlock(block, context);
    if (approval) {
      approvals.push(approval);
    }
  }
  return approvals;
}

export function findMessageToolApproval(
  blocks: MessageBlock[],
  context: {
    messageId: string;
  },
  lookup: ApprovalLookupMatch,
): BridgeToolPendingApproval | null {
  const approvals = findMessageToolApprovals(blocks, context);
  for (let index = approvals.length - 1; index >= 0; index -= 1) {
    if (matchesApprovalLookup(approvals[index], lookup)) {
      return approvals[index];
    }
  }
  return null;
}

function isApprovalToolResultBlock(
  block: MessageBlock | null | undefined,
): block is ToolResultBlock {
  if (!block || block.type !== "tool_result") return false;
  if (
    typeof block.status === "string" &&
    block.status.trim().toLowerCase() === "requires_approval"
  ) {
    return true;
  }
  if (hasExplicitResolvedToolResultStatus(block)) {
    return false;
  }
  return extractToolApprovalPayload(block.result) !== null;
}

const APPROVAL_METADATA_ONLY_KEYS = new Set([
  "status",
  "approval_token",
  "tool_id",
  "tool_name",
  "arguments",
  "description",
  "risk_level",
  "risk_reasons",
  "recovered",
  "recovery_reason",
  "attempts",
  "expires_in_ms",
  "execution_graph_execution_id",
  "execution_graph_gate_node_id",
  "execution_graph_tool_node_id",
]);

function isBareApprovalReplayPayload(result: unknown) {
  const payload = toRecord(result);
  if (!payload) return false;
  if (asTrimmedString(payload.status) !== "REQUIRES_APPROVAL") return false;
  return Object.keys(payload).every((key) =>
    APPROVAL_METADATA_ONLY_KEYS.has(key),
  );
}

function collectToolApprovalResolution(messages: Message[]) {
  const resolvedCallIds = new Set<string>();
  const unresolvedCallIds = new Set<string>();
  const unresolvedApprovals: BridgeToolPendingApproval[] = [];
  const seenApprovalTokens = new Set<string>();

  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    if (message.role !== "assistant" || !Array.isArray(message.blocks))
      continue;

    for (
      let blockIndex = message.blocks.length - 1;
      blockIndex >= 0;
      blockIndex -= 1
    ) {
      const block = message.blocks[blockIndex];
      if (block.type !== "tool_result") continue;
      const toolResultBlock = block;

      const callId = asTrimmedString(toolResultBlock.callId);
      if (!callId) continue;

      const isPendingApprovalResult =
        isApprovalToolResultBlock(toolResultBlock);
      if (isPendingApprovalResult) {
        if (resolvedCallIds.has(callId)) continue;
        const approval = buildBridgeToolApprovalFromMessageBlock(
          toolResultBlock,
          {
            messageId: message.id,
          },
        );
        if (approval && !seenApprovalTokens.has(approval.approval_token)) {
          unresolvedApprovals.push(approval);
          unresolvedCallIds.add(callId);
          seenApprovalTokens.add(approval.approval_token);
        }
        continue;
      }

      // History replay can contain a terminal-looking block that only mirrors the
      // original approval snapshot. That placeholder is not proof the tool call
      // actually finished, so only treat the call as resolved once some real
      // post-approval payload exists beyond the approval metadata itself.
      const terminalToolResult = toolResultBlock as ToolResultBlock;
      if (!isBareApprovalReplayPayload(terminalToolResult.result)) {
        resolvedCallIds.add(callId);
      }
    }
  }

  for (const unresolvedCallId of unresolvedCallIds) {
    resolvedCallIds.delete(unresolvedCallId);
  }

  return {
    resolvedCallIds,
    unresolvedApprovals,
  };
}

export function findResolvedToolCallIds(messages: Message[]): Set<string> {
  return collectToolApprovalResolution(messages).resolvedCallIds;
}

export function findUnresolvedToolApprovals(
  messages: Message[],
): BridgeToolPendingApproval[] {
  return collectToolApprovalResolution(messages).unresolvedApprovals;
}

export function findLatestUnresolvedToolApproval(
  messages: Message[],
): BridgeToolPendingApproval | null {
  return findUnresolvedToolApprovals(messages)[0] ?? null;
}

export function enqueueBridgeToolApproval(
  approval: BridgeToolPendingApproval,
): boolean {
  const state = useBridgeApprovalStore.getState();
  const existing = state.queue.find(
    (item) => item.approval_token === approval.approval_token,
  );
  if (existing) {
    const existingHasGraphId = Boolean(
      existing.meta.execution_graph_execution_id,
    );
    const incomingHasGraphId = Boolean(
      approval.meta.execution_graph_execution_id,
    );
    const existingHasGateId = Boolean(
      existing.meta.execution_graph_gate_node_id,
    );
    const incomingHasGateId = Boolean(
      approval.meta.execution_graph_gate_node_id,
    );
    const existingHasToolNodeId = Boolean(
      existing.meta.execution_graph_tool_node_id,
    );
    const incomingHasToolNodeId = Boolean(
      approval.meta.execution_graph_tool_node_id,
    );

    const shouldUpgrade =
      (!existingHasGraphId && incomingHasGraphId) ||
      (!existingHasGateId && incomingHasGateId) ||
      (!existingHasToolNodeId && incomingHasToolNodeId) ||
      (!existing.meta.message_id && Boolean(approval.meta.message_id));

    if (shouldUpgrade) {
      state.replacePendingByToken({
        ...existing,
        ...approval,
        meta: {
          ...existing.meta,
          ...approval.meta,
        },
      });
      return true;
    }

    return false;
  }
  state.enqueuePending(approval);
  return true;
}

export function findMessageIdForToolCall(
  messages: Message[],
  callId: string | null | undefined,
): string | undefined {
  const normalizedCallId = typeof callId === "string" ? callId.trim() : "";
  if (!normalizedCallId) return undefined;

  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    if (message.role !== "assistant" || !Array.isArray(message.blocks))
      continue;
    const hasMatchingCall = message.blocks.some((block) => {
      if (
        (block.type !== "tool_call" && block.type !== "tool_result") ||
        !block.callId
      ) {
        return false;
      }
      return block.callId === normalizedCallId;
    });
    if (hasMatchingCall) {
      return message.id;
    }
  }

  return undefined;
}

export async function resolveAuthoritativeToolApproval(options: {
  approval: BridgeToolPendingApproval;
  messages: Message[];
  sessionId?: string | null | undefined;
}) {
  const { approval, messages, sessionId } = options;
  const fallbackMessageId =
    approval.meta.message_id ??
    findMessageIdForToolCall(messages, approval.meta.call_id);
  const message = fallbackMessageId
    ? messages.find((candidate) => candidate.id === fallbackMessageId)
    : undefined;

  let resolvedApproval = approval;
  if (message && Array.isArray(message.blocks)) {
    const fromMessage = findMessageToolApproval(
      message.blocks,
      { messageId: message.id },
      {
        approvalToken: approval.approval_token,
        callId: approval.meta.call_id,
      },
    );
    if (fromMessage) {
      resolvedApproval = mergeBridgeToolApproval(resolvedApproval, fromMessage);
    }
  }

  let executionMeta = resolveApprovalExecutionMetaFromMessage(
    message,
    resolvedApproval,
  );
  const normalizedSessionId = asTrimmedString(sessionId);
  if (
    normalizedSessionId &&
    (!executionMeta.execution_graph_execution_id ||
      !executionMeta.execution_graph_gate_node_id ||
      !executionMeta.execution_graph_tool_node_id)
  ) {
    try {
      const snapshots = await listPendingMcpApprovals(normalizedSessionId);
      const matchedSnapshot = snapshots.find(
        (snapshot) =>
          asTrimmedString(snapshot.approval_token) ===
            resolvedApproval.approval_token ||
          asTrimmedString(snapshot.call_id) === resolvedApproval.meta.call_id,
      );
      const fromSnapshot = matchedSnapshot
        ? buildBridgeToolApprovalFromPendingSnapshot(matchedSnapshot, {
            messageId: fallbackMessageId,
          })
        : null;
      if (fromSnapshot) {
        resolvedApproval = mergeBridgeToolApproval(
          resolvedApproval,
          fromSnapshot,
        );
        executionMeta = {
          execution_graph_execution_id:
            fromSnapshot.meta.execution_graph_execution_id ??
            executionMeta.execution_graph_execution_id,
          execution_graph_gate_node_id:
            fromSnapshot.meta.execution_graph_gate_node_id ??
            executionMeta.execution_graph_gate_node_id,
          execution_graph_tool_node_id:
            fromSnapshot.meta.execution_graph_tool_node_id ??
            executionMeta.execution_graph_tool_node_id,
        };
      }
    } catch {
      // Swallow canonical lookup failures here; callers handle the final missing-meta error.
    }
  }

  const nextMessageId =
    resolvedApproval.meta.message_id ?? fallbackMessageId ?? undefined;
  resolvedApproval = {
    ...resolvedApproval,
    meta: {
      ...resolvedApproval.meta,
      message_id: nextMessageId,
      execution_graph_execution_id:
        executionMeta.execution_graph_execution_id ??
        resolvedApproval.meta.execution_graph_execution_id,
      execution_graph_gate_node_id:
        executionMeta.execution_graph_gate_node_id ??
        resolvedApproval.meta.execution_graph_gate_node_id,
      execution_graph_tool_node_id:
        executionMeta.execution_graph_tool_node_id ??
        resolvedApproval.meta.execution_graph_tool_node_id,
    },
  };

  enqueueBridgeToolApproval(resolvedApproval);

  return {
    approval: resolvedApproval,
    messageId: nextMessageId,
    message,
    executionMeta: resolveApprovalExecutionMetaFromMessage(
      message,
      resolvedApproval,
    ),
  };
}

export function resolveApprovalExecutionMetaFromMessage(
  message: Message | undefined,
  approval: BridgeToolPendingApproval,
) {
  const existing = {
    execution_graph_execution_id: approval.meta.execution_graph_execution_id,
    execution_graph_gate_node_id: approval.meta.execution_graph_gate_node_id,
    execution_graph_tool_node_id: approval.meta.execution_graph_tool_node_id,
  };
  if (!message || !Array.isArray(message.blocks)) {
    return existing;
  }

  const normalizedCallId = approval.meta.call_id?.trim();
  let resolvedExecutionId = existing.execution_graph_execution_id;
  let resolvedGateNodeId = existing.execution_graph_gate_node_id;
  let resolvedToolNodeId = existing.execution_graph_tool_node_id;

  for (let index = message.blocks.length - 1; index >= 0; index -= 1) {
    const block = message.blocks[index];
    if (
      (block.type !== "tool_result" && block.type !== "tool_call") ||
      !block.callId
    ) {
      continue;
    }
    if (normalizedCallId && block.callId.trim() !== normalizedCallId) {
      continue;
    }
    const result = toRecord(block.type === "tool_result" ? block.result : null);
    resolvedExecutionId =
      resolvedExecutionId ??
      asTrimmedString(result?.execution_graph_execution_id) ??
      undefined;
    resolvedGateNodeId =
      resolvedGateNodeId ??
      asTrimmedString(result?.execution_graph_gate_node_id) ??
      undefined;
    resolvedToolNodeId =
      resolvedToolNodeId ??
      asTrimmedString(result?.execution_graph_tool_node_id) ??
      undefined;
    if (resolvedExecutionId && resolvedGateNodeId && resolvedToolNodeId) {
      break;
    }
  }

  resolvedExecutionId =
    resolvedExecutionId ??
    extractRootExecutionIdFromMessage(message) ??
    undefined;

  return {
    execution_graph_execution_id: resolvedExecutionId,
    execution_graph_gate_node_id: resolvedGateNodeId,
    execution_graph_tool_node_id: resolvedToolNodeId,
  };
}

export function buildBridgeToolApprovalFromPendingSnapshot(
  snapshot: PendingToolApprovalSnapshot,
  fallback?: {
    messageId?: string;
  },
): BridgeToolPendingApproval | null {
  const payload = extractToolApprovalPayload(snapshot);
  if (!payload) return null;

  const callId = asTrimmedString(snapshot.call_id);
  const toolName = payload.tool_name;
  if (!callId || !toolName) return null;

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
  });
}

export function createOptimisticApprovalExecutionBlocks(
  approval: BridgeToolPendingApproval,
  blocks: MessageBlock[],
): MessageBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;

  const callId = approval.meta.call_id?.trim();
  if (!callId) return blocks;

  let changed = false;
  const next: MessageBlock[] = [];

  for (const block of blocks) {
    if (block.type === "tool_result" && block.callId === callId) {
      if (isApprovalToolResultBlock(block)) {
        changed = true;
        continue;
      }
    }

    if (
      block.type === "tool_call" &&
      block.callId === callId &&
      block.status !== "running"
    ) {
      changed = true;
      next.push({
        ...block,
        status: "running",
      });
      continue;
    }

    next.push(block);
  }

  return changed ? next : blocks;
}

export function createApprovedToolResultBlock(
  approval: BridgeToolPendingApproval,
  result: unknown,
  metadata?: {
    local_chat_resume?: Record<string, unknown>;
  },
): ToolResultBlock | null {
  const callId = approval.meta.call_id?.trim();
  if (!callId) return null;
  const normalizedResult = unwrapNestedToolResultEnvelope(result);
  const resultRecord = toRecord(normalizedResult);
  const localChatResume = metadata?.local_chat_resume;
  return {
    id: `${callId}-approved`,
    type: "tool_result",
    callId,
    toolName: approval.tool_name,
    status: "success",
    result:
      resultRecord || localChatResume
        ? {
            ...(resultRecord ?? { value: normalizedResult }),
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
            ...(localChatResume ? { local_chat_resume: localChatResume } : {}),
          }
        : normalizedResult,
  };
}

export function createRejectedToolResultBlock(
  approval: BridgeToolPendingApproval,
  errorMessage = "User rejected tool execution",
): ToolResultBlock | null {
  const callId = approval.meta.call_id?.trim();
  if (!callId) return null;
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
  };
}

export type LocalChatApprovalResume = {
  status:
    | "LOCAL_CHAT_WAITING_APPROVAL"
    | "LOCAL_CHAT_RESUMED"
    | "LOCAL_CHAT_RESUME_FAILED";
  approval_token: string;
  resolved_gate_node_id?: string;
  resolved_call_id?: string;
  approved_tool_result: unknown;
  continuation_blocks: MessageBlock[];
  execution_graph?: Record<string, unknown>;
  execution_graph_execution_id?: string;
  pending_approval_gate_ids: string[];
  next_pending_approval_tokens: string[];
  error_code?: string;
  error?: string;
  retryable?: boolean;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function extractNodeStatusById(
  executionGraph: Record<string, unknown> | undefined,
  nodeId: string | undefined,
): string | undefined {
  const normalizedNodeId = typeof nodeId === "string" ? nodeId.trim() : "";
  if (!normalizedNodeId) return undefined;
  const nodes = Array.isArray(executionGraph?.nodes)
    ? executionGraph.nodes
    : [];
  const matched = nodes.find((node) => {
    if (!node || typeof node !== "object") return false;
    return (node as Record<string, unknown>).node_id === normalizedNodeId;
  }) as Record<string, unknown> | undefined;
  return typeof matched?.status === "string"
    ? matched.status.trim()
    : undefined;
}

export function extractLocalChatApprovalResume(
  result: unknown,
): LocalChatApprovalResume | null {
  const payload = toRecord(result);
  if (!payload) return null;
  const status = asTrimmedString(payload.status);
  if (
    status !== "LOCAL_CHAT_WAITING_APPROVAL" &&
    status !== "LOCAL_CHAT_RESUMED" &&
    status !== "LOCAL_CHAT_RESUME_FAILED"
  ) {
    return null;
  }

  const approvalToken = asTrimmedString(payload.approval_token);
  if (!approvalToken) return null;

  const continuationBlocks = Array.isArray(payload.continuation_blocks)
    ? (payload.continuation_blocks.filter((block): block is MessageBlock =>
        Boolean(
          block &&
          typeof block === "object" &&
          "type" in (block as Record<string, unknown>),
        ),
      ) as MessageBlock[])
    : [];

  const executionGraph = toRecord(payload.execution_graph) ?? undefined;
  const resolvedGateNodeId =
    asTrimmedString(payload.resolved_gate_node_id) ?? undefined;
  const pendingApprovalGateIds = normalizeStringArray(
    payload.pending_approval_gate_ids,
  );
  const nextPendingApprovalTokens = normalizeStringArray(
    payload.next_pending_approval_tokens,
  );
  const approvedToolResult = unwrapNestedToolResultEnvelope(
    payload.approved_tool_result,
  );

  if (status === "LOCAL_CHAT_WAITING_APPROVAL") {
    const resolvedGateStatus = extractNodeStatusById(
      executionGraph,
      resolvedGateNodeId,
    );
    const hasNextPendingApprovalEvidence =
      pendingApprovalGateIds.length > 0 || nextPendingApprovalTokens.length > 0;
    if (
      resolvedGateNodeId &&
      resolvedGateStatus?.toLowerCase() === "waiting_approval" &&
      !hasNextPendingApprovalEvidence
    ) {
      return {
        status: "LOCAL_CHAT_RESUME_FAILED",
        approval_token: approvalToken,
        resolved_gate_node_id: resolvedGateNodeId,
        resolved_call_id:
          asTrimmedString(payload.resolved_call_id) ?? undefined,
        approved_tool_result: approvedToolResult,
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
      };
    }

    if (!hasNextPendingApprovalEvidence) {
      return {
        status: "LOCAL_CHAT_RESUME_FAILED",
        approval_token: approvalToken,
        resolved_gate_node_id: resolvedGateNodeId,
        resolved_call_id:
          asTrimmedString(payload.resolved_call_id) ?? undefined,
        approved_tool_result: approvedToolResult,
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
      };
    }
  }

  return {
    status,
    approval_token: approvalToken,
    resolved_gate_node_id: resolvedGateNodeId,
    resolved_call_id: asTrimmedString(payload.resolved_call_id) ?? undefined,
    approved_tool_result: approvedToolResult,
    continuation_blocks: continuationBlocks,
    execution_graph: executionGraph,
    execution_graph_execution_id:
      asTrimmedString(payload.execution_graph_execution_id) ?? undefined,
    pending_approval_gate_ids: pendingApprovalGateIds,
    next_pending_approval_tokens: nextPendingApprovalTokens,
    error_code: asTrimmedString(payload.error_code) ?? undefined,
    error: asTrimmedString(payload.error) ?? undefined,
    retryable: payload.retryable === true,
  };
}

export function createLocalChatResumeErrorBlock(
  approval: BridgeToolPendingApproval,
  errorMessage: string,
): MessageBlock {
  return {
    id: `${approval.meta.call_id}-resume-error`,
    type: "error",
    message: errorMessage,
  };
}
