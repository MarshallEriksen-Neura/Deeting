import {
  filterIncomingStructuredBlocks,
  shouldAppendFinalResponseBlocks,
} from "@/hooks/chat/use-chat-messaging-service"

describe("shouldAppendFinalResponseBlocks", () => {
  it("skips final blocks when structured blocks already streamed", () => {
    const responseBlocks = [{ type: "text", content: "早上好" }] as any[]

    expect(
      shouldAppendFinalResponseBlocks({
        currentBlocks: responseBlocks as any,
        responseBlocks: responseBlocks as any,
        receivedStructuredBlocks: true,
      })
    ).toBe(false)
  })

  it("skips final text-only blocks when deltas already formed the same text", () => {
    expect(
      shouldAppendFinalResponseBlocks({
        currentBlocks: [{ type: "text", content: "早上好！今天是周一。" }] as any,
        responseBlocks: [{ type: "text", content: "早上好！今天是周一。" }] as any,
        receivedStructuredBlocks: false,
      })
    ).toBe(false)
  })

  it("keeps final blocks when they add new non-text structure", () => {
    expect(
      shouldAppendFinalResponseBlocks({
        currentBlocks: [{ type: "text", content: "已完成" }] as any,
        responseBlocks: [
          { type: "text", content: "已完成" },
          { type: "tool_result", toolName: "search_web", status: "success", result: "ok" },
        ] as any,
        receivedStructuredBlocks: false,
      })
    ).toBe(true)
  })

  it("drops local streamed text blocks when the same text already arrived via delta", () => {
    expect(
      filterIncomingStructuredBlocks({
        currentBlocks: [{ type: "text", content: "早上好！今天是周一。" }] as any,
        incomingBlocks: [
          { type: "text", content: "早上好！今天是周一。" },
          { type: "tool_result", toolName: "search_web", status: "success", result: "ok" },
        ] as any,
        preferLocalRoute: true,
        isStreaming: true,
      })
    ).toEqual([
      { type: "tool_result", toolName: "search_web", status: "success", result: "ok" },
    ])
  })
})
