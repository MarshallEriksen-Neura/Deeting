import { useBrowserModeStore } from "../browser-mode-store"

describe("useBrowserModeStore", () => {
  const resetStore = () => {
    useBrowserModeStore.getState().reset()
  }

  beforeEach(() => {
    resetStore()
  })

  it("records the originating chat intent when browser mode is requested", () => {
    useBrowserModeStore.getState().requestBrowserMode({
      prompt: "打开 github 并查看 notifications",
      source: "chat",
    })

    const state = useBrowserModeStore.getState()
    expect(state.status).toBe("pending_confirmation")
    expect(state.request).toMatchObject({
      prompt: "打开 github 并查看 notifications",
      source: "chat",
    })
  })

  it("moves to connecting when the user confirms browser mode", () => {
    const store = useBrowserModeStore.getState()
    store.requestBrowserMode({ prompt: "打开网页", source: "chat" })

    store.confirm()

    expect(useBrowserModeStore.getState().status).toBe("connecting")
  })

  it("stores current page metadata and marks browser mode active after activation", () => {
    const store = useBrowserModeStore.getState()
    store.requestBrowserMode({ prompt: "打开网页", source: "chat" })
    store.confirm()

    store.activate({
      connectionLabel: "Chrome extension connected",
      page: {
        tabId: 42,
        title: "Example Domain",
        url: "https://example.com/",
        host: "example.com",
      },
      lastAction: {
        kind: "open_tab",
        summary: "Opened https://example.com/",
      },
    })

    const state = useBrowserModeStore.getState()
    expect(state.status).toBe("active")
    expect(state.connectionLabel).toBe("Chrome extension connected")
    expect(state.page).toMatchObject({
      tabId: 42,
      title: "Example Domain",
      host: "example.com",
    })
    expect(state.lastAction).toMatchObject({
      kind: "open_tab",
      summary: "Opened https://example.com/",
    })
  })

  it("moves to recovering and preserves the latest action when disconnected", () => {
    const store = useBrowserModeStore.getState()
    store.requestBrowserMode({ prompt: "打开网页", source: "chat" })
    store.confirm()
    store.activate({
      connectionLabel: "Connected",
      page: {
        tabId: 42,
        title: "Example Domain",
        url: "https://example.com/",
        host: "example.com",
      },
      lastAction: {
        kind: "click",
        summary: 'Clicked "Continue"',
      },
    })

    store.markDisconnected("Extension session lost")

    const state = useBrowserModeStore.getState()
    expect(state.status).toBe("recovering")
    expect(state.connectionLabel).toBe("Extension session lost")
    expect(state.lastAction).toMatchObject({
      kind: "click",
      summary: 'Clicked "Continue"',
    })
  })

  it("ends browser mode and preserves a summary while clearing active page state", () => {
    const store = useBrowserModeStore.getState()
    store.requestBrowserMode({ prompt: "打开网页", source: "chat" })
    store.confirm()
    store.activate({
      connectionLabel: "Connected",
      page: {
        tabId: 42,
        title: "Example Domain",
        url: "https://example.com/",
        host: "example.com",
      },
      lastAction: {
        kind: "snapshot",
        summary: "Captured page snapshot",
      },
    })

    store.end("User ended browser mode")

    const state = useBrowserModeStore.getState()
    expect(state.status).toBe("ended")
    expect(state.page).toBeNull()
    expect(state.endedSummary).toBe("User ended browser mode")
    expect(state.lastAction).toMatchObject({
      kind: "snapshot",
      summary: "Captured page snapshot",
    })
  })
})
