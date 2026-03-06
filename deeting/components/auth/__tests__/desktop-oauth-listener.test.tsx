import { render, waitFor } from "@testing-library/react"

import { DesktopOAuthListener } from "../desktop-oauth-listener"

const mockCompleteDesktopOAuth = jest.fn()
const mockOnOpenUrl = jest.fn()

jest.mock("@/hooks/use-auth", () => ({
  useAuthService: () => ({
    completeDesktopOAuth: mockCompleteDesktopOAuth,
  }),
}))

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: (...args: unknown[]) => mockOnOpenUrl(...args),
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
    mockOnOpenUrl.mockReset()
  })

  it("subscribes to deep-link events and exchanges auth grant", async () => {
    mockCompleteDesktopOAuth.mockResolvedValueOnce(undefined)
    mockOnOpenUrl.mockImplementationOnce(async (handler: (urls: string[]) => Promise<void>) => {
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
})
