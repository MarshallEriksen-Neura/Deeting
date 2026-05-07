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

  it("invalidates stale timers when the target text is replaced", () => {
    const { result, rerender } = renderHook(
      ({ text, enabled }) => useTypewriter(text, enabled),
      { initialProps: { text: "hello", enabled: true } }
    )

    act(() => {
      jest.advanceTimersByTime(20)
    })
    expect(result.current.displayed).toBe("h")

    rerender({ text: "world", enabled: true })
    expect(result.current.displayed).toBe("")

    act(() => {
      jest.advanceTimersByTime(100)
    })

    expect(result.current.displayed).toBe("world")
    expect(result.current.isAnimating).toBe(false)
  })

  it("cancels active timers when typing is disabled", () => {
    const { result, rerender } = renderHook(
      ({ text, enabled }) => useTypewriter(text, enabled),
      { initialProps: { text: "hello", enabled: true } }
    )

    act(() => {
      jest.advanceTimersByTime(20)
    })
    expect(result.current.displayed).toBe("h")

    rerender({ text: "hello world", enabled: false })
    expect(result.current.displayed).toBe("hello world")
    expect(result.current.isAnimating).toBe(false)

    act(() => {
      jest.advanceTimersByTime(1000)
    })

    expect(result.current.displayed).toBe("hello world")
    expect(result.current.isAnimating).toBe(false)
  })
})
