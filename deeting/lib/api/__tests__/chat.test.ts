import { extractStreamDeltaContent } from "@/lib/api/chat"

describe("chat SSE helpers", () => {
  it("only treats chunk deltas as streaming text", () => {
    expect(
      extractStreamDeltaContent({
        choices: [{ delta: { content: "你好" } }],
      })
    ).toBe("你好")
  })

  it("does not treat final message content as a delta", () => {
    expect(
      extractStreamDeltaContent({
        choices: [{ message: { content: "早上好" } }],
      })
    ).toBe("")
  })
})
