import {
  clearPendingRenderRefreshRequest,
  persistPendingRenderRefreshRequest,
  readPendingRenderRefreshRequest,
} from "@/lib/render-runtime/pending-refresh"

describe("pending render refresh request", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("persists and reads a pending refresh request", () => {
    persistPendingRenderRefreshRequest({
      sessionId: "session-1",
      refreshSpec: {
        kind: "chat_replay",
        input: { message: "refresh weather" },
      },
    })

    expect(readPendingRenderRefreshRequest()).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        refreshSpec: expect.objectContaining({ kind: "chat_replay" }),
      })
    )
  })

  it("clears pending refresh requests", () => {
    persistPendingRenderRefreshRequest({
      refreshSpec: { kind: "chat_replay" },
    })

    clearPendingRenderRefreshRequest()

    expect(readPendingRenderRefreshRequest()).toBeNull()
  })
})
