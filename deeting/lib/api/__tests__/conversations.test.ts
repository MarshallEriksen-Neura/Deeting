import { fetchConversationHistory } from "@/lib/api/conversations"

describe("fetchConversationHistory", () => {
  it("requires tauri runtime", async () => {
    await expect(fetchConversationHistory("session-1")).rejects.toThrow(
      "Conversation APIs are only available in Tauri runtime"
    )
  })
})
