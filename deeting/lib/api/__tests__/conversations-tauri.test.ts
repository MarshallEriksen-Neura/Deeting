import { fetchConversationSessions, fetchConversationWindow } from "@/lib/api/conversations"
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

describe("conversation tauri apis", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches conversation window via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      session_id: "session-local-1",
      messages: [{ role: "user", content: "hi", turn_index: 1 }],
      meta: { message_count: 1, status: "active" },
      summary: { version: 1, summary_text: "summary" },
    } as unknown)

    const result = await fetchConversationWindow("session-local-1")

    expect(result).toEqual({
      session_id: "session-local-1",
      messages: [{ role: "user", content: "hi", turn_index: 1 }],
      meta: { message_count: 1, status: "active" },
      summary: { version: 1, summary_text: "summary" },
    })
    expect(mockInvoke).toHaveBeenCalledWith("get_local_conversation_window", {
      session_id: "session-local-1",
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("falls back to local history command when window command fails", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockRejectedValueOnce(new Error("window command unavailable"))
      .mockResolvedValueOnce({
        session_id: "session-local-2",
        messages: [{ role: "assistant", content: "reply", turn_index: 2 }],
        next_cursor: null,
        has_more: false,
      } as unknown)

    const result = await fetchConversationWindow("session-local-2")

    expect(result).toEqual({
      session_id: "session-local-2",
      messages: [{ role: "assistant", content: "reply", turn_index: 2 }],
      meta: null,
      summary: null,
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_local_conversation_window", {
      session_id: "session-local-2",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "list_local_conversation_history", {
      query: { session_id: "session-local-2", limit: 200 },
    })
  })

  it("fetches conversation sessions via tauri command with summary text", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      items: [
        {
          session_id: "session-local-3",
          title: "title",
          summary_text: "summary text",
          message_count: 3,
          first_message_at: "2026-03-03T00:00:00Z",
          last_active_at: "2026-03-03T00:01:00Z",
        },
      ],
      next_page: null,
      previous_page: null,
    } as unknown)

    const result = await fetchConversationSessions({ size: 10, status: "active" })

    expect(result.items[0]?.summary_text).toBe("summary text")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_conversations", {
      query: {
        cursor: null,
        size: 10,
        assistant_id: null,
        status: "active",
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("falls back to web conversation sessions outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      items: [],
      next_page: null,
      previous_page: null,
    })

    await fetchConversationSessions({ size: 5 })

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/internal/conversations",
        method: "GET",
        params: { size: 5 },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
