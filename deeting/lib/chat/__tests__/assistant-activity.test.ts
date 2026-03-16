import { deriveAssistantActivityState, isToolApprovalResultBlock } from "@/lib/chat/assistant-activity"
import type { MessageBlock } from "@/lib/chat/message-protocol"

describe("assistant activity helpers", () => {
  it("keeps approval-request blocks active until the user approves them", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-approval-1",
        type: "tool_call",
        callId: "call-approval-1",
        toolName: "skill.official.skills.crawler.fetch_web_content",
        status: "success",
      },
      {
        id: "result-approval-1",
        type: "tool_result",
        callId: "call-approval-1",
        toolName: "skill.official.skills.crawler.fetch_web_content",
        status: "requires_approval",
        result: {
          status: "REQUIRES_APPROVAL",
          approval_token: "approval-1",
        },
      },
    ]

    expect(isToolApprovalResultBlock(blocks[1])).toBe(true)
    expect(deriveAssistantActivityState(blocks)).toMatchObject({
      isActive: true,
      statusStage: "render",
      statusCode: "approval.required",
      statusMeta: {
        tool_name: "skill.official.skills.crawler.fetch_web_content",
        call_id: "call-approval-1",
      },
    })
  })

  it("keeps an approved tool call active while it is still running", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-running-1",
        type: "tool_call",
        callId: "call-running-1",
        toolName: "write_file",
        status: "running",
      },
    ]

    expect(deriveAssistantActivityState(blocks)).toMatchObject({
      isActive: true,
      statusStage: "render",
      statusCode: "approval.executing",
      statusMeta: {
        tool_name: "write_file",
        call_id: "call-running-1",
      },
    })
  })

  it("treats resolved tool results as inactive", () => {
    const blocks: MessageBlock[] = [
      {
        id: "call-success-1",
        type: "tool_call",
        callId: "call-success-1",
        toolName: "write_file",
        status: "success",
      },
      {
        id: "result-success-1",
        type: "tool_result",
        callId: "call-success-1",
        toolName: "write_file",
        status: "success",
        result: { ok: true },
      },
    ]

    expect(deriveAssistantActivityState(blocks)).toEqual({
      isActive: false,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    })
  })
})
