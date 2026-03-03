import { createTraceFeedback } from "@/lib/api/feedback"
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

describe("feedback api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("creates trace feedback via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      id: "feedback-local-1",
      trace_id: "trace-local-1",
      score: -1,
      comment: null,
      tags: null,
      created_at: "2026-03-03T00:00:00Z",
    } as unknown)

    const result = await createTraceFeedback({
      trace_id: "trace-local-1",
      score: -1,
    })

    expect(result.trace_id).toBe("trace-local-1")
    expect(mockInvoke).toHaveBeenCalledWith("create_local_trace_feedback", {
      payload: {
        trace_id: "trace-local-1",
        score: -1,
        comment: null,
        tags: null,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("creates trace feedback via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      id: "feedback-web-1",
      trace_id: "trace-web-1",
      score: 1,
      comment: "good",
      tags: ["quality"],
      created_at: "2026-03-03T00:01:00Z",
    })

    const result = await createTraceFeedback({
      trace_id: "trace-web-1",
      score: 1,
      comment: "good",
      tags: ["quality"],
    })

    expect(result.trace_id).toBe("trace-web-1")
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/feedback",
      method: "POST",
      data: {
        trace_id: "trace-web-1",
        score: 1,
        comment: "good",
        tags: ["quality"],
      },
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

