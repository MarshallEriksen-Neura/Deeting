import { fetchOwnedAssistants } from "@/lib/api/assistants"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
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

describe("assistant owned api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches owned assistants via tauri commands", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce([
        {
          id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
          owner_user_id: null,
          visibility: "private",
          status: "published",
          share_slug: null,
          summary: "summary",
          icon_id: "lucide:bot",
          current_version_id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
          published_at: null,
          install_count: 1,
          rating_avg: 4.5,
          rating_count: 2,
        },
      ] as unknown)
      .mockResolvedValueOnce([
        {
          id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
          assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
          version: "1.0.0",
          name: "assistant-v1",
          description: "desc",
          system_prompt: "you are assistant",
          tags: ["#chat"],
        },
      ] as unknown)

    const result = await fetchOwnedAssistants({ cursor: null, size: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].versions[0].name).toBe("assistant-v1")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_assistant_entities", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      "list_local_assistant_versions",
      undefined
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("fetches owned assistants via web endpoint outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      items: [
        {
          id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
          owner_user_id: null,
          visibility: "private",
          status: "published",
          share_slug: null,
          summary: "summary",
          icon_id: "lucide:bot",
          current_version_id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
          published_at: null,
          versions: [
            {
              id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
              version: "1.0.0",
              name: "assistant-v1",
              description: "desc",
              system_prompt: "you are assistant",
              tags: ["#chat"],
            },
          ],
          install_count: 1,
          rating_avg: 4.5,
          rating_count: 2,
        },
      ],
      next_cursor: null,
      size: 1,
    })

    const result = await fetchOwnedAssistants({ cursor: null, size: 20 })

    expect(result.items).toHaveLength(1)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/owned",
        method: "GET",
        params: { cursor: null, size: 20 },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
