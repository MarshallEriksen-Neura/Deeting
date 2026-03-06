import {
  clearConversation,
  deleteConversationMessage,
  regenerateConversationReply,
} from "@/lib/api/conversations"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>

describe("conversation mutation apis", () => {
  afterEach(() => {
    mockRequest.mockReset()
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

  it("clears a conversation via endpoint", async () => {
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

  it("normalizes regenerate response", async () => {
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
})
