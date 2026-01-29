import { renderHook } from "@testing-library/react"
import { useChatStateStore } from "../chat-state-store"
import { useChatStore } from "../chat-store"

describe("useChatStateStore selector support", () => {
  beforeEach(() => {
    useChatStore.getState().resetSession()
  })

  it("should return selected value when selector is provided", () => {
    useChatStore.getState().switchAgent("agent-1", null)

    const { result } = renderHook(() =>
      useChatStateStore((state) => state.activeAssistantId)
    )

    expect(result.current).toBe("agent-1")
  })
})
