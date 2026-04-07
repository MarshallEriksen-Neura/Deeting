import {
  createApprovedToolResultBlock,
  extractLocalChatApprovalResume,
  findLatestUnresolvedToolApproval,
} from "@/lib/chat/tool-approval"
import type { Message } from "@/lib/chat/message-types"

describe("findLatestUnresolvedToolApproval", () => {
  it("skips approvals that were already resolved by a later terminal tool result", () => {
    const messages: Message[] = [
      {
        id: "assistant-approval",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "tool-call-1",
            type: "tool_call",
            callId: "call-1",
            toolName: "browser_click",
            status: "running",
          },
          {
            id: "tool-result-approval-1",
            type: "tool_result",
            callId: "call-1",
            toolName: "browser_click",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-1",
              tool_name: "browser_click",
              arguments: { target: { text: "Continue" } },
            },
          },
        ],
      },
      {
        id: "assistant-approved",
        role: "assistant",
        content: "",
        createdAt: 2,
        blocks: [
          {
            id: "tool-result-approved-1",
            type: "tool_result",
            callId: "call-1",
            toolName: "browser_click",
            status: "success",
            result: {
              ok: true,
            },
          },
        ],
      },
    ]

    expect(findLatestUnresolvedToolApproval(messages)).toBeNull()
  })

  it("returns the newest approval that is still unresolved", () => {
    const messages: Message[] = [
      {
        id: "assistant-approved",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "tool-result-approved-1",
            type: "tool_result",
            callId: "call-1",
            toolName: "browser_click",
            status: "success",
            result: {
              ok: true,
            },
          },
        ],
      },
      {
        id: "assistant-pending",
        role: "assistant",
        content: "",
        createdAt: 2,
        blocks: [
          {
            id: "tool-call-2",
            type: "tool_call",
            callId: "call-2",
            toolName: "browser_type",
            status: "running",
          },
          {
            id: "tool-result-approval-2",
            type: "tool_result",
            callId: "call-2",
            toolName: "browser_type",
            status: "success",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-2",
              tool_name: "browser_type",
              arguments: { text: "me@example.com" },
              execution_graph_execution_id: "graph-exec-2",
              execution_graph_gate_node_id: "approval_gate:call-2",
              execution_graph_tool_node_id: "tool_call:call-2",
            },
          },
        ],
      },
    ]

    expect(findLatestUnresolvedToolApproval(messages)).toMatchObject({
      approval_token: "approval-2",
      tool_name: "browser_type",
      meta: {
        call_id: "call-2",
        message_id: "assistant-pending",
        execution_graph_execution_id: "graph-exec-2",
        execution_graph_gate_node_id: "approval_gate:call-2",
        execution_graph_tool_node_id: "tool_call:call-2",
      },
    })
  })
})

describe("extractLocalChatApprovalResume", () => {
  it("preserves graph runtime identifiers from a resumed local chat payload", () => {
    expect(
      extractLocalChatApprovalResume({
        status: "LOCAL_CHAT_RESUMED",
        approved_tool_result: { ok: true },
        continuation_blocks: [{ id: "resume-1", type: "text", content: "done" }],
        execution_graph_execution_id: "graph-exec-1",
        execution_graph: {
          execution_id: "graph-exec-1",
          nodes: [],
        },
      })
    ).toMatchObject({
      approved_tool_result: { ok: true },
      continuation_blocks: [{ id: "resume-1", type: "text", content: "done" }],
      execution_graph_execution_id: "graph-exec-1",
      execution_graph: {
        execution_id: "graph-exec-1",
      },
    })
  })
})

describe("createApprovedToolResultBlock", () => {
  it("preserves graph runtime identifiers on approved results", () => {
    expect(
      createApprovedToolResultBlock(
        {
          kind: "bridge_mcp",
          approval_token: "approval-1",
          tool_name: "browser_click",
          arguments: {},
          meta: {
            call_id: "call-1",
            execution_graph_execution_id: "graph-exec-1",
            execution_graph_gate_node_id: "approval_gate:call-1",
            execution_graph_tool_node_id: "tool_call:call-1",
          },
        },
        { ok: true }
      )
    ).toMatchObject({
      callId: "call-1",
      result: {
        ok: true,
        execution_graph_execution_id: "graph-exec-1",
        execution_graph_gate_node_id: "approval_gate:call-1",
        execution_graph_tool_node_id: "tool_call:call-1",
      },
    })
  })
})
