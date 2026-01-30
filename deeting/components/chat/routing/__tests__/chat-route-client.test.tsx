import React from "react"
import { render } from "@testing-library/react"
import { ChatRouteClientMemo } from "@/components/chat/routing/chat-route-client"

jest.mock("next/navigation", () => ({
  useParams: () => ({ agentId: "agent-1" }),
  useSearchParams: () => new URLSearchParams("agentId=agent-2"),
  useRouter: () => ({ replace: jest.fn() }),
}))

jest.mock("@/components/chat/core", () => ({
  ChatContainer: ({ agentId }: { agentId: string }) => (
    <div data-testid="chat-container" data-agent-id={agentId} />
  ),
}))

describe("ChatRouteClient (web)", () => {
  it("should ignore agentId and keep /chat on web", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    const { getByTestId } = render(<ChatRouteClientMemo />)
    expect(getByTestId("chat-container").getAttribute("data-agent-id")).toBe("")
  })
})
