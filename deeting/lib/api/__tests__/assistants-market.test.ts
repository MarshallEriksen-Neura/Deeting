import { fetchAssistantMarket } from "@/lib/api/assistants"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
  getAuthToken: jest.fn(() => "desktop-token"),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("assistant market api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches market via web endpoint even in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValue({
      items: [
        {
          assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
          owner_user_id: null,
          icon_id: "lucide:bot",
          share_slug: null,
          summary: "cloud summary",
          published_at: "2026-03-03T00:00:00Z",
          current_version_id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
          install_count: 12,
          rating_avg: 4.8,
          rating_count: 3,
          tags: ["chat"],
          installed: false,
          version: {
            id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
            version: "1.0.0",
            name: "Chat Pro",
            description: "assistant for chat",
            system_prompt: "you are assistant",
            tags: ["chat"],
            published_at: "2026-03-03T00:00:00Z",
          },
        },
      ],
      next_page: null,
      previous_page: null,
    })

    const result = await fetchAssistantMarket({
      cursor: null,
      size: 10,
      q: "chat",
      tags: ["chat"],
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].assistant_id).toBe("ca8c65e1-ffdd-45aa-8f58-b7709ed318de")
    expect(result.items[0].installed).toBe(false)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/market",
        method: "GET",
        params: { cursor: null, size: 10, q: "chat", tags: ["chat"] },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("fetches market via web endpoint outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      items: [],
      next_page: null,
      previous_page: null,
    })

    const result = await fetchAssistantMarket({ size: 8, q: "x" })

    expect(result.items).toHaveLength(0)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/market",
        method: "GET",
        params: { size: 8, q: "x" },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
