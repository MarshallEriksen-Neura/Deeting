import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const mockReplace = jest.fn()
const mockUseAuthStore = jest.fn()
const mockHasHydrated = jest.fn()
const mockOnHydrate = jest.fn(() => jest.fn())
const mockOnFinishHydration = jest.fn(() => jest.fn())

jest.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams("agentId=agent-1"),
  useRouter: () => ({ replace: mockReplace }),
}))

jest.mock("@/store/auth-store", () => {
  const store = ((selector: (state: { isAuthenticated: boolean }) => unknown) =>
    mockUseAuthStore(selector)) as unknown as typeof import("@/store/auth-store").useAuthStore
  ;(store as typeof store & { persist: unknown }).persist = {
    hasHydrated: () => mockHasHydrated(),
    onHydrate: (...args: unknown[]) => mockOnHydrate(...args),
    onFinishHydration: (...args: unknown[]) => mockOnFinishHydration(...args),
  }
  return { useAuthStore: store }
})

describe("ChatAuthGuard", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockReplace.mockReset()
    mockHasHydrated.mockReset()
    mockOnHydrate.mockReset()
    mockOnFinishHydration.mockReset()
    mockUseAuthStore.mockReset()
    mockHasHydrated.mockReturnValue(true)
    mockOnHydrate.mockReturnValue(jest.fn())
    mockOnFinishHydration.mockReturnValue(jest.fn())
    mockUseAuthStore.mockImplementation((selector) =>
      selector({ isAuthenticated: false })
    )
    ;(global as typeof globalThis & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {}
  })

  it("shows a clickable desktop auth fallback after auto-opening login", async () => {
    const { ChatAuthGuard } = await import("../chat-auth-guard")

    render(
      <ChatAuthGuard>
        <div>chat</div>
      </ChatAuthGuard>
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login?callbackUrl=%2Fchat%3FagentId%3Dagent-1")
    })

    expect(screen.getByText("Sign in to continue")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Continue login" }))
    expect(mockReplace).toHaveBeenCalledTimes(2)
  })
})
