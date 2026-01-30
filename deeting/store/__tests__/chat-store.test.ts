import { useChatStore, type ChatAssistant } from "../chat-store"

describe("useChatStore agent id normalization", () => {
  const resetStore = () => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()
  }

  beforeEach(() => {
    resetStore()
  })

  it("switchAgent should normalize object id to string", () => {
    useChatStore.getState().switchAgent({ id: "agent-123" } as unknown as string, null)

    expect(useChatStore.getState().agentId).toBe("agent-123")
  })

  it("switchAgent should ignore invalid id values", () => {
    useChatStore.getState().switchAgent({ name: "bad" } as unknown as string, null)

    expect(useChatStore.getState().agentId).toBeNull()
  })

  it("initSession should normalize object id when local agent is provided", async () => {
    const localAgent: ChatAssistant = {
      id: "agent-456",
      name: "Agent",
      desc: "",
      color: "from-indigo-500 to-purple-500",
    }

    await useChatStore
      .getState()
      .initSession({ id: "agent-456" } as unknown as string, null, localAgent)

    expect(useChatStore.getState().agentId).toBe("agent-456")
    expect(useChatStore.getState().agent?.id).toBe("agent-456")
  })

  it("initSession should clear messages when sessionId is removed", async () => {
    const localAgent: ChatAssistant = {
      id: "agent-789",
      name: "Agent",
      desc: "",
      color: "from-indigo-500 to-purple-500",
    }

    useChatStore.setState({
      agentId: "agent-789",
      agent: localAgent,
      sessionId: "session-1",
      initialized: true,
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "old",
          attachments: [],
          createdAt: 1,
        },
      ],
    })

    await useChatStore.getState().initSession("agent-789", null, localAgent)

    expect(useChatStore.getState().sessionId).toBeNull()
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it("initSession should allow empty agentId on web", async () => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()

    await useChatStore.getState().initSession("", null, null)

    expect(useChatStore.getState().initialized).toBe(true)
    expect(useChatStore.getState().agentId).toBeNull()
    expect(useChatStore.getState().agent).toBeNull()
    expect(useChatStore.getState().isLoading).toBe(false)
  })
})
