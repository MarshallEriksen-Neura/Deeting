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

  const fallbackAdapter = jest.fn()
  const getAdapter = jest.fn(() => fallbackAdapter)
  const create = jest.fn(() => mockInstance)

  jest.doMock("axios", () => ({
    __esModule: true,
    default: {
      create,
      getAdapter,
      defaults: {
        adapter: ["xhr"],
      },
    },
    create,
    getAdapter,
    defaults: {
      adapter: ["xhr"],
    },
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

  test("anonymous 请求不会自动附带 Authorization", async () => {
    const { mod, mockInstance } = await loadClientModule()
    mod.setAuthToken("stale-token")

    const onRequest = mockInstance.interceptors.request.use.mock.calls[0][0]
    const result = onRequest({
      url: "/api/v1/auth/login",
      anonymous: true,
      headers: {},
    })

    expect(result).toMatchObject({
      url: "/api/v1/auth/login",
      anonymous: true,
      headers: {},
    })
  })

  test("anonymous 请求会移除继承的 Authorization", async () => {
    const { mod, mockInstance } = await loadClientModule()
    mod.setAuthToken("stale-token")

    const onRequest = mockInstance.interceptors.request.use.mock.calls[0][0]
    const result = onRequest({
      url: "/api/v1/auth/login",
      anonymous: true,
      headers: { Authorization: "Bearer inherited-token" },
    })

    expect(result).toMatchObject({
      url: "/api/v1/auth/login",
      anonymous: true,
      headers: {},
    })
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

  test("anonymous 请求遇到 401 时不会触发 refresh", async () => {
    const { mod, mockInstance } = await loadClientModule()
    mod.setAuthToken("expired-token")

    const onRejected = mockInstance.interceptors.response.use.mock.calls[0][1]
    await expect(
      onRejected({
        message: "Unauthorized",
        response: { status: 401, data: { detail: "Invalid code" }, headers: {} },
        config: { url: "/api/v1/auth/login", anonymous: true, headers: {} },
        isAxiosError: true,
      })
    ).rejects.toMatchObject({ status: 401 })

    expect(mockInstance.post).not.toHaveBeenCalled()
    expect(mockInstance.request).not.toHaveBeenCalled()
  })
})

describe("http client tauri adapter wiring", () => {
  const windowWithTauri = window as Window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
  const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
  const originalApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  beforeEach(() => {
    jest.unmock("axios")
  })

  afterEach(() => {
    jest.resetModules()
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__

    if (originalTauriFlag === undefined) {
      delete process.env.NEXT_PUBLIC_IS_TAURI
    } else {
      process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    }

    if (originalApiBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl
    }
  })

  test("桌面端首个请求应直接走 tauri adapter", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    delete process.env.NEXT_PUBLIC_API_BASE_URL
    windowWithTauri.__TAURI__ = {}

    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "Content-Type": "application/json",
      }),
      text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true })),
    })

    jest.doMock("@tauri-apps/plugin-http", () => ({
      __esModule: true,
      fetch: mockFetch,
    }))

    const { request } = await import("../client")

    await expect(
      request({
        url: "/api/v1/users/me",
        method: "GET",
      })
    ).resolves.toEqual({ ok: true })

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/users/me",
      expect.objectContaining({
        method: "GET",
      })
    )
  })

  test("构建期 tauri 标记为 true 时也应等待 tauri adapter 再发请求", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.ethereals.space"

    const mockFetch = jest.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "Content-Type": "application/json",
      }),
      text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true })),
    })

    jest.doMock("@tauri-apps/plugin-http", () => ({
      __esModule: true,
      fetch: mockFetch,
    }))

    const { request } = await import("../client")

    await expect(
      request({
        url: "/api/v1/users/me",
        method: "GET",
      })
    ).resolves.toEqual({ ok: true })

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.ethereals.space/api/v1/users/me",
      expect.objectContaining({
        method: "GET",
      })
    )
  })
})
