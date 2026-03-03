import { previewAssistant } from "@/lib/api/assistants"
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

describe("assistant preview api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("previews assistant via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({ content: "local reply" } as unknown)

    const result = await previewAssistant("ca8c65e1-ffdd-45aa-8f58-b7709ed318de", {
      message: "hello",
      stream: false,
      temperature: 0.7,
      max_tokens: 128,
    })

    expect(result?.choices?.[0]?.message?.content).toBe("local reply")
    expect(mockInvoke).toHaveBeenCalledWith("preview_local_assistant", {
      assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      payload: {
        message: "hello",
        stream: false,
        temperature: 0.7,
        max_tokens: 128,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("previews assistant via web endpoint outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      choices: [{ message: { content: "cloud reply" } }],
    })

    const result = await previewAssistant("ca8c65e1-ffdd-45aa-8f58-b7709ed318de", {
      message: "hello",
    })

    expect(result?.choices?.[0]?.message?.content).toBe("cloud reply")
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/ca8c65e1-ffdd-45aa-8f58-b7709ed318de/preview",
        method: "POST",
        data: { message: "hello" },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
