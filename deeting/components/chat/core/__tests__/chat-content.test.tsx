import { render, screen } from "@testing-library/react"
import { ChatContent } from "@/components/chat/core/chat-content"
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

jest.mock("@/components/chat/messages", () => ({
  ChatMessageList: () => <div data-testid="chat-message-list" />,
}))

jest.mock("@/components/bridge/tool-approval-dialog", () => ({
  ToolApprovalDialog: () => <div data-testid="tool-approval-dialog" />,
}))

describe("ChatContent", () => {
  beforeEach(() => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()
  })

  it("renders the chat message list", () => {
    render(<ChatContent />)

    expect(screen.getByTestId("chat-message-list")).toBeInTheDocument()
  })

  it("mounts the tool approval dialog host", () => {
    render(<ChatContent />)

    expect(screen.getByTestId("tool-approval-dialog")).toBeInTheDocument()
  })
})
