import { approveIslandTool, rejectIslandTool } from "@/lib/api/island"
import { rejectDesktopTool, streamDesktopApproveTool } from "@/lib/api/mcp-desktop"

jest.mock("@/lib/api/chat", () => ({
  streamChatCompletion: jest.fn(),
  streamDesktopLocalChatCompletion: jest.fn(),
}))

jest.mock("@/lib/api/mcp-desktop", () => ({
  streamDesktopApproveTool: jest.fn(),
  rejectDesktopTool: jest.fn(),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockApproveTool = streamDesktopApproveTool as jest.MockedFunction<
  typeof streamDesktopApproveTool
>
const mockRejectTool = rejectDesktopTool as jest.MockedFunction<typeof rejectDesktopTool>

describe("island approval api", () => {
  afterEach(() => {
    mockApproveTool.mockReset()
    mockRejectTool.mockReset()
  })

  it("reuses the desktop local gateway approval flow for island approvals", async () => {
    mockApproveTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_RESUMED",
      continuation_blocks: [
        { type: "text", content: "Done." },
      ],
    } as unknown)

    const result = await approveIslandTool("approval-1", "search_notes", "call-1")

    expect(mockApproveTool).toHaveBeenCalledWith({
      approvalToken: "approval-1",
      approvalMode: "allow_once",
      callId: "call-1",
    })
    expect(result).toEqual({
      tool_name: "search_notes",
      approved: true,
      follow_up_texts: ["Done."],
    })
  })

  it("reuses the desktop local gateway rejection flow for island rejection", async () => {
    mockRejectTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_REJECTED",
    } as never)

    const result = await rejectIslandTool("approval-2", "search_notes")

    expect(mockRejectTool).toHaveBeenCalledWith({
      approvalToken: "approval-2",
      rejectMode: "reject_once",
    })
    expect(result).toEqual({
      tool_name: "search_notes",
      approved: false,
      follow_up_texts: [],
    })
  })
})
