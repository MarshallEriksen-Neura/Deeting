"use client"

import { act, waitFor } from "@testing-library/react"
import { runInlineApproval } from "@/components/chat/messages/ai-response-bubble/inline-approval"
import {
  createBridgeToolApproval,
  useBridgeApprovalStore,
} from "@/lib/chat/bridge-approval-store"
import { listPendingMcpApprovals } from "@/lib/api/mcp-approvals"
import { streamDesktopApproveTool } from "@/lib/api/mcp-desktop"
import { useChatStore } from "@/store/chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"

jest.mock("@/lib/api/mcp-desktop", () => ({
  streamDesktopApproveTool: jest.fn(),
  rejectDesktopTool: jest.fn(),
}))

jest.mock("@/lib/api/mcp-approvals", () => ({
  listPendingMcpApprovals: jest.fn(),
}))

jest.mock("@/lib/api/bridge", () => ({
  bridgeCallTool: jest.fn(),
}))

const mockApproveTool = streamDesktopApproveTool as jest.MockedFunction<
  typeof streamDesktopApproveTool
>
const mockListPendingMcpApprovals =
  listPendingMcpApprovals as jest.MockedFunction<typeof listPendingMcpApprovals>

describe("runInlineApproval", () => {
  afterEach(() => {
    mockApproveTool.mockReset()
    mockListPendingMcpApprovals.mockReset()
    act(() => {
      useBridgeApprovalStore.getState().clearAll()
      useBridgeApprovalStore.getState().clearRecentApprovedExecution()
      useChatStore.getState().resetSession()
    })
  })

  it("refreshes canonical pending approvals when the local approval result is still waiting on the next gate", async () => {
    mockApproveTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_WAITING_APPROVAL",
      approval_token: "approval-inline-1",
      resolved_gate_node_id: "approval_gate:call-inline-1",
      resolved_call_id: "call-inline-1",
      approved_tool_result: { ok: true },
      continuation_blocks: [
        {
          id: "call-inline-next-1",
          type: "tool_call",
          callId: "call-inline-next-1",
          toolName: "browser_click",
          status: "running",
        },
        {
          id: "result-inline-next-1",
          type: "tool_result",
          callId: "call-inline-next-1",
          toolName: "browser_click",
          status: "requires_approval",
          result: {
            status: "REQUIRES_APPROVAL",
            approval_token: "approval-inline-next-1",
            tool_name: "browser_click",
          },
        },
      ],
      execution_graph_execution_id: "graph-inline-1",
      pending_approval_gate_ids: ["approval_gate:call-inline-next-1"],
      next_pending_approval_tokens: ["approval-inline-next-1"],
    } as unknown)
    mockListPendingMcpApprovals.mockResolvedValueOnce([
      {
        status: "REQUIRES_APPROVAL",
        approval_token: "approval-inline-next-1",
        tool_name: "browser_click",
        arguments: { target: { text: "Continue" } },
        call_id: "call-inline-next-1",
        session_id: "session-inline-1",
        execution_graph_execution_id: "graph-inline-1",
      },
    ])

    act(() => {
      useChatStore.setState({
        sessionId: "session-inline-1",
        messages: [
          {
            id: "assistant-inline-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [
              {
                id: "call-inline-1",
                type: "tool_call",
                callId: "call-inline-1",
                toolName: "browser_open_tab",
                status: "running",
              } as MessageBlock,
              {
                id: "result-inline-1",
                type: "tool_result",
                callId: "call-inline-1",
                toolName: "browser_open_tab",
                status: "requires_approval",
                result: {
                  status: "REQUIRES_APPROVAL",
                  approval_token: "approval-inline-1",
                  execution_graph_execution_id: "graph-inline-1",
                },
              } as MessageBlock,
            ],
          },
        ],
      })
      useBridgeApprovalStore.getState().setPending(
        createBridgeToolApproval({
          approval_token: "approval-inline-1",
          tool_name: "browser_open_tab",
          arguments: { url: "https://example.com" },
          meta: {
            call_id: "call-inline-1",
            message_id: "assistant-inline-1",
            execution_graph_execution_id: "graph-inline-1",
          },
        })
      )
    })

    const approval = useBridgeApprovalStore.getState().pending
    expect(approval).not.toBeNull()

    await runInlineApproval({
      approval: approval!,
      messageId: "assistant-inline-1",
      sessionId: "session-inline-1",
      resolveMessages: () => useChatStore.getState().messages,
      applyOptimisticExecutionState: () => {
        const message = useChatStore.getState().messages[0]
        if (!message?.blocks) return
        useChatStore
          .getState()
          .setMessageBlocks("assistant-inline-1", [
            {
              id: "call-inline-1",
              type: "tool_call",
              callId: "call-inline-1",
              toolName: "browser_open_tab",
              status: "running",
            },
          ])
      },
      removePendingByToken: useBridgeApprovalStore.getState().removePendingByToken,
      upsertMessageToolResult: useChatStore.getState().upsertMessageToolResult,
      appendMessageBlocks: useChatStore.getState().appendMessageBlocks,
    })

    await waitFor(() => {
      expect(mockListPendingMcpApprovals).toHaveBeenCalledWith("session-inline-1")
    })

    await waitFor(() => {
      expect(useBridgeApprovalStore.getState().queue).toEqual([
        expect.objectContaining({
          approval_token: "approval-inline-next-1",
          tool_name: "browser_click",
          arguments: { target: { text: "Continue" } },
          meta: expect.objectContaining({
            call_id: "call-inline-next-1",
            message_id: "assistant-inline-1",
          }),
        }),
      ])
    })
  })
})
