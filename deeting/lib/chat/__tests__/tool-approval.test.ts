import { findLatestUnresolvedToolApproval } from "@/lib/chat/tool-approval"
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
      },
    })
  })
})
