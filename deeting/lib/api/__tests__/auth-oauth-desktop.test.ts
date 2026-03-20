import {
  exchangeDesktopOAuthLoginGrant,
  openDesktopOAuthAuthorizeUrl,
  parseDesktopOAuthCallbackUrl,
  startDesktopOAuthLoginSession,
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

  it("starts a desktop oauth login session", async () => {
    mockedRequest.mockResolvedValueOnce({
      session_id: "sess-1",
      authorize_url: "https://accounts.google.com/o/oauth2/v2/auth?state=state-1",
      expires_in: 600,
    })

    const result = await startDesktopOAuthLoginSession("google")

    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/auth/oauth/desktop/start",
      method: "POST",
      data: {
        provider: "google",
        return_scheme: "deeting",
        platform: "desktop",
      },
      anonymous: true,
      skipAuthRefresh: true,
    })
    expect(result.session_id).toBe("sess-1")
  })

  it("starts a desktop oauth login session for linuxdo", async () => {
    mockedRequest.mockResolvedValueOnce({
      session_id: "sess-linuxdo",
      authorize_url: "https://connect.linux.do/oauth2/authorize?state=state-linuxdo",
      expires_in: 600,
    })

    const result = await startDesktopOAuthLoginSession("linuxdo")

    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/auth/oauth/desktop/start",
      method: "POST",
      data: {
        provider: "linuxdo",
        return_scheme: "deeting",
        platform: "desktop",
      },
      anonymous: true,
      skipAuthRefresh: true,
    })
    expect(result.session_id).toBe("sess-linuxdo")
  })

  it("parses desktop callback url", () => {
    expect(
      parseDesktopOAuthCallbackUrl(
        "deeting://auth/callback?provider=google&session_id=sess-1&state=state-1&grant=grant-1"
      )
    ).toEqual({
      intent: "login",
      provider: "google",
      session_id: "sess-1",
      state: "state-1",
      grant: "grant-1",
    })
  })

  it("parses desktop callback url for linuxdo", () => {
    expect(
      parseDesktopOAuthCallbackUrl(
        "deeting://auth/callback?provider=linuxdo&session_id=sess-linuxdo&state=state-linuxdo&grant=grant-linuxdo"
      )
    ).toEqual({
      intent: "login",
      provider: "linuxdo",
      session_id: "sess-linuxdo",
      state: "state-linuxdo",
      grant: "grant-linuxdo",
    })
  })

  it("parses desktop browser login callback url", () => {
    expect(
      parseDesktopOAuthCallbackUrl(
        "deeting://auth/callback?provider=browser&session_id=sess-2&grant=grant-2"
      )
    ).toEqual({
      provider: "browser",
      session_id: "sess-2",
      grant: "grant-2",
      intent: "login",
    })
  })

  it("opens desktop oauth authorize url in system browser", async () => {
    await expect(openDesktopOAuthAuthorizeUrl("https://example.com/oauth")).resolves.toBeUndefined()
  })

  it("exchanges desktop oauth login grant", async () => {
    mockedRequest.mockResolvedValueOnce({
      access_token: "access-1",
      refresh_token: "refresh-1",
      token_type: "bearer",
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
      },
    })

    const result = await exchangeDesktopOAuthLoginGrant({
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
      anonymous: true,
      skipAuthRefresh: true,
    })
    expect(result.user.email).toBe("user@example.com")
  })
})
