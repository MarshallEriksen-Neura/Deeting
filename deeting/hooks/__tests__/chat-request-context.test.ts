import { resolveChatRequestContext } from "@/hooks/chat/use-chat-messaging-service"

describe("resolveChatRequestContext", () => {
  it("should include assistant_id on web when assistant exists", () => {
    const ctx = resolveChatRequestContext({
      isTauriRuntime: false,
      selectedAssistantId: "agent-1",
    })

    expect(ctx.assistantId).toBe("agent-1")
    expect(ctx.sessionStorageKey).toBe("deeting-chat-session:router")
  })

  it("should omit assistant_id on tauri", () => {
    const ctx = resolveChatRequestContext({
      isTauriRuntime: true,
      selectedAssistantId: "agent-1",
    })

    expect(ctx.assistantId).toBeUndefined()
    expect(ctx.sessionStorageKey).toBe("deeting-chat-session:router")
  })
})
