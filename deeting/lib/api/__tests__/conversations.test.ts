import { fetchConversationHistory } from "@/lib/api/conversations"
import { request } from "@/lib/http"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>

describe("fetchConversationHistory", () => {
  afterEach(() => {
    mockRequest.mockReset()
  })

  it("returns parsed payload when response matches schema", async () => {
    const payload = {
      session_id: "session-1",
      messages: [{ role: "user", content: "hi", turn_index: 1 }],
      next_cursor: 1,
      has_more: true,
    }
    mockRequest.mockResolvedValue(payload)

    const result = await fetchConversationHistory("session-1")

    expect(result).toEqual(payload)
  })

  it("falls back to normalized payload when response is array", async () => {
    const payload = [
      { role: "user", content: "hi", turn_index: 1 },
      { role: "assistant", content: "hey", turn_index: 2 },
    ]
    mockRequest.mockResolvedValue(payload)

    const result = await fetchConversationHistory("session-legacy")

    expect(result).toEqual({
      session_id: "session-legacy",
      messages: payload,
      next_cursor: null,
      has_more: false,
    })
  })

  it("normalizes payload when schema mismatch occurs", async () => {
    const payload = {
      messages: ["bad", { role: "assistant", content: "ok", turn_index: 3 }],
      next_cursor: "9",
      has_more: "yes",
    }
    mockRequest.mockResolvedValue(payload)

    const result = await fetchConversationHistory("session-fallback")

    expect(result).toEqual({
      session_id: "session-fallback",
      messages: [{ role: "assistant", content: "ok", turn_index: 3 }],
      next_cursor: 9,
      has_more: false,
    })
  })
})
