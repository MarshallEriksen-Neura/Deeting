import {
  createBridgeToolApproval,
  deriveApprovalDescription,
} from "@/lib/chat/tool-approval"

describe("browser tool approval presentation", () => {
  it("derives a human-readable description for browser_open_tab", () => {
    expect(
      deriveApprovalDescription("browser_open_tab", {
        url: "https://example.com/docs",
      })
    ).toBe('Open a new browser tab to "https://example.com/docs".')
  })

  it("derives a human-readable description for browser_click", () => {
    expect(
      deriveApprovalDescription("browser_click", {
        tab_id: 42,
        target: { text: "Continue" },
      })
    ).toBe('Click the "Continue" element in the browser.')
  })

  it("derives a human-readable description for browser_type", () => {
    expect(
      deriveApprovalDescription("browser_type", {
        tab_id: 42,
        target: { selector: "input[name='email']" },
        text: "me@example.com",
      })
    ).toBe('Type "me@example.com" into the element matching selector "input[name=\'email\']".')
  })

  it("uses a generated description when browser approvals are created without one", () => {
    const approval = createBridgeToolApproval({
      approval_token: "approval-browser-1",
      tool_name: "browser_click",
      arguments: {
        target: { text: "Continue" },
      },
      meta: {
        call_id: "call-browser-1",
      },
    })

    expect(approval.description).toBe('Click the "Continue" element in the browser.')
  })

  it("preserves an explicit description when one is already provided", () => {
    const approval = createBridgeToolApproval({
      approval_token: "approval-browser-2",
      tool_name: "browser_click",
      description: "Use the browser to continue checkout",
      arguments: {
        target: { text: "Continue" },
      },
      meta: {
        call_id: "call-browser-2",
      },
    })

    expect(approval.description).toBe("Use the browser to continue checkout")
  })
})
