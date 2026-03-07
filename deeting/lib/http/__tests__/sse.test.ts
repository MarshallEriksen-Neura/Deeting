async function loadSseModule() {
  jest.resetModules()

  const getAuthToken = jest.fn(() => "desktop-cloud-token")
  const refreshAccessToken = jest.fn(async () => "refreshed-token")

  jest.doMock("../client", () => ({
    __esModule: true,
    apiClient: { getUri: jest.fn((config: { url: string }) => config.url) },
    getAuthToken,
    refreshAccessToken,
  }))

  const mod = await import("../sse")
  return { mod, getAuthToken, refreshAccessToken }
}

describe("openSSE", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test("本地网关可显式关闭 Authorization 头与 refresh", async () => {
    const { mod, refreshAccessToken } = await loadSseModule()
    const fetchMock = jest.fn().mockResolvedValue({
      status: 401,
      statusText: "Unauthorized",
      ok: false,
      body: null,
    })
    global.fetch = fetchMock as typeof fetch

    const onError = jest.fn()

    mod.openSSE("http://127.0.0.1:53055/v1/chat/completions", {
      method: "POST",
      includeAuthHeader: false,
      headers: {
        "Content-Type": "application/json",
      },
      onMessage: jest.fn(),
      onError,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
    })
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization")
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})
