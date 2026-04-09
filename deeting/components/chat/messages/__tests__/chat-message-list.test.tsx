import { render } from "@testing-library/react"
import { ChatMessageList } from "@/components/chat/messages/chat-message-list"

const messageItemSpy = jest.fn()

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/components/chat/messages/message-item", () => ({
  MessageItem: (props: unknown) => {
    messageItemSpy(props)
    return null
  },
}))

jest.mock("@/components/chat/messages/ai-response-bubble", () => ({
  AIResponseBubble: () => null,
}))

describe("ChatMessageList", () => {
  beforeEach(() => {
    messageItemSpy.mockReset()
    Element.prototype.scrollIntoView = jest.fn()
  })

  it("applies the live global status only to the message that owns it", () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: "assistant-live-1",
            role: "assistant",
            content: "",
            createdAt: 1,
            blocks: [],
          },
          {
            id: "assistant-last-2",
            role: "assistant",
            content: "",
            createdAt: 2,
            blocks: [],
          },
        ]}
        isTyping
        statusMessageId="assistant-live-1"
        streamEnabled
        statusStage="render"
        statusCode="approval.required"
        statusMeta={{ tool_name: "search_notes" }}
      />
    )

    const firstCall = messageItemSpy.mock.calls.find(
      ([props]) => (props as any)?.message?.id === "assistant-live-1"
    )?.[0]
    const secondCall = messageItemSpy.mock.calls.find(
      ([props]) => (props as any)?.message?.id === "assistant-last-2"
    )?.[0]

    expect(firstCall).toMatchObject({
      isActive: true,
      statusStage: "render",
      statusCode: "approval.required",
      statusMeta: { tool_name: "search_notes" },
    })
    expect(secondCall).toMatchObject({
      isActive: false,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
    })
  })
})
