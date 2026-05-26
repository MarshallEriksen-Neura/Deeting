import {
  hasTauriCommandGlobals,
  isTauriCommandRuntime,
  isTauriRuntime,
} from "@/lib/runtime/tauri"

const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("tauri runtime helpers", () => {
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

  it("keeps the legacy desktop runtime helper permissive for env-only checks", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"

    expect(hasTauriCommandGlobals()).toBe(false)
    expect(isTauriRuntime()).toBe(true)
    expect(isTauriCommandRuntime()).toBe(false)
  })

  it("requires both env and command globals for tauri command runtime", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}

    expect(hasTauriCommandGlobals()).toBe(true)
    expect(isTauriRuntime()).toBe(true)
    expect(isTauriCommandRuntime()).toBe(true)
  })

  it("does not treat command globals alone as command runtime", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    windowWithTauri.__TAURI__ = {}

    expect(hasTauriCommandGlobals()).toBe(true)
    expect(isTauriRuntime()).toBe(true)
    expect(isTauriCommandRuntime()).toBe(false)
  })
})
