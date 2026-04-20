import { render, waitFor } from "@testing-library/react"
import { mutate } from "swr"

import { DesktopOAuthListener } from "../desktop-oauth-listener"

const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()
const mockExchangeDesktopBrowserLoginGrant = jest.fn()
const mockExchangeDesktopOAuthLoginGrant = jest.fn()
const mockConfirmDesktopOAuthBindingGrant = jest.fn()
const mockGetCurrentDesktopDeepLinks = jest.fn()
const mockListenForDesktopDeepLinks = jest.fn()

jest.mock("@/hooks/use-auth", () => ({
  useAuthService: () => ({
    exchangeDesktopBrowserLoginGrant: mockExchangeDesktopBrowserLoginGrant,
    exchangeDesktopOAuthLoginGrant: mockExchangeDesktopOAuthLoginGrant,
  }),
}))

jest.mock("@/lib/api/account-bindings", () => ({
  ACCOUNT_BINDINGS_KEY: "/api/v1/users/me/bindings",
  confirmDesktopOAuthBindingGrant: (...args: unknown[]) =>
    mockConfirmDesktopOAuthBindingGrant(...args),
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
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

jest.mock("swr", () => ({
  mutate: jest.fn(),
}))

const PROCESSED_DEEP_LINK_STORAGE_KEY = "deeting:desktop-oauth:processed-deep-links"

describe("DesktopOAuthListener", () => {
  beforeEach(() => {
    mockToastSuccess.mockReset()
    mockToastError.mockReset()
    mockExchangeDesktopBrowserLoginGrant.mockReset()
    mockExchangeDesktopOAuthLoginGrant.mockReset()
    mockConfirmDesktopOAuthBindingGrant.mockReset()
    mockGetCurrentDesktopDeepLinks.mockReset()
    mockListenForDesktopDeepLinks.mockReset()
    window.sessionStorage.clear()
    mockGetCurrentDesktopDeepLinks.mockResolvedValue(null)
    mockListenForDesktopDeepLinks.mockResolvedValue(jest.fn())
  })

  it("subscribes to deep-link events and exchanges browser auth grant", async () => {
    mockExchangeDesktopBrowserLoginGrant.mockResolvedValueOnce(undefined)
    mockListenForDesktopDeepLinks.mockImplementationOnce(async (handler: (urls: string[]) => Promise<void>) => {
      await handler([
        "deeting://auth/callback?provider=browser&session_id=sess-1&grant=grant-1",
      ])
      return jest.fn()
    })

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockExchangeDesktopBrowserLoginGrant).toHaveBeenCalledWith({
        session_id: "sess-1",
        grant: "grant-1",
      })
    })
  })

  it("replays the startup deep link when the app launches from browser callback", async () => {
    mockExchangeDesktopBrowserLoginGrant.mockResolvedValueOnce(undefined)
    mockGetCurrentDesktopDeepLinks.mockResolvedValueOnce([
      "deeting://auth/callback?provider=browser&session_id=sess-2&grant=grant-2",
    ])

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockExchangeDesktopBrowserLoginGrant).toHaveBeenCalledWith({
        session_id: "sess-2",
        grant: "grant-2",
      })
    })
  })

  it("skips replaying a startup deep link that was already processed in this desktop session", async () => {
    mockGetCurrentDesktopDeepLinks.mockResolvedValueOnce([
      "deeting://auth/callback?provider=browser&session_id=sess-2&grant=grant-2",
    ])
    window.sessionStorage.setItem(
      PROCESSED_DEEP_LINK_STORAGE_KEY,
      JSON.stringify(["login:browser:sess-2::grant-2"])
    )

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockGetCurrentDesktopDeepLinks).toHaveBeenCalled()
    })

    expect(mockExchangeDesktopBrowserLoginGrant).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("exchanges provider login grants for supported oauth callbacks", async () => {
    mockExchangeDesktopOAuthLoginGrant.mockResolvedValueOnce(undefined)
    mockListenForDesktopDeepLinks.mockImplementationOnce(async (handler: (urls: string[]) => Promise<void>) => {
      await handler([
        "deeting://auth/callback?provider=linuxdo&session_id=sess-oauth&state=state-oauth&grant=grant-oauth",
      ])
      return jest.fn()
    })

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockExchangeDesktopOAuthLoginGrant).toHaveBeenCalledWith({
        provider: "linuxdo",
        session_id: "sess-oauth",
        state: "state-oauth",
        grant: "grant-oauth",
      })
    })
  })

  it("dispatches bind callbacks to the binding confirm API and refreshes binding state", async () => {
    mockConfirmDesktopOAuthBindingGrant.mockResolvedValueOnce({
      provider: "google",
      is_bound: true,
      display_name: "Bound Google User",
    })
    mockListenForDesktopDeepLinks.mockImplementationOnce(
      async (handler: (urls: string[]) => Promise<void>) => {
        await handler([
          "deeting://auth/callback?intent=bind&provider=google&session_id=sess-3&state=state-3&grant=grant-3",
        ])
        return jest.fn()
      }
    )

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockConfirmDesktopOAuthBindingGrant).toHaveBeenCalledWith({
        provider: "google",
        session_id: "sess-3",
        state: "state-3",
        grant: "grant-3",
      })
    })

    expect(mutate).toHaveBeenCalledWith("/api/v1/users/me/bindings")
  })

  it("surfaces string-based initialization errors from tauri", async () => {
    mockGetCurrentDesktopDeepLinks.mockRejectedValueOnce(
      "Command plugin:deep-link|get_current not allowed by scope"
    )

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Command plugin:deep-link|get_current not allowed by scope"
      )
    })
  })

  it("suppresses stale callback replays after a terminal inactive-session error", async () => {
    mockExchangeDesktopOAuthLoginGrant.mockRejectedValueOnce(
      new Error("OAuth session is not active")
    )
    mockGetCurrentDesktopDeepLinks
      .mockResolvedValueOnce([
        "deeting://auth/callback?provider=linuxdo&session_id=sess-oauth&state=state-oauth&grant=grant-oauth",
      ])
      .mockResolvedValueOnce([
        "deeting://auth/callback?provider=linuxdo&session_id=sess-oauth&state=state-oauth&grant=grant-oauth",
      ])

    const firstRender = render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("OAuth session is not active")
    })

    firstRender.unmount()
    mockToastError.mockClear()
    mockExchangeDesktopOAuthLoginGrant.mockClear()

    render(<DesktopOAuthListener />)

    await waitFor(() => {
      expect(mockGetCurrentDesktopDeepLinks).toHaveBeenCalledTimes(2)
    })

    expect(mockExchangeDesktopOAuthLoginGrant).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
