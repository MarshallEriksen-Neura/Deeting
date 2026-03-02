import {
  clearConversation,
  deleteConversationMessage,
  regenerateConversationReply,
  sendConversationMessage,
} from "@/lib/api/conversations"
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

describe("conversation mutation apis", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("deletes a conversation message via web endpoint", async () => {
    mockRequest.mockResolvedValue({
      session_id: "session-1",
      turn_index: 2,
      deleted: true,
    })

    const result = await deleteConversationMessage("session-1", 2)

    expect(result).toEqual({
      session_id: "session-1",
      turn_index: 2,
      deleted: true,
    })
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/internal/conversations/session-1/messages/2",
        method: "DELETE",
      })
    )
  })

  it("clears a conversation via web endpoint", async () => {
    mockRequest.mockResolvedValue({
      session_id: "session-2",
      cleared: true,
    })

    const result = await clearConversation("session-2")

    expect(result).toEqual({
      session_id: "session-2",
      cleared: true,
    })
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/internal/conversations/session-2/clear",
        method: "POST",
      })
    )
  })

  it("normalizes regenerate response from web endpoint", async () => {
    mockRequest.mockResolvedValue({
      session_id: "session-3",
      choices: [{ message: { content: "new reply" } }],
    })

    const result = await regenerateConversationReply("session-3", {
      model: "gpt-4o",
      temperature: 0.7,
      max_tokens: 512,
    })

    expect(result).toEqual({
      session_id: "session-3",
      deleted_turn_index: null,
      message: {
        role: "assistant",
        content: "new reply",
        turn_index: null,
        created_at: null,
        is_truncated: null,
        name: null,
        meta_info: null,
      },
    })
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/internal/conversations/session-3/regenerate",
        method: "POST",
        data: {
          model: "gpt-4o",
          temperature: 0.7,
          max_tokens: 512,
        },
      })
    )
  })

  it("sends conversation message via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    mockInvoke.mockResolvedValue({
      session_id: "session-local-1",
      user_message: {
        role: "user",
        content: "hello",
        turn_index: 1,
      },
      assistant_message: {
        role: "assistant",
        content: "hi",
        turn_index: 2,
      },
    } as unknown)

    const result = await sendConversationMessage("session-local-1", {
      content: "hello",
      model: "gpt-4o",
      provider_model_id: "provider-model-id",
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 256,
    })

    expect(result).toEqual({
      session_id: "session-local-1",
      user_message: {
        role: "user",
        content: "hello",
        turn_index: 1,
      },
      assistant_message: {
        role: "assistant",
        content: "hi",
        turn_index: 2,
      },
    })
    expect(mockInvoke).toHaveBeenCalledWith("send_local_conversation_message", {
      session_id: "session-local-1",
      payload: {
        content: "hello",
        model: "gpt-4o",
        provider_model_id: "provider-model-id",
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 256,
      },
    })
  })

  it("throws when sendConversationMessage is called outside tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    await expect(
      sendConversationMessage("session-web-1", {
        content: "hello",
        model: "gpt-4o",
      })
    ).rejects.toThrow("sendConversationMessage is only supported in Tauri runtime")
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
