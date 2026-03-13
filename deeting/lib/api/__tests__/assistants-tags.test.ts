import { fetchAssistantTags } from "@/lib/api/assistants"
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

describe("assistant tags api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches assistant tags via web endpoint even in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValue([
      {
        id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
        name: "#chat",
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:00Z",
      },
    ] as unknown)

    const result = await fetchAssistantTags()

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("#chat")
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/tags",
        method: "GET",
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("fetches assistant tags via web endpoint outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue([
      {
        id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
        name: "#agent",
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:00Z",
      },
    ])

    const result = await fetchAssistantTags()

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("#agent")
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/tags",
        method: "GET",
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
