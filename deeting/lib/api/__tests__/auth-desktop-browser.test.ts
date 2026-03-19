import {
  buildDesktopBrowserLoginUrl,
  completeDesktopBrowserLoginSession,
  openDesktopBrowserLoginUrl,
  startDesktopBrowserLoginSession,
} from "../auth-desktop-browser"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: jest.fn().mockResolvedValue(undefined),
}))

const mockedRequest = request as jest.MockedFunction<typeof request>

describe("auth-desktop-browser api", () => {
  beforeEach(() => {
    mockedRequest.mockReset()
  })

  it("starts desktop browser login session", async () => {
    mockedRequest.mockResolvedValueOnce({
      session_id: "sess-1",
      expires_in: 600,
    })

    const result = await startDesktopBrowserLoginSession()

    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/auth/desktop/browser/start",
      method: "POST",
      data: {
        return_scheme: "deeting",
        platform: "desktop",
      },
    })
    expect(result.session_id).toBe("sess-1")
  })

  it("completes desktop browser login session", async () => {
    mockedRequest.mockResolvedValueOnce({
      deep_link_url: "deeting://auth/callback?provider=browser&session_id=sess-1",
    })

    const result = await completeDesktopBrowserLoginSession({
      session_id: "sess-1",
    })

    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/auth/desktop/browser/complete",
      method: "POST",
      data: {
        session_id: "sess-1",
      },
    })
    expect(result.deep_link_url).toContain("provider=browser")
  })

  it("builds browser login url with desktop session", () => {
    expect(
      buildDesktopBrowserLoginUrl("https://app.example.com/login?foo=bar", "sess-1")
    ).toBe("https://app.example.com/login?foo=bar&desktop_login_session=sess-1")
  })

  it("opens browser login url with the system browser", async () => {
    await expect(openDesktopBrowserLoginUrl("https://app.example.com/login")).resolves.toBeUndefined()
  })
})
