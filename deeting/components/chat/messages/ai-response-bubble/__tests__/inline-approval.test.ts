import { runInlineRejection } from "@/components/chat/messages/ai-response-bubble/inline-approval"
import { rejectDesktopTool } from "@/lib/api/mcp-desktop"
import { useChatStore } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"

jest.mock("@/lib/api/mcp-desktop", () => ({
  rejectDesktopTool: jest.fn(),
  streamDesktopApproveTool: jest.fn(),
}))

jest.mock("@/lib/api/bridge", () => ({
  bridgeCallTool: jest.fn(),
}))

jest.mock("@/lib/chat/canonical-approval-refresh", () => ({
  refreshBridgePendingApprovalsFromCanonical: jest.fn(),
}))

const mockRejectDesktopTool = rejectDesktopTool as jest.MockedFunction<typeof rejectDesktopTool>

describe("inline approval runtime status sync", () => {
  beforeEach(() => {
    mockRejectDesktopTool.mockReset()
    mockRejectDesktopTool.mockResolvedValue({ success: true } as any)
    useChatRuntimeStore.getState().resetSession()
    useChatStore.setState({
      messages: [
        {
          id: "assistant-inline-reject-1",
          role: "assistant",
          content: "",
          createdAt: 1,
          blocks: [
            {
              id: "call-inline-reject-1",
              type: "tool_call",
              callId: "call-inline-reject-1",
              toolName: "firecrawl_browser_create",
              status: "requires_approval",
            },
            {
              id: "result-inline-reject-1",
              type: "tool_result",
              callId: "call-inline-reject-1",
              toolName: "firecrawl_browser_create",
              status: "requires_approval",
              result: {
                status: "REQUIRES_APPROVAL",
                approval_token: "approval-inline-reject-1",
              },
            },
          ],
        },
      ],
    })
    useChatRuntimeStore.setState({
      activeMessageId: "assistant-inline-reject-1",
      statusMessageId: "assistant-inline-reject-1",
      statusStage: "render",
      statusCode: "approval.required",
      statusMeta: { tool_name: "firecrawl_browser_create", call_id: "call-inline-reject-1" },
    })
  })

  it("clears active runtime approval status after inline rejection resolves the message", async () => {
    await runInlineRejection({
      approval: {
        kind: "bridge_mcp",
        approval_token: "approval-inline-reject-1",
        tool_name: "firecrawl_browser_create",
        arguments: {},
        meta: {
          call_id: "call-inline-reject-1",
          message_id: "assistant-inline-reject-1",
        },
      },
      messageId: "assistant-inline-reject-1",
      rejectLabel: "User rejected tool execution",
      removePendingByToken: jest.fn(),
      upsertMessageToolResult: (messageId, block) => {
        useChatStore.getState().upsertMessageToolResult(messageId, block)
      },
    })

    const runtime = useChatRuntimeStore.getState()
    expect(runtime.activeMessageId).toBeNull()
    expect(runtime.statusMessageId).toBeNull()
    expect(runtime.statusStage).toBeNull()
    expect(runtime.statusCode).toBeNull()

    const message = useChatStore.getState().messages[0]
    expect(message?.blocks?.[0]).toMatchObject({
      callId: "call-inline-reject-1",
      status: "error",
    })
    expect(message?.blocks?.[1]).toMatchObject({
      callId: "call-inline-reject-1",
      status: "error",
    })
  })
})
