import {
  openDesktopOAuthAuthorizeUrl,
  parseDesktopOAuthCallbackUrl,
} from "../auth-oauth-desktop"

jest.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: jest.fn().mockResolvedValue(undefined),
}))

describe("auth-oauth-desktop api", () => {
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
})
