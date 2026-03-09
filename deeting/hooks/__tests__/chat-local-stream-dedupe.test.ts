import {
  filterIncomingStructuredBlocks,
  shouldAppendFinalResponseBlocks,
} from "@/hooks/chat/use-chat-messaging-service"
import type { MessageBlock } from "@/lib/chat/message-protocol"

describe("local chat stream dedupe helpers", () => {
  it("drops duplicate terminal text blocks after streamed local text", () => {
    const incoming = [
      { type: "text", content: "早上好" },
      { type: "tool_result", toolName: "clock", status: "success", result: { ok: true } },
    ] as MessageBlock[]

    expect(
      filterIncomingStructuredBlocks({
        currentBlocks: [{ type: "text", content: "早上好" } as MessageBlock],
        incomingBlocks: incoming,
        preferLocalRoute: true,
        isStreaming: true,
      })
    ).toEqual([
      { type: "tool_result", toolName: "clock", status: "success", result: { ok: true } },
    ])
  })

  it("skips final response blocks after local blocks events were already consumed", () => {
    expect(
      shouldAppendFinalResponseBlocks({
        currentBlocks: [{ type: "text", content: "早上好" } as MessageBlock],
        responseBlocks: [{ type: "text", content: "早上好" } as MessageBlock],
        receivedStructuredBlocks: true,
      })
    ).toBe(false)
  })
})
