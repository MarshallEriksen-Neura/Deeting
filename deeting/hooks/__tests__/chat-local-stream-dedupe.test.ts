import {
  extractAssistantResponseToolBlocks,
  extractAssistantResponseBlocks,
  filterFinalResponseBlocks,
  filterIncomingStructuredBlocks,
  shouldAppendFinalResponseBlocks,
} from "@/hooks/chat/use-chat-messaging-service"
import type { MessageBlock } from "@/lib/chat/message-protocol"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

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

  it("keeps final terminal text after streamed local tool blocks", () => {
    expect(
      shouldAppendFinalResponseBlocks({
        currentBlocks: [
          {
            type: "tool_result",
            toolName: "search_sdk",
            status: "success",
            result: { ok: true },
          } as MessageBlock,
        ],
        responseBlocks: [{ type: "text", content: "final answer" } as MessageBlock],
        receivedStructuredBlocks: true,
      })
    ).toBe(true)
  })

  it("keeps final terminal thought blocks not already streamed", () => {
    expect(
      shouldAppendFinalResponseBlocks({
        currentBlocks: [
          {
            type: "tool_result",
            toolName: "search_sdk",
            status: "success",
            result: { ok: true },
          } as MessageBlock,
        ],
        responseBlocks: [
          { type: "thought", content: "provider returned reasoning only" } as MessageBlock,
        ],
        receivedStructuredBlocks: true,
      })
    ).toBe(true)
  })

  it("keeps terminal thought while dropping duplicate text after streamed local text", () => {
    expect(
      filterFinalResponseBlocks({
        currentBlocks: [{ type: "text", content: "final answer" } as MessageBlock],
        responseBlocks: [
          { type: "thought", content: "provider reasoning" } as MessageBlock,
          { type: "text", content: "final answer" } as MessageBlock,
        ],
        receivedStructuredBlocks: true,
      })
    ).toEqual([
      { type: "thought", content: "provider reasoning" },
    ])
  })

  it("drops repeated final text blocks while preserving late narrative blocks", () => {
    expect(
      filterFinalResponseBlocks({
        currentBlocks: [{ type: "text", content: "final answer" } as MessageBlock],
        responseBlocks: [
          { type: "thought", content: "provider reasoning" } as MessageBlock,
          { type: "text", content: "final answer" } as MessageBlock,
          { type: "text", content: "final answer" } as MessageBlock,
        ],
        receivedStructuredBlocks: true,
      })
    ).toEqual([
      { type: "thought", content: "provider reasoning" },
    ])
  })

  it("keeps late terminal thought after a streamed final answer", () => {
    expect(
      filterFinalResponseBlocks({
        currentBlocks: [{ type: "text", content: "final answer" } as MessageBlock],
        responseBlocks: [
          { type: "thought", content: "provider reasoning" } as MessageBlock,
        ],
        receivedStructuredBlocks: true,
      })
    ).toEqual([
      { type: "thought", content: "provider reasoning" },
    ])
  })

  it("ignores runtime-internal blocks from final meta blocks", () => {
    expect(
      extractAssistantResponseBlocks({
        choices: [
          {
            message: {
              content: "final answer",
              meta_info: {
                blocks: [
                  { type: "thought", content: "provider reasoning" },
                  {
                    type: "runtime_transition_decision",
                    payload: {
                      decision_id: "runtime-transition:final-answer:demo",
                    },
                  },
                  { type: "text", content: "final answer" },
                ],
              },
            },
          },
        ],
      })
    ).toEqual([
      { type: "thought", content: "provider reasoning" },
      { type: "text", content: "final answer" },
    ])
  })

  it("orders terminal meta narrative before final content", () => {
    expect(
      extractAssistantResponseBlocks({
        choices: [
          {
            message: {
              content: "final answer",
              meta_info: {
                blocks: [
                  { type: "text", content: "final answer" },
                  { type: "thought", content: "provider reasoning" },
                ],
              },
            },
          },
        ],
      })
    ).toEqual([
      { type: "thought", content: "provider reasoning" },
      { type: "text", content: "final answer" },
    ])
  })

  it("keeps final tool status blocks from completion payload for stream cleanup", () => {
    expect(
      extractAssistantResponseToolBlocks({
        choices: [
          {
            message: {
              content: "",
              meta_info: {
                blocks: [
                  {
                    type: "tool_call",
                    callId: "call-fetch-1",
                    toolName: "skill.official.skills.crawler.fetch_web_content",
                    status: "error",
                  },
                ],
              },
            },
          },
        ],
      })
    ).toEqual([
      {
        type: "tool_call",
        callId: "call-fetch-1",
        toolName: "skill.official.skills.crawler.fetch_web_content",
        status: "error",
      },
    ])
  })
})
