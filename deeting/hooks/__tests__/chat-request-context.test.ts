import { resolveAssistantRequestContext } from "@/hooks/chat/use-chat-messaging-service"

describe("resolveAssistantRequestContext", () => {
  it("should omit assistant_id on web even if assistant exists", () => {
    const ctx = resolveAssistantRequestContext({
      isTauriRuntime: false,
      activeAssistantId: "agent-1",
    })

    expect(ctx.assistantId).toBeUndefined()
    expect(ctx.sessionStorageKey).toBe("deeting-chat-session:router")
  })

  it("should include assistant_id on tauri", () => {
    const ctx = resolveAssistantRequestContext({
      isTauriRuntime: true,
      activeAssistantId: "agent-1",
    })

    expect(ctx.assistantId).toBe("agent-1")
    expect(ctx.sessionStorageKey).toBe("deeting-chat-session:agent-1")
  })
})
