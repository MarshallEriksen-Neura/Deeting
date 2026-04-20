import React from "react"
import { render, screen } from "@testing-library/react"
import { MessageItem } from "@/components/chat/messages/message-item"

type MessageRecord = React.ComponentProps<typeof MessageItem>["message"]

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => () => null,
}))

jest.mock("@/components/chat/messages/ai-response-bubble", () => ({
  AIResponseBubble: () => <div data-testid="ai-response-bubble" />,
}))

jest.mock("@/components/chat/messages/compare-response-shell", () => ({
  CompareResponseShell: () => null,
}))

jest.mock("@/components/chat/messages/message-actions", () => ({
  MessageActions: () => <div data-testid="message-actions" />,
}))

jest.mock("@/components/chat/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}))

jest.mock("@/components/ui/image-lightbox", () => ({
  ImageLightbox: () => null,
}))

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string, values?: { value?: string }) =>
    values?.value ? `${key}:${values.value}` : key,
}))

jest.mock("@/hooks/chat/use-message-tool-approval", () => ({
  useMessageToolApproval: () => undefined,
}))

jest.mock("@/store/chat-store", () => ({
  useChatStore: (selector: (state: { compareByMessageId: Record<string, unknown>; models: unknown[] }) => unknown) =>
    selector({
      compareByMessageId: {},
      models: [],
    }),
}))

describe("MessageItem runtime metrics visibility", () => {
  const assistantMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "Need approval",
    createdAt: "2026-03-28T12:00:00.000Z",
    fromHistory: false,
    attachments: [],
    blocks: [],
    metaInfo: {
      runtime_metrics: {
        total_latency_ms: 2400,
        upstream_latency_ms: 1700,
        orchestrator_latency_ms: 700,
      },
    },
  } as MessageRecord

  it("hides runtime metrics while the assistant message is still active for approval", () => {
    const { rerender } = render(
      <MessageItem
        message={assistantMessage}
        isActive
        statusCode="approval.required"
        statusStage="render"
        statusMeta={{ tool_name: "write_file" }}
        lastAssistantId="assistant-1"
      />
    )

    expect(screen.queryByText(/status\.metrics\.total:2\.40s/)).not.toBeInTheDocument()
    expect(screen.queryByText(/status\.metrics\.upstream:1\.70s/)).not.toBeInTheDocument()
    expect(screen.queryByText(/status\.metrics\.local:700ms/)).not.toBeInTheDocument()

    rerender(
      <MessageItem
        message={assistantMessage}
        isActive={false}
        lastAssistantId="assistant-1"
      />
    )

    expect(screen.getByText(/status\.metrics\.total:2\.40s/)).toBeInTheDocument()
    expect(screen.getByText(/status\.metrics\.upstream:1\.70s/)).toBeInTheDocument()
    expect(screen.getByText(/status\.metrics\.local:700ms/)).toBeInTheDocument()
  })
})

describe("MessageItem user bubble layout", () => {
  it("renders the user timestamp outside the capsule bubble", () => {
    const userMessage = {
      id: "user-1",
      role: "user",
      content: "Hi! Can you tell me about the new iOS 26 features?",
      createdAt: "2026-04-04T14:31:00.000Z",
      fromHistory: false,
      attachments: [],
      blocks: [],
      metaInfo: {},
    } as MessageRecord

    render(<MessageItem message={userMessage} />)

    const bubble = screen.getByText(userMessage.content).closest(".chat-user-bubble")
    expect(bubble).not.toBeNull()

    const timestamp = screen.getByText(
      new Date(userMessage.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    )

    expect(timestamp).toHaveClass("chat-user-bubble-meta")
    expect(bubble).not.toContainElement(timestamp)
  })

  it("renders a page-context badge for user messages that used browser context", () => {
    const userMessage = {
      id: "user-2",
      role: "user",
      content: "Explain the key point on this page.",
      createdAt: "2026-04-15T08:31:00.000Z",
      fromHistory: false,
      attachments: [],
      blocks: [],
      metaInfo: {
        page_context: {
          title: "MIT 18.06 Linear Algebra Notes",
          url: "https://linalg.apachecn.org/chapter01/",
          host: "linalg.apachecn.org",
        },
      },
    } as MessageRecord

    render(<MessageItem message={userMessage} />)

    expect(
      screen.getByText("controls.pageContextUsed:MIT 18.06 Linear Algebra Notes")
    ).toBeInTheDocument()
  })
})
