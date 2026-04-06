import { resolveChatRequestContext } from "@/hooks/chat/use-chat-messaging-service"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("resolveChatRequestContext", () => {
  it("always omits assistant_id now that chat no longer carries assistant identity", () => {
    const ctx = resolveChatRequestContext({
      isTauriRuntime: false,
    })

    expect(ctx.assistantId).toBeUndefined()
    expect(ctx.sessionStorageKey).toBe("deeting-chat-session:router")
  })
})
