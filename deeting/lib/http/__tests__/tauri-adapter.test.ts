async function loadAdapterModule() {
  jest.resetModules();
  const mockFetch = jest.fn();
  jest.doMock("@tauri-apps/plugin-http", () => ({
    __esModule: true,
    fetch: mockFetch,
  }));
  const mod = await import("../tauri-adapter");
  return {
    createTauriAdapter: mod.createTauriAdapter,
    mockFetch,
  };
}

describe("tauri adapter", () => {
  test("Tauri-Response=error 时应抛出 Axios 风格错误", async () => {
    const { createTauriAdapter, mockFetch } = await loadAdapterModule();
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "Content-Type": "application/json",
        "Tauri-Response": "error",
      }),
      text: jest.fn().mockResolvedValue(
        JSON.stringify({ error: "url not allowed on the configured scope" })
      ),
    });

    const adapter = await createTauriAdapter();

    await expect(
      adapter({
        url: "/api/v1/auth/login/code",
        baseURL: "http://127.0.0.1:8000",
        method: "post",
        headers: {},
        data: { email: "admin@example.com" },
      } as any)
    ).rejects.toMatchObject({
      isAxiosError: true,
      code: "ERR_TAURI_HTTP",
      message: "url not allowed on the configured scope",
    });
  });

  test("应正确拼接 baseURL 并解析 JSON 响应", async () => {
    const { createTauriAdapter, mockFetch } = await loadAdapterModule();
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "Content-Type": "application/json",
      }),
      text: jest.fn().mockResolvedValue(JSON.stringify({ ok: true })),
    });

    const adapter = await createTauriAdapter();

    const response = await adapter({
      url: "/api/v1/ping",
      baseURL: "http://127.0.0.1:8000",
      method: "get",
      headers: {},
    } as any);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/ping",
      expect.objectContaining({
        method: "GET",
      })
    );
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(response.headers["content-type"]).toBe("application/json");
  });
});
