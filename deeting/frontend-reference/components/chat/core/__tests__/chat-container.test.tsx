import React from "react"
import { render, screen } from "@testing-library/react"
import { ChatContainer } from "@/components/chat/core/chat-container"

const mockInitSession = jest.fn()
const mockUseChatStore = jest.fn()

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("session=session-1"),
}))

jest.mock("@/store/chat-store", () => ({
  useChatStore: ((selector: (state: Record<string, unknown>) => unknown) =>
    mockUseChatStore(selector)) as typeof import("@/store/chat-store").useChatStore,
}))

jest.mock("@/lib/runtime/tauri", () => ({
  isTauriRuntime: () => false,
}))

jest.mock("@/components/chat/core/chat-layout", () => ({
  ChatLayout: ({
    children,
    isLoadingAssistants,
  }: {
    children: React.ReactNode
    isLoadingAssistants?: boolean
  }) => (
    <div data-testid="chat-layout" data-loading={String(Boolean(isLoadingAssistants))}>
      {children}
    </div>
  ),
}))

jest.mock("@/components/chat/core/chat-content", () => ({
  ChatContent: () => <div data-testid="chat-content" />,
}))

jest.mock("@/components/chat/core/chat-error-boundary", () => ({
  ChatErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("ChatContainer", () => {
  beforeEach(() => {
    mockInitSession.mockReset()
    mockUseChatStore.mockReset()
  })

  it("keeps the chat shell visible while session history is loading", () => {
    mockUseChatStore.mockImplementation((selector) =>
      selector({
        initSession: mockInitSession,
        isLoading: true,
        initialized: true,
      })
    )

    render(<ChatContainer agentId="" />)

    expect(screen.getByTestId("chat-layout")).toHaveAttribute("data-loading", "false")
    expect(screen.getByTestId("chat-content")).toBeInTheDocument()
  })
})
