import React from "react"
import { render, screen } from "@testing-library/react"
import { MessageItem } from "@/components/chat/messages/message-item"

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
  } as any

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
