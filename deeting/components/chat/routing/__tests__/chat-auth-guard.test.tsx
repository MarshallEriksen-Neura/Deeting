import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const mockUseAuthStore = jest.fn()
const mockHasHydrated = jest.fn()
const mockOnHydrate = jest.fn(() => jest.fn())
const mockOnFinishHydration = jest.fn(() => jest.fn())
let mockPersistApi:
  | {
      hasHydrated: () => boolean
      onHydrate: (...args: unknown[]) => unknown
      onFinishHydration: (...args: unknown[]) => unknown
    }
  | undefined

jest.mock("@/store/auth-store", () => {
  const store = ((selector: (state: { isAuthenticated: boolean }) => unknown) =>
    mockUseAuthStore(selector)) as unknown as typeof import("@/store/auth-store").useAuthStore
  Object.defineProperty(store, "persist", {
    configurable: true,
    get: () => mockPersistApi,
  })
  return { useAuthStore: store }
})

describe("ChatAuthGuard", () => {
  const originalLocation = window.location
  let mockLocationReplace: jest.Mock

  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockHasHydrated.mockReset()
    mockOnHydrate.mockReset()
    mockOnFinishHydration.mockReset()
    mockUseAuthStore.mockReset()
    mockHasHydrated.mockReturnValue(true)
    mockOnHydrate.mockReturnValue(jest.fn())
    mockOnFinishHydration.mockReturnValue(jest.fn())
    mockPersistApi = {
      hasHydrated: () => mockHasHydrated(),
      onHydrate: (...args: unknown[]) => mockOnHydrate(...args),
      onFinishHydration: (...args: unknown[]) => mockOnFinishHydration(...args),
    }
    mockUseAuthStore.mockImplementation((selector) =>
      selector({ isAuthenticated: false })
    )
    ;(global as typeof globalThis & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {}
    mockLocationReplace = jest.fn()
    delete (window as typeof window & { location?: Location }).location
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: "/chat",
        search: "?agentId=agent-1",
        replace: mockLocationReplace,
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    })
  })

  it("builds the login callback from the current browser location", async () => {
    const { buildChatLoginTarget } = await import("../chat-auth-guard")

    expect(buildChatLoginTarget("/chat", "?agentId=agent-1")).toBe(
      "/login?callbackUrl=%2Fchat%3FagentId%3Dagent-1"
    )
  })

  it("shows a clickable desktop auth fallback after auto-opening login", async () => {
    const { ChatAuthGuard } = await import("../chat-auth-guard")

    render(
      <ChatAuthGuard>
        <div>chat</div>
      </ChatAuthGuard>
    )

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/login?callbackUrl=%2Fchat%3FagentId%3Dagent-1")
    })

    expect(screen.getByText("Sign in to continue")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Continue login" }))
    expect(mockLocationReplace).toHaveBeenCalledTimes(2)
  })

  it("handles missing persist api without crashing", async () => {
    const { ChatAuthGuard } = await import("../chat-auth-guard")
    mockPersistApi = undefined

    render(
      <ChatAuthGuard>
        <div>chat</div>
      </ChatAuthGuard>
    )

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/login?callbackUrl=%2Fchat%3FagentId%3Dagent-1")
    })

    expect(screen.getByText("Sign in to continue")).toBeInTheDocument()
  })
})
