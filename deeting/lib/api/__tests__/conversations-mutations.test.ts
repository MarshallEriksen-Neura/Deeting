import {
  clearConversation,
  deleteConversationMessage,
  regenerateConversationReply,
} from "@/lib/api/conversations"

describe("conversation mutation apis", () => {
  it("requires tauri runtime for delete", async () => {
    await expect(deleteConversationMessage("session-1", 2)).rejects.toThrow(
      "Conversation APIs are only available in Tauri runtime"
    )
  })

  it("requires tauri runtime for clear", async () => {
    await expect(clearConversation("session-2")).rejects.toThrow(
      "Conversation APIs are only available in Tauri runtime"
    )
  })

  it("requires tauri runtime for regenerate", async () => {
    await expect(
      regenerateConversationReply("session-3", {
        model: "gpt-4o",
        temperature: 0.7,
        max_tokens: 512,
      })
    ).rejects.toThrow("Conversation APIs are only available in Tauri runtime")
  })
})
