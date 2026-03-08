import {
  loginWithCode,
  logout,
  refreshTokens,
  sendLoginCode,
} from "../auth"
import { clearAuthToken, request, setAuthToken } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
  setAuthToken: jest.fn(),
  clearAuthToken: jest.fn(),
}))

const mockedRequest = request as jest.MockedFunction<typeof request>
const mockedSetAuthToken = setAuthToken as jest.MockedFunction<typeof setAuthToken>
const mockedClearAuthToken = clearAuthToken as jest.MockedFunction<typeof clearAuthToken>

describe("auth api", () => {
  beforeEach(() => {
    mockedRequest.mockReset()
    mockedSetAuthToken.mockReset()
    mockedClearAuthToken.mockReset()
  })

  it("sends login code as an anonymous request without refresh or credentials", async () => {
    mockedRequest.mockResolvedValueOnce({ message: "ok" })

    await sendLoginCode({
      email: "user@example.com",
      captcha_token: "captcha-token",
      invite_code: "invite-code",
    })

    expect(mockedRequest).toHaveBeenCalledWith({
      url: "/api/v1/auth/login/code",
      method: "POST",
      data: {
        email: "user@example.com",
        captcha_token: "captcha-token",
        invite_code: "invite-code",
      },
      anonymous: true,
      skipAuthRefresh: true,
      withCredentials: false,
    })
  })

  it("logs in with code as an anonymous request without refresh or credentials", async () => {
    mockedRequest.mockResolvedValueOnce({
      access_token: "access-token",
      token_type: "bearer",
    })

    const result = await loginWithCode({
      email: "user@example.com",
      code: "123456",
      username: "tester",
    })

    expect(mockedRequest).toHaveBeenCalledWith({
      url: "/api/v1/auth/login",
      method: "POST",
      data: {
        email: "user@example.com",
        code: "123456",
        username: "tester",
      },
      anonymous: true,
      skipAuthRefresh: true,
      withCredentials: false,
    })
    expect(mockedSetAuthToken).toHaveBeenCalledWith("access-token")
    expect(result.access_token).toBe("access-token")
  })

  it("refreshes tokens with the standard authenticated client behavior", async () => {
    mockedRequest.mockResolvedValueOnce({
      access_token: "refreshed-token",
      token_type: "bearer",
    })

    await refreshTokens()

    expect(mockedRequest).toHaveBeenCalledWith({
      url: "/api/v1/auth/refresh",
      method: "POST",
    })
    expect(mockedSetAuthToken).toHaveBeenCalledWith("refreshed-token")
  })

  it("clears auth token on logout", async () => {
    mockedRequest.mockResolvedValueOnce({ message: "logged out" })

    await logout()

    expect(mockedRequest).toHaveBeenCalledWith({
      url: "/api/v1/auth/logout",
      method: "POST",
    })
    expect(mockedClearAuthToken).toHaveBeenCalledTimes(1)
  })
})
