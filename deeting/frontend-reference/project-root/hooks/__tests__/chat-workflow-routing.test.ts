import type { MessageBlock } from "@/lib/chat/message-protocol"
import { extractWorkflowRunIdFromBlocks } from "@/hooks/chat/use-chat-messaging-service"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (_key: string) => "chat",
}))

describe("extractWorkflowRunIdFromBlocks", () => {
  it("returns the workflow run id from a delegated workflow tool result", () => {
    const blocks: MessageBlock[] = [
      {
        id: "tool-result-1",
        type: "tool_result",
        callId: "call-1",
        toolName: "workflow/example",
        status: "success",
        result: {
          status: "completed",
          workflow_run_id: "run-123",
        },
      },
    ]

    expect(extractWorkflowRunIdFromBlocks(blocks)).toBe("run-123")
  })

  it("falls back to ui block metadata when present", () => {
    const blocks: MessageBlock[] = [
      {
        id: "ui-1",
        type: "ui",
        viewType: "workflow.summary",
        payload: {},
        metadata: {
          workflow_run_id: "run-456",
        },
      },
    ]

    expect(extractWorkflowRunIdFromBlocks(blocks)).toBe("run-456")
  })

  it("reads the workflow run id from delegated execution lifecycle metadata", () => {
    const blocks: MessageBlock[] = [
      {
        id: "ui-exec-1",
        type: "ui",
        viewType: "execution.lifecycle",
        payload: {
          execution_id: "exec-1",
        },
        metadata: {
          workflow_run_id: "run-789",
        },
      },
    ]

    expect(extractWorkflowRunIdFromBlocks(blocks)).toBe("run-789")
  })

  it("ignores blocks without a usable workflow run id", () => {
    const blocks: MessageBlock[] = [
      {
        id: "tool-result-2",
        type: "tool_result",
        callId: "call-2",
        toolName: "workflow/example",
        status: "success",
        result: {
          workflow_run_id: "   ",
        },
      },
    ]

    expect(extractWorkflowRunIdFromBlocks(blocks)).toBeNull()
  })
})
