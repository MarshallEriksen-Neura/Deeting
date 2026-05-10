import {
  createApprovedToolResultBlock,
  extractLocalChatApprovalResume,
  findResolvedToolCallIds,
  findLatestUnresolvedToolApproval,
  resolveAuthoritativeToolApproval,
  resolveApprovalExecutionMetaFromMessage,
} from "@/lib/chat/tool-approval"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import type { Message } from "@/lib/chat/message-types"

afterEach(() => {
  useBridgeApprovalStore.getState().clearAll()
})

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
            status: "requires_approval",
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

  it("keeps a newer requires_approval block unresolved even when the same call already has a success result", () => {
    const messages: Message[] = [
      {
        id: "assistant-approved-first",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "tool-result-approved-shared-call",
            type: "tool_result",
            callId: "call-shared-1",
            toolName: "firecrawl_browser_execute",
            status: "success",
            result: {
              ok: true,
            },
          },
        ],
      },
      {
        id: "assistant-pending-next-gate",
        role: "assistant",
        content: "",
        createdAt: 2,
        blocks: [
          {
            id: "tool-result-pending-shared-call",
            type: "tool_result",
            callId: "call-shared-1",
            toolName: "firecrawl_browser_execute",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-shared-next-1",
              tool_name: "firecrawl_browser_execute",
              arguments: { code: "agent-browser scroll down", language: "bash" },
              execution_graph_execution_id: "graph-shared-1",
              execution_graph_gate_node_id: "approval_gate:call-shared-next-1",
            },
          },
        ],
      },
    ]

    expect(findResolvedToolCallIds(messages).has("call-shared-1")).toBe(false)
    expect(findLatestUnresolvedToolApproval(messages)).toMatchObject({
      approval_token: "approval-shared-next-1",
      meta: {
        call_id: "call-shared-1",
        message_id: "assistant-pending-next-gate",
        execution_graph_execution_id: "graph-shared-1",
        execution_graph_gate_node_id: "approval_gate:call-shared-next-1",
      },
    })
  })

  it("ignores stale approval payloads once the block itself is marked success", () => {
    const messages: Message[] = [
      {
        id: "assistant-approved-stale",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "tool-result-approved-stale-1",
            type: "tool_result",
            callId: "call-stale-1",
            toolName: "shell_execute",
            status: "success",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-stale-1",
              ok: true,
            },
          },
        ],
      },
    ]

    expect(findLatestUnresolvedToolApproval(messages)).toBeNull()
  })

  it("ignores stale approval payloads once the block itself is marked error", () => {
    const messages: Message[] = [
      {
        id: "assistant-error-stale",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "tool-result-error-stale-1",
            type: "tool_result",
            callId: "call-error-stale-1",
            toolName: "shell_execute",
            status: "error",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-error-stale-1",
              error: "pending tool call not found",
            },
          },
        ],
      },
    ]

    expect(findLatestUnresolvedToolApproval(messages)).toBeNull()
  })
})

describe("resolveApprovalExecutionMetaFromMessage", () => {
  it("fills missing execution graph identifiers from the latest matching tool result block", () => {
    const message: Message = {
      id: "assistant-graph-meta-1",
      role: "assistant",
      content: "",
      createdAt: 1,
      blocks: [
        {
          id: "tool-call-graph-meta-1",
          type: "tool_call",
          callId: "call-graph-meta-1",
          toolName: "browser_open_tab",
          status: "running",
        },
        {
          id: "tool-result-graph-meta-1",
          type: "tool_result",
          callId: "call-graph-meta-1",
          toolName: "browser_open_tab",
          status: "requires_approval",
          result: {
            status: "REQUIRES_APPROVAL",
            approval_token: "approval-graph-meta-1",
            execution_graph_execution_id: "graph-meta-1",
            execution_graph_gate_node_id: "approval_gate:call-graph-meta-1",
            execution_graph_tool_node_id: "tool_call:call-graph-meta-1",
          },
        },
      ],
      metaInfo: {
        execution_tree: {
          root_execution_id: "graph-meta-1",
        },
      },
    }

    expect(
      resolveApprovalExecutionMetaFromMessage(message, {
        kind: "bridge_mcp",
        approval_token: "approval-graph-meta-1",
        tool_name: "browser_open_tab",
        arguments: { url: "https://x.com/home" },
        meta: {
          call_id: "call-graph-meta-1",
          message_id: "assistant-graph-meta-1",
        },
      }),
    ).toEqual({
      execution_graph_execution_id: "graph-meta-1",
      execution_graph_gate_node_id: "approval_gate:call-graph-meta-1",
      execution_graph_tool_node_id: "tool_call:call-graph-meta-1",
    })
  })
})

describe("resolveAuthoritativeToolApproval", () => {
  it("matches the targeted approval by token instead of always taking the latest approval block", async () => {
    const messages: Message[] = [
      {
        id: "assistant-multi-approval",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "tool-call-1",
            type: "tool_call",
            callId: "call-1",
            toolName: "browser_open_tab",
            status: "running",
          },
          {
            id: "tool-result-1",
            type: "tool_result",
            callId: "call-1",
            toolName: "browser_open_tab",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-1",
              tool_name: "browser_open_tab",
              arguments: { url: "https://x.com/home" },
              execution_graph_execution_id: "graph-1",
              execution_graph_gate_node_id: "approval_gate:call-1",
              execution_graph_tool_node_id: "tool_call:call-1",
            },
          },
          {
            id: "tool-call-2",
            type: "tool_call",
            callId: "call-2",
            toolName: "browser_get_page_snapshot",
            status: "running",
          },
          {
            id: "tool-result-2",
            type: "tool_result",
            callId: "call-2",
            toolName: "browser_get_page_snapshot",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-2",
              tool_name: "browser_get_page_snapshot",
              arguments: { tab_id: 123 },
              execution_graph_execution_id: "graph-2",
              execution_graph_gate_node_id: "approval_gate:call-2",
              execution_graph_tool_node_id: "tool_call:call-2",
            },
          },
        ],
      },
    ]

    const resolution = await resolveAuthoritativeToolApproval({
      approval: {
        kind: "bridge_mcp",
        approval_token: "approval-1",
        tool_name: "browser_open_tab",
        arguments: { url: "https://x.com/home" },
        meta: {
          call_id: "call-1",
          message_id: "assistant-multi-approval",
        },
      },
      messages,
      sessionId: "session-1",
    })

    expect(resolution.approval).toMatchObject({
      approval_token: "approval-1",
      tool_name: "browser_open_tab",
      meta: {
        call_id: "call-1",
        message_id: "assistant-multi-approval",
        execution_graph_execution_id: "graph-1",
        execution_graph_gate_node_id: "approval_gate:call-1",
        execution_graph_tool_node_id: "tool_call:call-1",
      },
    })
    expect(resolution.executionMeta).toEqual({
      execution_graph_execution_id: "graph-1",
      execution_graph_gate_node_id: "approval_gate:call-1",
      execution_graph_tool_node_id: "tool_call:call-1",
    })
    expect(useBridgeApprovalStore.getState().pending).toMatchObject({
      approval_token: "approval-1",
    })
  })
})

describe("extractLocalChatApprovalResume", () => {
  it("preserves graph runtime identifiers from a resumed local chat payload", () => {
    expect(
      extractLocalChatApprovalResume({
        status: "LOCAL_CHAT_RESUMED",
        approval_token: "approval-1",
        resolved_gate_node_id: "approval_gate:call-1",
        resolved_call_id: "call-1",
        approved_tool_result: { ok: true },
        continuation_blocks: [{ id: "resume-1", type: "text", content: "done" }],
        execution_graph_execution_id: "graph-exec-1",
        pending_approval_gate_ids: [],
        next_pending_approval_tokens: [],
        execution_graph: {
          execution_id: "graph-exec-1",
          nodes: [],
        },
      })
    ).toMatchObject({
      status: "LOCAL_CHAT_RESUMED",
      approval_token: "approval-1",
      resolved_gate_node_id: "approval_gate:call-1",
      resolved_call_id: "call-1",
      approved_tool_result: { ok: true },
      continuation_blocks: [{ id: "resume-1", type: "text", content: "done" }],
      execution_graph_execution_id: "graph-exec-1",
      execution_graph: {
        execution_id: "graph-exec-1",
      },
    })
  })

  it("accepts waiting_approval local chat payloads so callers can refresh canonical approvals", () => {
    expect(
      extractLocalChatApprovalResume({
        status: "LOCAL_CHAT_WAITING_APPROVAL",
        approval_token: "approval-waiting-1",
        resolved_gate_node_id: "approval_gate:call-waiting-1",
        resolved_call_id: "call-waiting-1",
        approved_tool_result: { ok: true },
        continuation_blocks: [],
        execution_graph_execution_id: "graph-exec-waiting-1",
        pending_approval_gate_ids: ["approval_gate:call-next-1"],
        next_pending_approval_tokens: ["approval-next-1"],
      })
    ).toMatchObject({
      status: "LOCAL_CHAT_WAITING_APPROVAL",
      approval_token: "approval-waiting-1",
      resolved_gate_node_id: "approval_gate:call-waiting-1",
      resolved_call_id: "call-waiting-1",
      approved_tool_result: { ok: true },
      execution_graph_execution_id: "graph-exec-waiting-1",
      pending_approval_gate_ids: ["approval_gate:call-next-1"],
      next_pending_approval_tokens: ["approval-next-1"],
    })
  })

  it("does not treat a multi-approval handoff as a resume failure when the next approval is present", () => {
    expect(
      extractLocalChatApprovalResume({
        status: "LOCAL_CHAT_WAITING_APPROVAL",
        approval_token: "approval-current-1",
        resolved_gate_node_id: "approval_gate:call-current-1",
        resolved_call_id: "call-current-1",
        approved_tool_result: { ok: true },
        continuation_blocks: [],
        execution_graph_execution_id: "graph-exec-multi-approval-1",
        pending_approval_gate_ids: ["approval_gate:call-next-1"],
        next_pending_approval_tokens: ["approval-next-1"],
        execution_graph: {
          execution_id: "graph-exec-multi-approval-1",
          nodes: [
            {
              node_id: "approval_gate:call-current-1",
              status: "waiting_approval",
            },
            {
              node_id: "approval_gate:call-next-1",
              status: "waiting_approval",
            },
          ],
        },
      })
    ).toMatchObject({
      status: "LOCAL_CHAT_WAITING_APPROVAL",
      approval_token: "approval-current-1",
      resolved_gate_node_id: "approval_gate:call-current-1",
      resolved_call_id: "call-current-1",
      pending_approval_gate_ids: ["approval_gate:call-next-1"],
      next_pending_approval_tokens: ["approval-next-1"],
      error_code: undefined,
      error: undefined,
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

  it("unwraps nested tool_result envelopes before storing approved results", () => {
    expect(
      createApprovedToolResultBlock(
        {
          kind: "bridge_mcp",
          approval_token: "approval-1",
          tool_name: "firecrawl_scrape",
          arguments: {},
          meta: {
            call_id: "call-1",
          },
        },
        {
          type: "tool_result",
          callId: "call-1",
          toolName: "firecrawl_scrape",
          status: "success",
          result: {
            type: "tool_result",
            callId: "call-1",
            toolName: "firecrawl_scrape",
            status: "success",
            result: {
              structuredContent: {
                markdown: "# EvoMap",
              },
            },
          },
        }
      )
    ).toMatchObject({
      callId: "call-1",
      result: {
        structuredContent: {
          markdown: "# EvoMap",
        },
      },
    })
  })

  it("preserves post-approval resume status on approved results", () => {
    expect(
      createApprovedToolResultBlock(
        {
          kind: "bridge_mcp",
          approval_token: "approval-1",
          tool_name: "browser_click",
          arguments: {},
          meta: {
            call_id: "call-1",
          },
        },
        { ok: true },
        {
          local_chat_resume: {
            status: "LOCAL_CHAT_RESUME_FAILED",
            error_code: "APPROVAL_GRAPH_NOT_ADVANCED",
            retryable: true,
          },
        },
      )
    ).toMatchObject({
      callId: "call-1",
      status: "success",
      result: {
        ok: true,
        local_chat_resume: {
          status: "LOCAL_CHAT_RESUME_FAILED",
          error_code: "APPROVAL_GRAPH_NOT_ADVANCED",
          retryable: true,
        },
      },
    })
  })
})
