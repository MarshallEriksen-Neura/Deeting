import {
  fetchImageGenerationTask,
  fetchImageGenerationTasks,
} from "@/lib/api/image-generation"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>

describe("image generation api", () => {
  afterEach(() => {
    mockRequest.mockReset()
  })

  it("fetches image generation tasks from the internal endpoint", async () => {
    mockRequest.mockResolvedValue({
      items: [
        {
          task_id: "task-1",
          status: "succeeded",
          model: "gpt-image-1",
          session_id: "session-1",
          prompt: "Draw a mountain village at dusk",
          prompt_encrypted: false,
          negative_prompt: null,
          aspect_ratio: "1:1",
          steps: 30,
          cfg_scale: 6,
          seed: 42,
          provider_model_id: "provider-1",
          created_at: "2026-05-10T10:00:00Z",
          updated_at: "2026-05-10T10:01:00Z",
          completed_at: "2026-05-10T10:01:10Z",
          error_code: null,
          error_message: null,
          preview: {
            output_index: 0,
            asset_url: "asset://image-1.png",
            source_url: null,
            seed: 42,
            content_type: "image/png",
            size_bytes: 1024,
            width: 1024,
            height: 1024,
          },
        },
      ],
      next_page: null,
      previous_page: null,
    } as never)

    const result = await fetchImageGenerationTasks({
      session_id: "session-1",
      size: 24,
      include_outputs: true,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.task_id).toBe("task-1")
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/internal/images/generations",
        method: "GET",
        params: {
          session_id: "session-1",
          size: 24,
          include_outputs: true,
        },
      })
    )
  })

  it("fetches image generation detail with include_outputs", async () => {
    mockRequest.mockResolvedValue({
      task_id: "task-1",
      status: "succeeded",
      model: "gpt-image-1",
      created_at: "2026-05-10T10:00:00Z",
      updated_at: "2026-05-10T10:01:00Z",
      completed_at: "2026-05-10T10:01:10Z",
      error_code: null,
      error_message: null,
      outputs: [
        {
          output_index: 0,
          asset_url: "asset://image-1.png",
          source_url: null,
          seed: 42,
          content_type: "image/png",
          size_bytes: 1024,
          width: 1024,
          height: 1024,
        },
      ],
    } as never)

    const result = await fetchImageGenerationTask("task-1")

    expect(result.outputs).toHaveLength(1)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/internal/images/generations/task-1",
        method: "GET",
        params: { include_outputs: true },
      })
    )
  })
})
