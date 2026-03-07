import { render, waitFor } from "@testing-library/react"

import { DesktopOAuthListener } from "../desktop-oauth-listener"

const mockCompleteDesktopOAuth = jest.fn()
const mockGetCurrentDesktopDeepLinks = jest.fn()
const mockListenForDesktopDeepLinks = jest.fn()

jest.mock("@/hooks/use-auth", () => ({
  useAuthService: () => ({
    completeDesktopOAuth: mockCompleteDesktopOAuth,
  }),
}))

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@/lib/api/desktop-deep-link", () => ({
  getCurrentDesktopDeepLinks: (...args: unknown[]) => mockGetCurrentDesktopDeepLinks(...args),
  listenForDesktopDeepLinks: (...args: unknown[]) => mockListenForDesktopDeepLinks(...args),
}))

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

describe("DesktopOAuthListener", () => {
  beforeEach(() => {
    mockCompleteDesktopOAuth.mockReset()
    mockGetCurrentDesktopDeepLinks.mockReset()
    mockListenForDesktopDeepLinks.mockReset()
    mockGetCurrentDesktopDeepLinks.mockResolvedValue(null)
    mockListenForDesktopDeepLinks.mockResolvedValue(jest.fn())
  })

  it("subscribes to deep-link events and exchanges auth grant", async () => {
    mockCompleteDesktopOAuth.mockResolvedValueOnce(undefined)
    mockListenForDesktopDeepLinks.mockImplementationOnce(async (handler: (urls: string[]) => Promise<void>) => {
      await handler([
        "deeting://auth/callback?provider=google&session_id=sess-1&state=state-1&grant=grant-1",
      ])
      return jest.fn()
    })

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockCompleteDesktopOAuth).toHaveBeenCalledWith({
        provider: "google",
        session_id: "sess-1",
        state: "state-1",
        grant: "grant-1",
      })
    })
  })

  it("replays the startup deep link when the app launches from oauth callback", async () => {
    mockCompleteDesktopOAuth.mockResolvedValueOnce(undefined)
    mockGetCurrentDesktopDeepLinks.mockResolvedValueOnce([
      "deeting://auth/callback?provider=github&session_id=sess-2&state=state-2&grant=grant-2",
    ])

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockCompleteDesktopOAuth).toHaveBeenCalledWith({
        provider: "github",
        session_id: "sess-2",
        state: "state-2",
        grant: "grant-2",
      })
    })
  })
})
