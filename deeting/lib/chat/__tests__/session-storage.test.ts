import { resolveSessionIdFromBrowser } from "../session-storage"

describe("resolveSessionIdFromBrowser", () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.pushState({}, "", "/")
  })

  it("prefers query session when present", () => {
    localStorage.setItem("session-key", "stored-session")
    window.history.pushState({}, "", "/chat/agent?session=query-session")

    expect(resolveSessionIdFromBrowser("session-key")).toBe("query-session")
  })

  it("falls back to localStorage when query is missing", () => {
    localStorage.setItem("session-key", "stored-session")
    window.history.pushState({}, "", "/chat/agent")

    expect(resolveSessionIdFromBrowser("session-key")).toBe("stored-session")
  })

  it("returns null when no session is available", () => {
    window.history.pushState({}, "", "/chat/agent")

    expect(resolveSessionIdFromBrowser("session-key")).toBeNull()
  })

  it("falls back to localStorage when query session is empty", () => {
    localStorage.setItem("session-key", "stored-session")
    window.history.pushState({}, "", "/chat/agent?session=")

    expect(resolveSessionIdFromBrowser("session-key")).toBe("stored-session")
  })
})
