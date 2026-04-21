import {
  buildStatusRepeatKey,
  shouldEmitStatusRepeat,
} from "@/hooks/chat/use-chat-messaging-service"

describe("chat status repeat helpers", () => {
  it("builds stable status keys from stage and code", () => {
    expect(buildStatusRepeatKey("listen", "upstream.streaming")).toBe(
      "listen::upstream.streaming"
    )
    expect(buildStatusRepeatKey(null, "upstream.streaming")).toBe(
      "unknown_stage::upstream.streaming"
    )
    expect(buildStatusRepeatKey("listen", null)).toBe("listen::unknown_code")
  })

  it("emits less frequently for repeated status events", () => {
    const emitted = Array.from({ length: 15 }, (_, idx) => idx + 1).filter((count) =>
      shouldEmitStatusRepeat(count)
    )

    expect(emitted).toEqual([1, 2, 3, 4, 6, 8, 10, 15])
  })
})
