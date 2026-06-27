/* eslint-disable @typescript-eslint/no-explicit-any */

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
        url: "/api/v1/ping",
        baseURL: "https://example.invalid",
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
      baseURL: "https://example.invalid",
      method: "get",
      headers: {},
    } as any);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.invalid/api/v1/ping",
      expect.objectContaining({
        method: "GET",
      })
    );
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(response.headers["content-type"]).toBe("application/json");
  });

  test("原生 transport 发送失败时应附带可能原因", async () => {
    const { createTauriAdapter, mockFetch } = await loadAdapterModule();
    mockFetch.mockRejectedValue(new Error("error sending request for url (https://example.invalid/api/v1/ping)"));

    const adapter = await createTauriAdapter();

    await expect(
      adapter({
        url: "/api/v1/ping",
        baseURL: "https://example.invalid",
        method: "get",
        headers: {},
      } as any)
    ).rejects.toMatchObject({
      isAxiosError: true,
      code: "ERR_TAURI_HTTP_SEND_FAILED",
      message: expect.stringContaining("Likely cause:"),
      response: expect.objectContaining({
        status: 0,
        data: expect.objectContaining({
          raw_error: expect.stringContaining("error sending request for url"),
          likely_cause: expect.stringContaining("proxy"),
        }),
      }),
    });
  });
});
