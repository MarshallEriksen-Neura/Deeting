import { rateAssistant } from "@/lib/api/assistants"
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

describe("assistant rating api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("rates assistant via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      rating_avg: 4.5,
      rating_count: 2,
    } as unknown)

    const result = await rateAssistant("ca8c65e1-ffdd-45aa-8f58-b7709ed318de", 4.5)

    expect(result).toEqual({
      assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      rating_avg: 4.5,
      rating_count: 2,
    })
    expect(mockInvoke).toHaveBeenCalledWith("rate_local_assistant", {
      assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      payload: { rating: 4.5 },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rates assistant via web endpoint outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      rating_avg: 4.2,
      rating_count: 3,
    })

    const result = await rateAssistant("ca8c65e1-ffdd-45aa-8f58-b7709ed318de", 5)

    expect(result).toEqual({
      assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      rating_avg: 4.2,
      rating_count: 3,
    })
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/ca8c65e1-ffdd-45aa-8f58-b7709ed318de/rating",
        method: "POST",
        data: { rating: 5 },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
