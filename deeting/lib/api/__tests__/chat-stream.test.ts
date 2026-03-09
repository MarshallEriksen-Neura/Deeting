import { streamDesktopLocalChatCompletion } from "@/lib/api/chat"
import { openSSE } from "@/lib/http"
import { collectLocalContext } from "@/lib/platform/context-collector"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  openSSE: jest.fn(),
  openApiSSE: jest.fn(),
  request: jest.fn(),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

jest.mock("@/lib/platform/context-collector", () => ({
  collectLocalContext: jest.fn().mockResolvedValue(null),
}))

const mockOpenSSE = openSSE as jest.MockedFunction<typeof openSSE>
const mockCollectLocalContext = collectLocalContext as jest.MockedFunction<typeof collectLocalContext>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("streamDesktopLocalChatCompletion", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue("http://127.0.0.1:4317")
  })

  afterEach(() => {
    mockOpenSSE.mockReset()
    mockCollectLocalContext.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("does not treat final completion message content as a streaming delta", async () => {
    mockCollectLocalContext.mockResolvedValue(null)
    mockOpenSSE.mockImplementation((_url, options) => {
      options.onMessage({
        data: {
          object: "chat.completion",
          choices: [
            {
              message: {
                role: "assistant",
                content: "早上好",
              },
            },
          ],
        },
      })
      options.onClose?.()
      return () => {}
    })

    const onDelta = jest.fn()
    const result = await streamDesktopLocalChatCompletion(
      {
        model: "kimi-k2.5",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      },
      { onDelta }
    )

    expect(onDelta).not.toHaveBeenCalled()
    expect(result).toBe("")
  })
})
