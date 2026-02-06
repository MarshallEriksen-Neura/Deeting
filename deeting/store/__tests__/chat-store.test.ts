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

  it("setMessageBlocks should sync assistant content from text blocks", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "legacy-content",
          createdAt: 1,
          blocks: [],
        },
      ],
    })

    useChatStore.getState().setMessageBlocks("assistant-1", [
      { type: "text", content: "hello " } as any,
      { type: "text", content: "world" } as any,
      { type: "thought", content: "hidden" } as any,
    ])

    const message = useChatStore.getState().messages[0]
    expect(message?.content).toBe("hello world")
    expect(message?.blocks).toHaveLength(3)
  })

  it("appendMessageBlocks should keep assistant content in sync", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-2",
          role: "assistant",
          content: "",
          createdAt: 1,
          blocks: [{ id: "assistant-2-block-0", type: "text", content: "A" }],
        },
      ],
    })

    useChatStore.getState().appendMessageBlocks("assistant-2", [
      { type: "text", content: "B" } as any,
      { type: "tool_result", callId: "call-1", status: "success", result: "ok" } as any,
    ])

    const message = useChatStore.getState().messages[0]
    expect(message?.content).toBe("AB")
    expect(message?.blocks?.some((block) => block.type === "tool_result")).toBe(true)
  })

  it("setMessageBlocks should clear assistant content when no text block exists", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-3",
          role: "assistant",
          content: "old-text",
          createdAt: 1,
          blocks: [],
        },
      ],
    })

    useChatStore.getState().setMessageBlocks("assistant-3", [
      { type: "thought", content: "thinking" } as any,
      { type: "tool_call", toolName: "search_web", toolArgs: "{\"q\":\"x\"}" } as any,
    ])

    const message = useChatStore.getState().messages[0]
    expect(message?.content).toBe("")
    expect(message?.blocks).toHaveLength(2)
  })

  it("mergeMessageMeta should update trace_id without mutating content", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-4",
          role: "assistant",
          content: "hello",
          createdAt: 1,
          metaInfo: { request_id: "req-1" },
          blocks: [{ id: "assistant-4-block-0", type: "text", content: "hello" }],
        },
      ],
    })

    useChatStore.getState().mergeMessageMeta("assistant-4", { trace_id: "trace-1" })

    const message = useChatStore.getState().messages[0]
    expect(message?.content).toBe("hello")
    expect(message?.metaInfo).toMatchObject({
      request_id: "req-1",
      trace_id: "trace-1",
    })
  })
})
