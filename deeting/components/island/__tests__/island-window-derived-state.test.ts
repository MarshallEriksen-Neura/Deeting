import { buildIslandWindowDerivedState } from "../island-window-derived-state"

describe("buildIslandWindowDerivedState", () => {
  it("does not surface a resolved historical approval as the current island pending approval", () => {
    const derived = buildIslandWindowDerivedState({
      messages: [
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
            {
              id: "text-1",
              type: "text",
              content: "已经执行完成",
            },
          ],
        },
      ],
      pendingApprovalSource: null,
      isLoading: false,
      globalLoading: false,
      statusCode: null,
      errorMessage: null,
    })

    expect(derived.pendingApproval).toBeNull()
    expect(derived.statusLabel).toBe("Ready")
    expect(derived.lastReplyText).toBe("已经执行完成")
  })
  it("does not fall back to legacy assistant content when blocks are absent", () => {
    const derived = buildIslandWindowDerivedState({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: 1,
        },
        {
          id: "assistant-legacy-only",
          role: "assistant",
          content: "Legacy answer only",
          createdAt: 2,
          blocks: [],
        },
      ],
      pendingApprovalSource: null,
      isLoading: false,
      globalLoading: false,
      statusCode: null,
      errorMessage: null,
    })

    expect(derived.lastReplyText).toBe("No replies yet.")
    expect(
      derived.recentMessages.some((message) => message.content === "Legacy answer only")
    ).toBe(false)
  })

  it("surfaces island pending approval from canonical approval store input", () => {
    const derived = buildIslandWindowDerivedState({
      messages: [],
      pendingApprovalSource: {
        kind: "bridge_mcp",
        approval_token: "approval-canonical-1",
        tool_name: "shell_execute",
        arguments: {},
        description: "Run the migration script.",
        meta: {
          call_id: "call-canonical-1",
        },
      },
      isLoading: false,
      globalLoading: false,
      statusCode: null,
      errorMessage: null,
    })

    expect(derived.pendingApproval).toMatchObject({
      approvalToken: "approval-canonical-1",
      toolName: "shell_execute",
      callId: "call-canonical-1",
    })
    expect(derived.statusLabel).toBe("Pending approval")
  })
})
