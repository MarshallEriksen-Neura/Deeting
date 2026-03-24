import { fetchImageGenerationTask } from "@/lib/api/image-generation"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
  openApiSSE: jest.fn(),
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

describe("image generation api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches a local image generation task via the tauri taskId contract", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      task_id: "task-1",
      status: "completed",
      model: "flux.1-dev",
      created_at: "2026-03-24T00:00:00Z",
      updated_at: "2026-03-24T00:01:00Z",
      completed_at: "2026-03-24T00:01:00Z",
      outputs: [],
    } as never)

    const result = await fetchImageGenerationTask("task-1")

    expect(result.task_id).toBe("task-1")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_image_generation_task", {
      taskId: "task-1",
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
