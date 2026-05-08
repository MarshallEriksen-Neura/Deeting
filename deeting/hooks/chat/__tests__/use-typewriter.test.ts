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
      jest.advanceTimersByTime(20)
    })

    expect(result.current.displayed.length).toBeGreaterThan(0)

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
    expect(result.current.displayed.length).toBeGreaterThan(0)

    rerender({ text: "world", enabled: true })

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
    expect(result.current.displayed.length).toBeGreaterThan(0)

    rerender({ text: "hello world", enabled: false })
    expect(result.current.displayed).toBe("hello world")
    expect(result.current.isAnimating).toBe(false)

    act(() => {
      jest.advanceTimersByTime(1000)
    })

    expect(result.current.displayed).toBe("hello world")
    expect(result.current.isAnimating).toBe(false)
  })

  it("flushes streaming text in larger batches to avoid slow per-character playback", () => {
    const longText =
      "Streaming output should reveal in quick phrase-sized batches instead of one character at a time."

    const { result } = renderHook(() =>
      useTypewriter(longText, {
        enabled: true,
        mode: "streaming",
        sourceKey: "assistant-1",
      })
    )

    expect(result.current.displayed).toBe("")

    act(() => {
      jest.advanceTimersByTime(34)
    })

    expect(result.current.displayed.length).toBeGreaterThanOrEqual(20)
    expect(result.current.displayed.length).toBeLessThan(longText.length)

    act(() => {
      jest.advanceTimersByTime(200)
    })

    expect(result.current.displayed).toBe(longText)
    expect(result.current.isAnimating).toBe(false)
  })
})
