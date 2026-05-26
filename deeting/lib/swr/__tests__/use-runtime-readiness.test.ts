import {
  FRAME_ROUTE_OVERLAP_READINESS_WINDOW_MS,
  getFrameRouteOverlapReadinessKey,
  getFrameRouteOverlapReadinessWindow,
  isFrameRouteOverlapReadinessQueryValid,
  isFrameRouteOverlapReadinessRuntime,
} from "@/lib/swr/use-runtime-readiness"

const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("runtime readiness swr helpers", () => {
  const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI

  afterEach(() => {
    if (originalTauriFlag === undefined) {
      delete process.env.NEXT_PUBLIC_IS_TAURI
    } else {
      process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    }
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("builds the default 14 day readiness window", () => {
    const nowUnixMs = 1_800_000_000_000

    expect(getFrameRouteOverlapReadinessWindow(nowUnixMs)).toEqual({
      windowStartUnixMs: nowUnixMs - FRAME_ROUTE_OVERLAP_READINESS_WINDOW_MS,
      windowEndUnixMs: nowUnixMs,
    })
  })

  it("clamps the default readiness window to non-negative unix ms bounds", () => {
    expect(getFrameRouteOverlapReadinessWindow(1000)).toEqual({
      windowStartUnixMs: 0,
      windowEndUnixMs: 1000,
    })
    expect(getFrameRouteOverlapReadinessWindow(-1000)).toEqual({
      windowStartUnixMs: 0,
      windowEndUnixMs: 0,
    })
  })

  it("normalizes the default readiness window to safe integer bounds", () => {
    expect(getFrameRouteOverlapReadinessWindow(1000.75)).toEqual({
      windowStartUnixMs: 0,
      windowEndUnixMs: 1000,
    })
    expect(getFrameRouteOverlapReadinessWindow(Number.POSITIVE_INFINITY)).toEqual({
      windowStartUnixMs: 0,
      windowEndUnixMs: 0,
    })
    expect(
      getFrameRouteOverlapReadinessWindow(Number.MAX_SAFE_INTEGER + 1000)
    ).toEqual({
      windowStartUnixMs:
        Number.MAX_SAFE_INTEGER - FRAME_ROUTE_OVERLAP_READINESS_WINDOW_MS,
      windowEndUnixMs: Number.MAX_SAFE_INTEGER,
    })
  })

  it("returns no key until the desktop readiness query is enabled in tauri", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    expect(
      getFrameRouteOverlapReadinessKey({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 2000,
      })
    ).toBeNull()

    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    expect(
      getFrameRouteOverlapReadinessKey(
        {
          windowStartUnixMs: 1000,
          windowEndUnixMs: 2000,
        },
        { enabled: false }
      )
    ).toBeNull()
  })

  it("requires actual tauri command globals, not only the desktop env flag", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"

    expect(isFrameRouteOverlapReadinessRuntime()).toBe(false)
    expect(
      getFrameRouteOverlapReadinessKey({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 2000,
      })
    ).toBeNull()
  })

  it("builds a stable tauri swr key for the readiness window", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    expect(
      getFrameRouteOverlapReadinessKey({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 2000,
      })
    ).toEqual(["local-frame-route-overlap-readiness", 1000, 2000])
  })

  it("builds stable tauri swr keys for unbounded readiness windows", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    expect(getFrameRouteOverlapReadinessKey(undefined)).toEqual([
      "local-frame-route-overlap-readiness",
      undefined,
      undefined,
    ])
    expect(
      getFrameRouteOverlapReadinessKey({
        windowStartUnixMs: 1000,
      })
    ).toEqual(["local-frame-route-overlap-readiness", 1000, undefined])
    expect(
      getFrameRouteOverlapReadinessKey({
        windowEndUnixMs: 2000,
      })
    ).toEqual(["local-frame-route-overlap-readiness", undefined, 2000])
  })

  it("rejects invalid readiness windows before building a swr key", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    for (const query of [
      { windowStartUnixMs: -1, windowEndUnixMs: 2000 },
      { windowStartUnixMs: 1000, windowEndUnixMs: -1 },
      { windowStartUnixMs: 2000, windowEndUnixMs: 1000 },
      { windowStartUnixMs: 1000.5, windowEndUnixMs: 2000 },
    ]) {
      expect(isFrameRouteOverlapReadinessQueryValid(query)).toBe(false)
      expect(getFrameRouteOverlapReadinessKey(query)).toBeNull()
    }
  })

  it("accepts tauri internals as the command runtime marker", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}

    expect(isFrameRouteOverlapReadinessRuntime()).toBe(true)
    expect(
      getFrameRouteOverlapReadinessKey({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 2000,
      })
    ).toEqual(["local-frame-route-overlap-readiness", 1000, 2000])
  })
})
