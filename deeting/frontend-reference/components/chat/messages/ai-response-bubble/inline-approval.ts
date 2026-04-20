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
} from "@/lib/chat/tool-approval";
import { refreshBridgePendingApprovalsFromCanonical } from "@/lib/chat/canonical-approval-refresh";
import type { Message } from "@/lib/chat/message-types";

export async function runInlineApproval({
  approval,
  messageId,
  sessionId,
  resolveMessages,
  applyOptimisticExecutionState,
  removePendingByToken,
  upsertMessageToolResult,
  appendMessageBlocks,
}: {
  approval: BridgeToolPendingApproval;
  messageId: string;
  sessionId: string | null;
  resolveMessages: () => Message[];
  applyOptimisticExecutionState: () => void;
  removePendingByToken: (approvalToken: string) => void;
  upsertMessageToolResult: (messageId: string, block: ToolResultBlock) => void;
  appendMessageBlocks: (messageId: string, blocks: MessageBlock[]) => void;
}) {
  applyOptimisticExecutionState();
  announceBridgeApprovalExecution(approval);
  removePendingByToken(approval.approval_token);
  let streamedContinuationApplied = false;

  try {
    const result = await streamDesktopApproveTool(
      {
        approvalToken: approval.approval_token,
        approvalMode: "allow_once",
        callId: approval.meta.call_id,
        executionToken: approval.meta.execution_token,
        executionGraphExecutionId: approval.meta.execution_graph_execution_id,
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
          appendMessageBlocks(messageId, blocks);
          streamedContinuationApplied = true;
        },
      },
    );

    const resumePayload = extractLocalChatApprovalResume(result);
    const approvedToolResult = resumePayload?.approved_tool_result ?? result;
    const successBlock = createApprovedToolResultBlock(
      approval,
      approvedToolResult,
    );
    if (successBlock) {
      upsertMessageToolResult(messageId, successBlock);
    }
    if (
      resumePayload?.continuation_blocks?.length &&
      !streamedContinuationApplied
    ) {
      appendMessageBlocks(messageId, resumePayload.continuation_blocks);
    }
    if (resumePayload?.error) {
      appendMessageBlocks(messageId, [
        createLocalChatResumeErrorBlock(approval, resumePayload.error),
      ]);
    }

    if (resumePayload?.status === "LOCAL_CHAT_WAITING_APPROVAL") {
      try {
        await refreshBridgePendingApprovalsFromCanonical({
          sessionId,
          messages: resolveMessages(),
          excludeCallIds: [approval.meta.call_id],
          excludeApprovalTokens: [approval.approval_token, resumePayload.approval_token],
          excludeGateNodeIds: [
            approval.meta.execution_graph_gate_node_id,
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

    if (approval.meta.execution_token) {
      await bridgeCallTool({
        tool_name: approval.tool_name,
        arguments: {
          call_id: approval.meta.call_id,
          result,
          ok: true,
        },
        execution_token: approval.meta.execution_token,
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
    await rejectDesktopTool({
      approvalToken: approval.approval_token,
      rejectMode: "reject_once",
      executionGraphExecutionId: approval.meta.execution_graph_execution_id,
    });
    const rejectedBlock = createRejectedToolResultBlock(approval, rejectLabel);
    if (rejectedBlock) {
      upsertMessageToolResult(messageId, rejectedBlock);
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorBlock = createRejectedToolResultBlock(approval, errorMessage);
    if (errorBlock) {
      upsertMessageToolResult(messageId, errorBlock);
    }
  }
}
