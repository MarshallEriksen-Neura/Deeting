import React from "react"
import { render, screen } from "@testing-library/react"
import { ChatContent } from "@/components/chat/core/chat-content"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import { useChatStore } from "@/store/chat-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

jest.mock("@/hooks/chat/use-chat-messaging-service", () => ({
  useChatMessagingService: () => ({
    regenerateMessage: jest.fn(),
    compareWithModel: jest.fn(),
    finalizeCompareWinner: jest.fn(),
  }),
}))

describe("ChatContent", () => {
  beforeEach(() => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()
    useBridgeApprovalStore.getState().clear()
  })

  it("renders the tool approval dialog when a bridge approval is pending", () => {
    useBridgeApprovalStore.getState().setPending({
      kind: "bridge_mcp",
      approval_token: "approval-local-1",
      tool_name: "skill.official.skills.crawler.fetch_web_content",
      arguments: { url: "https://x.com/OpenAI" },
      meta: {
        call_id: "call-1",
      },
    })

    render(<ChatContent />)

    expect(screen.getByText("Security Confirmation")).toBeInTheDocument()
    expect(
      screen.getByText("skill.official.skills.crawler.fetch_web_content")
    ).toBeInTheDocument()
  })
})
