"use client";

import { announceBridgeApprovalExecution } from "@/lib/chat/bridge-approval-store";
import { bridgeCallTool } from "@/lib/api/bridge";
import {
  rejectDesktopTool,
  streamDesktopApproveTool,
} from "@/lib/api/mcp-desktop";
import type { MessageBlock, ToolResultBlock } from "@/lib/chat/message-protocol";
import type { BridgeToolPendingApproval } from "@/lib/chat/bridge-approval-store";
import {
  createApprovedToolResultBlock,
  createLocalChatResumeErrorBlock,
  createRejectedToolResultBlock,
  extractLocalChatApprovalResume,
  resolveAuthoritativeToolApproval,
} from "@/lib/chat/tool-approval";
import { deriveChatStatusUpdateForMessage } from "@/lib/chat/live-status";
import { refreshBridgePendingApprovalsFromCanonical } from "@/lib/chat/canonical-approval-refresh";
import type { Message } from "@/lib/chat/message-types";
import { useChatStore } from "@/store/chat-store";
import { useChatRuntimeStore } from "@/store/chat-runtime-store";

function syncRuntimeStatusForMessage(messageId: string) {
  const status = deriveChatStatusUpdateForMessage(
    useChatStore.getState().messages,
    messageId,
  );
  const runtime = useChatRuntimeStore.getState();
  if (!status) {
    runtime.setActiveMessageId(null);
    runtime.clearStatus();
    return;
  }
  runtime.setActiveMessageId(messageId);
  runtime.setStatus(status);
}

function buildLocalChatResumeResultMeta(
  resumePayload: NonNullable<ReturnType<typeof extractLocalChatApprovalResume>>,
) {
  return {
    status: resumePayload.status,
    error_code: resumePayload.error_code,
    error: resumePayload.error,
    retryable: resumePayload.retryable === true,
    continuation_blocks_count: resumePayload.continuation_blocks.length,
    pending_approval_gate_count: resumePayload.pending_approval_gate_ids.length,
    next_pending_approval_count: resumePayload.next_pending_approval_tokens.length,
  };
}

export async function runInlineApproval({
  approval,
  messageId,
  sessionId,
  resolveMessages,
  applyOptimisticExecutionState,
  removePendingByToken,
  upsertMessageToolResult,
  appendMessageBlocks,
  approvalMode = "allow_once",
}: {
  approval: BridgeToolPendingApproval;
  messageId: string;
  sessionId: string | null;
  resolveMessages: () => Message[];
  applyOptimisticExecutionState: () => void;
  removePendingByToken: (approvalToken: string) => void;
  upsertMessageToolResult: (messageId: string, block: ToolResultBlock) => void;
  appendMessageBlocks: (messageId: string, blocks: MessageBlock[]) => void;
  approvalMode?: "allow_once" | "allow_always";
}) {
  applyOptimisticExecutionState();
  announceBridgeApprovalExecution(approval);
  removePendingByToken(approval.approval_token);
  let streamedContinuationApplied = false;

  try {
    const resolution = await resolveAuthoritativeToolApproval({
      approval,
      messages: resolveMessages(),
      sessionId,
    });
    const effectiveApproval = resolution.approval;
    const targetMessageId = resolution.messageId ?? messageId;
    const executionGraphExecutionId =
      resolution.executionMeta.execution_graph_execution_id;
    if (!executionGraphExecutionId) {
      throw new Error("execution_graph_execution_id is required for desktop approval");
    }
    const result = await streamDesktopApproveTool(
      {
        approvalToken: effectiveApproval.approval_token,
        approvalMode,
        callId: effectiveApproval.meta.call_id,
        executionToken: effectiveApproval.meta.execution_token,
        executionGraphExecutionId,
      },
      {
        onMessage: (data) => {
          if (!data || typeof data !== "object" || !("type" in data)) return;
          const event = data as { type?: string; blocks?: unknown };
          if (event.type !== "blocks" || !Array.isArray(event.blocks)) return;
          const blocks = event.blocks.filter(
            (block): block is MessageBlock =>
              Boolean(
                block &&
                  typeof block === "object" &&
                  "type" in (block as Record<string, unknown>),
              ),
          );
          if (blocks.length === 0) return;
          appendMessageBlocks(targetMessageId, blocks);
          syncRuntimeStatusForMessage(targetMessageId);
          streamedContinuationApplied = true;
        },
      },
    );

    const resumePayload = extractLocalChatApprovalResume(result);
    const approvedToolResult = resumePayload?.approved_tool_result ?? result;
    const successBlock = createApprovedToolResultBlock(
      effectiveApproval,
      approvedToolResult,
      resumePayload
        ? {
            local_chat_resume: buildLocalChatResumeResultMeta(resumePayload),
          }
        : undefined,
    );
    if (successBlock) {
      upsertMessageToolResult(targetMessageId, successBlock);
    }
    if (
      resumePayload?.continuation_blocks?.length &&
      !streamedContinuationApplied
    ) {
      appendMessageBlocks(targetMessageId, resumePayload.continuation_blocks);
    }
    if (resumePayload?.error) {
      appendMessageBlocks(targetMessageId, [
        createLocalChatResumeErrorBlock(effectiveApproval, resumePayload.error),
      ]);
    }
    syncRuntimeStatusForMessage(targetMessageId);

    if (resumePayload?.status === "LOCAL_CHAT_WAITING_APPROVAL") {
      try {
        await refreshBridgePendingApprovalsFromCanonical({
          sessionId,
          messages: resolveMessages(),
          excludeCallIds: [effectiveApproval.meta.call_id],
          excludeApprovalTokens: [effectiveApproval.approval_token, resumePayload.approval_token],
          excludeGateNodeIds: [
            effectiveApproval.meta.execution_graph_gate_node_id,
            resumePayload.resolved_gate_node_id,
          ],
          preferredApprovalToken: resumePayload.next_pending_approval_tokens[0],
          forceReplace: true,
        });
      } catch (refreshError) {
        console.error(
          "[InlineApproval] Failed to refresh canonical approvals after approval",
          refreshError,
        );
      }
    }

    if (effectiveApproval.meta.execution_token) {
      await bridgeCallTool({
        tool_name: effectiveApproval.tool_name,
        arguments: {
          call_id: effectiveApproval.meta.call_id,
          result,
          ok: true,
        },
        execution_token: effectiveApproval.meta.execution_token,
      });
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorBlock = createRejectedToolResultBlock(approval, errorMessage);
    if (errorBlock) {
      upsertMessageToolResult(messageId, errorBlock);
    }
    appendMessageBlocks(messageId, [
      createLocalChatResumeErrorBlock(approval, errorMessage),
    ]);
    syncRuntimeStatusForMessage(messageId);
    if (approval.meta.execution_token) {
      try {
        await bridgeCallTool({
          tool_name: approval.tool_name,
          arguments: {
            call_id: approval.meta.call_id,
            result: { error: errorMessage },
            ok: false,
          },
          execution_token: approval.meta.execution_token,
        });
      } catch {}
    }
  }
}

export async function runInlineRejection({
  approval,
  messageId,
  rejectLabel,
  removePendingByToken,
  upsertMessageToolResult,
}: {
  approval: BridgeToolPendingApproval;
  messageId: string;
  rejectLabel: string;
  removePendingByToken: (approvalToken: string) => void;
  upsertMessageToolResult: (messageId: string, block: ToolResultBlock) => void;
}) {
  removePendingByToken(approval.approval_token);
  try {
    const resolution = await resolveAuthoritativeToolApproval({
      approval,
      messages: useChatStore.getState().messages,
      sessionId: useChatStore.getState().sessionId,
    });
    const effectiveApproval = resolution.approval;
    const targetMessageId = resolution.messageId ?? messageId;
    const executionGraphExecutionId =
      resolution.executionMeta.execution_graph_execution_id;
    if (!executionGraphExecutionId) {
      throw new Error("execution_graph_execution_id is required for desktop reject");
    }
    await rejectDesktopTool({
      approvalToken: effectiveApproval.approval_token,
      rejectMode: "reject_once",
      executionGraphExecutionId,
    });
    const rejectedBlock = createRejectedToolResultBlock(effectiveApproval, rejectLabel);
    if (rejectedBlock) {
      upsertMessageToolResult(targetMessageId, rejectedBlock);
    }
    syncRuntimeStatusForMessage(targetMessageId);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorBlock = createRejectedToolResultBlock(approval, errorMessage);
    if (errorBlock) {
      upsertMessageToolResult(messageId, errorBlock);
    }
    syncRuntimeStatusForMessage(messageId);
  }
}
