import {
  emitRenderChannelUpdate,
  subscribeRenderChannel,
} from "@/lib/render-runtime/channel"

describe("render runtime channel", () => {
  it("delivers updates only to matching channel subscribers", () => {
    const matching = jest.fn()
    const other = jest.fn()

    const unsubscribeMatching = subscribeRenderChannel("weather-feed", matching)
    const unsubscribeOther = subscribeRenderChannel("stock-feed", other)

    emitRenderChannelUpdate({
      channelId: "weather-feed",
      data: { temp_c: 22 },
      reason: "refresh",
    })

    expect(matching).toHaveBeenCalledTimes(1)
    expect(matching).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "weather-feed",
        data: { temp_c: 22 },
        reason: "refresh",
      })
    )
    expect(other).not.toHaveBeenCalled()

    unsubscribeMatching()
    unsubscribeOther()
  })
})
