describe("useChatStore persistence storage", () => {
  const storageKey = "deeting-chat-store"

  beforeEach(() => {
    jest.resetModules()
    localStorage.clear()
    sessionStorage.clear()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    delete process.env.NEXT_PUBLIC_IS_TAURI
  })

  it("rehydrates chat config from localStorage in tauri runtime", () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          config: {
            model: "gpt-5",
            temperature: 0.3,
            topP: 0.8,
            maxTokens: null,
          },
          streamEnabled: true,
          thoughtBlockDefaultOpen: true,
        },
        version: 1,
      })
    )

    jest.isolateModules(() => {
      const { useChatStore } = jest.requireActual("../chat-store") as typeof import("../chat-store")

      expect(useChatStore.getState().config).toMatchObject({
        model: "gpt-5",
        temperature: 0.3,
        topP: 0.8,
        maxTokens: null,
      })
      expect(useChatStore.getState().streamEnabled).toBe(true)
      expect(useChatStore.getState().thoughtBlockDefaultOpen).toBe(false)
      expect(sessionStorage.getItem(storageKey)).toBeNull()
    })
  })

  it("rehydrates chat config from sessionStorage on web", () => {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          config: {
            model: "gpt-4.1",
            temperature: 0.5,
            topP: 0.9,
            maxTokens: null,
          },
          streamEnabled: false,
          thoughtBlockDefaultOpen: true,
        },
        version: 1,
      })
    )

    jest.isolateModules(() => {
      const { useChatStore } = jest.requireActual("../chat-store") as typeof import("../chat-store")

      expect(useChatStore.getState().config).toMatchObject({
        model: "gpt-4.1",
        temperature: 0.5,
        topP: 0.9,
        maxTokens: null,
      })
      expect(useChatStore.getState().thoughtBlockDefaultOpen).toBe(false)
      expect(localStorage.getItem(storageKey)).toBeNull()
    })
  })
})
