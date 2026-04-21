import { act, renderHook } from "@testing-library/react"

import { useTypewriter } from "../use-typewriter"

describe("useTypewriter", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it("reveals short messages quickly for active assistant replies", () => {
    const { result } = renderHook(() => useTypewriter("hello", true))

    expect(result.current.displayed).toBe("")

    act(() => {
      jest.advanceTimersByTime(100)
    })

    expect(result.current.displayed).toBe("hello")
    expect(result.current.isAnimating).toBe(false)
  })

  it("renders the full text immediately when typing is disabled", () => {
    const { result } = renderHook(() => useTypewriter("hello", false))

    expect(result.current.displayed).toBe("hello")
    expect(result.current.isAnimating).toBe(false)
  })
})
