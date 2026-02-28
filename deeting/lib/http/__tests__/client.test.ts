type MockAxiosInstance = {
  defaults: Record<string, unknown>
  interceptors: {
    request: { use: jest.Mock }
    response: { use: jest.Mock }
  }
  post: jest.Mock
  request: jest.Mock
  getUri: jest.Mock
}

async function loadClientModule() {
  jest.resetModules()

  const mockInstance: MockAxiosInstance = {
    defaults: {},
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    post: jest.fn(),
    request: jest.fn(),
    getUri: jest.fn(),
  }

  const create = jest.fn(() => mockInstance)
  jest.doMock("axios", () => ({
    __esModule: true,
    default: { create },
    create,
  }))

  const mod = await import("../client")
  return { mod, mockInstance }
}

describe("http client auth refresh", () => {
  beforeEach(() => {
    sessionStorage.clear()
    jest.clearAllMocks()
  })

  test("401 且无鉴权上下文时不会触发 refresh", async () => {
    const { mod, mockInstance } = await loadClientModule()
    mod.clearAuthToken()

    const onRejected = mockInstance.interceptors.response.use.mock.calls[0][1]
    await expect(
      onRejected({
        message: "Unauthorized",
        response: { status: 401, data: { detail: "Invalid token" }, headers: {} },
        config: { url: "/api/v1/internal/models", headers: {} },
        isAxiosError: true,
      })
    ).rejects.toMatchObject({ status: 401 })

    expect(mockInstance.post).not.toHaveBeenCalled()
  })

  test("refresh 失败会清理本地会话并进入冷却", async () => {
    const { mod, mockInstance } = await loadClientModule()

    sessionStorage.setItem(
      "deeting-auth-store",
      JSON.stringify({
        state: {
          accessToken: "expired-token",
          tokenType: "bearer",
          isAuthenticated: true,
        },
      })
    )
    mod.setAuthToken("expired-token")

    let invalidatedCount = 0
    window.addEventListener(mod.AUTH_INVALIDATED_EVENT, () => {
      invalidatedCount += 1
    })

    mockInstance.post.mockRejectedValue(new Error("refresh failed"))

    await expect(mod.refreshAccessToken()).resolves.toBeNull()
    await expect(mod.refreshAccessToken()).resolves.toBeNull()

    expect(mockInstance.post).toHaveBeenCalledTimes(1)
    expect(mod.getAuthToken()).toBeNull()
    expect(sessionStorage.getItem("deeting-auth-store")).toBeNull()
    expect(invalidatedCount).toBe(1)
  })

  test("401 且存在鉴权上下文时会 refresh 后重放原请求", async () => {
    const { mod, mockInstance } = await loadClientModule()
    mod.setAuthToken("expired-token")

    mockInstance.post.mockResolvedValue({
      data: {
        access_token: "new-token",
        token_type: "bearer",
      },
    })
    mockInstance.request.mockResolvedValue({ data: { ok: true } })

    const onRejected = mockInstance.interceptors.response.use.mock.calls[0][1]
    const result = await onRejected({
      message: "Unauthorized",
      response: { status: 401, data: { detail: "Invalid token" }, headers: {} },
      config: { url: "/api/v1/assistants/installs", headers: {} },
      isAxiosError: true,
    })

    expect(mockInstance.post).toHaveBeenCalledTimes(1)
    expect(mockInstance.request).toHaveBeenCalledTimes(1)
    expect(mockInstance.request.mock.calls[0][0]).toMatchObject({
      url: "/api/v1/assistants/installs",
      skipAuthRefresh: true,
      headers: { Authorization: "Bearer new-token" },
    })
    expect(result).toEqual({ data: { ok: true } })
  })
})
