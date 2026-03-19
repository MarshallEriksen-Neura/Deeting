import {
  exchangeDesktopOAuthGrant,
  openDesktopOAuthAuthorizeUrl,
  parseDesktopOAuthCallbackUrl,
  startDesktopOAuthSession,
} from "../auth-oauth-desktop"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: jest.fn().mockResolvedValue(undefined),
}))

const mockedRequest = request as jest.MockedFunction<typeof request>

describe("auth-oauth-desktop api", () => {
  beforeEach(() => {
    mockedRequest.mockReset()
  })

  it("starts desktop oauth session", async () => {
    mockedRequest.mockResolvedValueOnce({
      session_id: "sess-1",
      authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
      expires_in: 600,
    })

    const result = await startDesktopOAuthSession({ provider: "google" })

    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/auth/oauth/desktop/start",
      method: "POST",
      data: {
        provider: "google",
        return_scheme: "deeting",
        platform: "desktop",
      },
    })
    expect(result.session_id).toBe("sess-1")
  })

  it("exchanges desktop oauth grant", async () => {
    mockedRequest.mockResolvedValueOnce({
      access_token: "token-1",
      token_type: "bearer",
      user: { id: "u-1", email: "user@example.com" },
    })

    const result = await exchangeDesktopOAuthGrant({
      provider: "google",
      session_id: "sess-1",
      state: "state-1",
      grant: "grant-1",
    })

    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/auth/oauth/desktop/exchange",
      method: "POST",
      data: {
        provider: "google",
        session_id: "sess-1",
        state: "state-1",
        grant: "grant-1",
      },
    })
    expect(result.access_token).toBe("token-1")
  })

  it("parses desktop callback url", () => {
    expect(
      parseDesktopOAuthCallbackUrl(
        "deeting://auth/callback?provider=google&session_id=sess-1&state=state-1&grant=grant-1"
      )
    ).toEqual({
      provider: "google",
      session_id: "sess-1",
      state: "state-1",
      grant: "grant-1",
    })
  })

  it("parses desktop browser login callback url", () => {
    expect(
      parseDesktopOAuthCallbackUrl(
        "deeting://auth/callback?provider=browser&session_id=sess-2&state=state-2&grant=grant-2"
      )
    ).toEqual({
      provider: "browser",
      session_id: "sess-2",
      state: "state-2",
      grant: "grant-2",
    })
  })

  it("opens desktop oauth authorize url in system browser", async () => {
    await expect(openDesktopOAuthAuthorizeUrl("https://example.com/oauth")).resolves.toBeUndefined()
  })
})
