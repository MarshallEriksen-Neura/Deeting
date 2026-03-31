import {
  emitRenderRefreshRequest,
  subscribeRenderRefreshRequests,
} from "@/lib/render-runtime/refresh"

describe("render runtime refresh bus", () => {
  it("delivers refresh requests with refresh specs", () => {
    const listener = jest.fn()
    const unsubscribe = subscribeRenderRefreshRequests(listener)

    emitRenderRefreshRequest({
      refreshSpec: {
        kind: "chat_replay",
        input: {
          message: "refresh weather",
        },
      },
      messageId: "assistant-1",
      templateId: "manual://weather-card",
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "assistant-1",
        templateId: "manual://weather-card",
        refreshSpec: expect.objectContaining({
          kind: "chat_replay",
        }),
      })
    )

    unsubscribe()
  })
})
