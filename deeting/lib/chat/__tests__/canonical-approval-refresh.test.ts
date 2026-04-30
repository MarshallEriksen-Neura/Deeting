import { refreshBridgePendingApprovalsFromCanonical } from "@/lib/chat/canonical-approval-refresh"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import { listPendingMcpApprovals } from "@/lib/api/mcp-approvals"
import type { Message } from "@/lib/chat/message-types"

jest.mock("@/lib/api/mcp-approvals", () => ({
  listPendingMcpApprovals: jest.fn(),
}))

const mockListPendingMcpApprovals =
  listPendingMcpApprovals as jest.MockedFunction<typeof listPendingMcpApprovals>

describe("refreshBridgePendingApprovalsFromCanonical", () => {
  beforeEach(() => {
    useBridgeApprovalStore.getState().clearAll()
    mockListPendingMcpApprovals.mockReset()
  })


  it("preserves a live graph-bound pending approval when canonical refresh momentarily returns empty", async () => {
    mockListPendingMcpApprovals.mockResolvedValueOnce([] as never)

    useBridgeApprovalStore.getState().setPending({
      kind: "bridge_mcp",
      approval_token: "approval-live-1",
      tool_name: "browser_get_page_snapshot",
      arguments: { tab_id: 123 },
      meta: {
        call_id: "call-live-1",
        execution_graph_execution_id: "graph-live-1",
        execution_graph_gate_node_id: "approval_gate:call-live-1",
      },
    })

    const result = await refreshBridgePendingApprovalsFromCanonical({
      sessionId: "session-live-1",
      messages: [],
      forceReplace: true,
    })

    expect(result.approvals).toHaveLength(1)
    expect(result.approvals[0]).toMatchObject({
      approval_token: "approval-live-1",
      tool_name: "browser_get_page_snapshot",
      meta: {
        execution_graph_execution_id: "graph-live-1",
        execution_graph_gate_node_id: "approval_gate:call-live-1",
      },
    })
    expect(useBridgeApprovalStore.getState().pending).toMatchObject({
      approval_token: "approval-live-1",
    })
  })

  it("keeps the preferred next approval even when it appears in exclusion lists", async () => {
    mockListPendingMcpApprovals.mockResolvedValueOnce([
      {
        status: "REQUIRES_APPROVAL",
        approval_token: "approval-next-1",
        tool_name: "firecrawl_browser_create",
        arguments: { ttl: 60 },
        session_id: "session-next-1",
        call_id: "call-next-1",
        execution_graph_execution_id: "graph-next-1",
        execution_graph_gate_node_id: "approval_gate:call-next-1",
      },
    ] as never)

    const messages: Message[] = [
      {
        id: "assistant-next-1",
        role: "assistant",
        content: "",
        createdAt: 1,
        blocks: [
          {
            id: "call-next-1",
            type: "tool_call",
            callId: "call-next-1",
            toolName: "firecrawl_browser_create",
            status: "running",
          },
          {
            id: "result-next-1",
            type: "tool_result",
            callId: "call-next-1",
            toolName: "firecrawl_browser_create",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-next-1",
              execution_graph_execution_id: "graph-next-1",
              execution_graph_gate_node_id: "approval_gate:call-next-1",
            },
          },
        ],
      },
    ]

    const result = await refreshBridgePendingApprovalsFromCanonical({
      sessionId: "session-next-1",
      messages,
      excludeApprovalTokens: ["approval-next-1"],
      excludeGateNodeIds: ["approval_gate:call-next-1"],
      preferredApprovalToken: "approval-next-1",
      forceReplace: true,
    })

    expect(result.approvals).toHaveLength(1)
    expect(result.approvals[0]).toMatchObject({
      approval_token: "approval-next-1",
      tool_name: "firecrawl_browser_create",
      meta: {
        call_id: "call-next-1",
        execution_graph_execution_id: "graph-next-1",
        execution_graph_gate_node_id: "approval_gate:call-next-1",
      },
    })
    expect(useBridgeApprovalStore.getState().pending).toMatchObject({
      approval_token: "approval-next-1",
    })
  })
})
