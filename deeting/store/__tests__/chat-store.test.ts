import { useChatStore, type ChatAssistant } from "../chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"

describe("useChatStore selected assistant normalization", () => {
  const resetStore = () => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()
  }

  beforeEach(() => {
    resetStore()
  })

  it("switchSelectedAssistant should normalize object id to string", () => {
    useChatStore.getState().switchSelectedAssistant({ id: "agent-123" } as unknown as string, null)

    expect(useChatStore.getState().selectedAssistantId).toBe("agent-123")
  })

  it("switchSelectedAssistant should ignore invalid id values", () => {
    useChatStore.getState().switchSelectedAssistant({ name: "bad" } as unknown as string, null)

    expect(useChatStore.getState().selectedAssistantId).toBeNull()
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

    expect(useChatStore.getState().selectedAssistantId).toBe("agent-456")
    expect(useChatStore.getState().selectedAssistant?.id).toBe("agent-456")
  })

  it("initSession should clear messages when sessionId is removed", async () => {
    const localAgent: ChatAssistant = {
      id: "agent-789",
      name: "Agent",
      desc: "",
      color: "from-indigo-500 to-purple-500",
    }

    useChatStore.setState({
      selectedAssistantId: "agent-789",
      selectedAssistant: localAgent,
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

  it("initSession should allow empty selectedAssistantId on web", async () => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()

    await useChatStore.getState().initSession("", null, null)

    expect(useChatStore.getState().initialized).toBe(true)
    expect(useChatStore.getState().selectedAssistantId).toBeNull()
    expect(useChatStore.getState().selectedAssistant).toBeNull()
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

  it("appendMessageBlocks should replace the matching tool call by callId", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-tool-call-1",
          role: "assistant",
          content: "",
          createdAt: 1,
          blocks: [
            {
              id: "call-1-old",
              type: "tool_call",
              callId: "call-1",
              toolName: "skill.official.skills.crawler.fetch_web_content",
              status: "running",
            } as MessageBlock,
          ],
        },
      ],
    })

    useChatStore.getState().appendMessageBlocks("assistant-tool-call-1", [
      {
        id: "call-1-new",
        type: "tool_call",
        callId: "call-1",
        toolName: "skill.official.skills.crawler.fetch_web_content",
        status: "error",
      } as MessageBlock,
    ])

    const message = useChatStore.getState().messages[0]
    const toolCalls = message?.blocks?.filter((block) => block.type === "tool_call") ?? []

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({
      id: "call-1-old",
      callId: "call-1",
      status: "error",
    })
  })

  it("appendMessageBlocks should keep a matching tool call in requires_approval state", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-tool-call-approval-1",
          role: "assistant",
          content: "",
          createdAt: 1,
          blocks: [
            {
              id: "call-approval-1",
              type: "tool_call",
              callId: "call-approval-1",
              toolName: "skill.official.skills.crawler.fetch_web_content",
              status: "running",
            } as MessageBlock,
          ],
        },
      ],
    })

    useChatStore.getState().appendMessageBlocks("assistant-tool-call-approval-1", [
      {
        id: "result-approval-1",
        type: "tool_result",
        callId: "call-approval-1",
        toolName: "skill.official.skills.crawler.fetch_web_content",
        status: "requires_approval",
        result: {
          status: "REQUIRES_APPROVAL",
          approval_token: "approval-1",
        },
      } as MessageBlock,
    ])

    const message = useChatStore.getState().messages[0]
    const toolCall = message?.blocks?.find((block) => block.type === "tool_call")
    const toolResult = message?.blocks?.find((block) => block.type === "tool_result")

    expect(toolCall).toMatchObject({ status: "requires_approval" })
    expect(toolResult).toMatchObject({ status: "requires_approval" })
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

  it("setMessageBlocks should ignore whitespace-only text and thought blocks", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-5",
          role: "assistant",
          content: "",
          createdAt: 1,
          blocks: [],
        },
      ],
    })

    useChatStore.getState().setMessageBlocks("assistant-5", [
      { type: "text", content: "   \n\t" } as any,
      { type: "thought", content: "\n\n" } as any,
      { type: "tool_call", toolName: "tavily-search", status: "running" } as any,
    ])

    const message = useChatStore.getState().messages[0]
    expect(message?.content).toBe("")
    expect(message?.blocks).toHaveLength(1)
    expect(message?.blocks?.[0]?.type).toBe("tool_call")
  })

  it("appendMessageBlocks should ignore whitespace-only text blocks", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-6",
          role: "assistant",
          content: "A",
          createdAt: 1,
          blocks: [{ id: "assistant-6-block-0", type: "text", content: "A" }],
        },
      ],
    })

    useChatStore.getState().appendMessageBlocks("assistant-6", [
      { type: "text", content: "\n\n" } as any,
      { type: "text", content: "B" } as any,
    ])

    const message = useChatStore.getState().messages[0]
    expect(message?.content).toBe("AB")
    expect(message?.blocks?.filter((block) => block.type === "text")).toHaveLength(1)
  })

  it("upsertMessageToolResult should replace the matching tool result by callId", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-7",
          role: "assistant",
          content: "",
          createdAt: 1,
          blocks: [
            { id: "call-7", type: "tool_call", callId: "call-7", toolName: "crawl_website", status: "running" } as MessageBlock,
            {
              id: "result-7-old",
              type: "tool_result",
              callId: "call-7",
              toolName: "crawl_website",
              status: "error",
              result: { status: "REQUIRES_APPROVAL" },
            } as MessageBlock,
          ],
        },
      ],
    })

    useChatStore.getState().upsertMessageToolResult("assistant-7", {
      id: "result-7-new",
      type: "tool_result",
      callId: "call-7",
      toolName: "crawl_website",
      status: "success",
      result: { ok: true },
    })

    const message = useChatStore.getState().messages[0]
    const toolResults = message?.blocks?.filter((block) => block.type === "tool_result") ?? []
    const toolCall = message?.blocks?.find((block) => block.type === "tool_call")

    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({
      id: "result-7-old",
      callId: "call-7",
      status: "success",
      result: { ok: true },
    })
    expect(toolCall).toMatchObject({ status: "success" })
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

  it("should manage compare candidates without mutating canonical messages", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-compare-1",
          role: "assistant",
          content: "baseline",
          createdAt: 1,
          blocks: [{ id: "baseline-block", type: "text", content: "baseline" } as any],
        },
      ],
    })

    useChatStore.getState().ensureCompareState("assistant-compare-1", {
      modelKey: "model-a",
      modelId: "model-a",
      content: "baseline",
      blocks: [{ id: "baseline-block", type: "text", content: "baseline" } as any],
      loading: false,
      baseline: true,
    })

    useChatStore.getState().upsertCompareCandidate("assistant-compare-1", {
      modelKey: "model-b",
      modelId: "model-b",
      content: "",
      blocks: [],
      loading: true,
    })
    useChatStore.getState().appendCompareCandidateBlocks("assistant-compare-1", "model-b", [
      { type: "text", content: "candidate" } as any,
    ])
    useChatStore.getState().setCompareActiveCandidate("assistant-compare-1", "model-b")

    const state = useChatStore.getState().compareByMessageId["assistant-compare-1"]
    expect(state?.baselineModelKey).toBe("model-a")
    expect(state?.activeModelKey).toBe("model-b")
    expect(state?.candidates["model-b"]?.content).toBe("candidate")
    expect(useChatStore.getState().messages[0]?.content).toBe("baseline")
  })

  it("should clear compare state when target message disappears", () => {
    useChatStore.getState().ensureCompareState("assistant-compare-2", {
      modelKey: "model-a",
      modelId: "model-a",
      content: "baseline",
      blocks: [{ id: "baseline-block", type: "text", content: "baseline" } as any],
      loading: false,
      baseline: true,
    })

    useChatStore.getState().setMessages([
      {
        id: "assistant-other",
        role: "assistant",
        content: "other",
        createdAt: 2,
      },
    ])

    expect(useChatStore.getState().compareByMessageId["assistant-compare-2"]).toBeUndefined()
  })

  it("setStatus should skip duplicate status payloads", () => {
    const listener = jest.fn()
    const unsubscribe = useChatStore.subscribe(listener)

    useChatStore.getState().setStatus({
      stage: "listen",
      code: "upstream.streaming",
      meta: { repeat_count: 1 },
    })
    useChatStore.getState().setStatus({
      stage: "listen",
      code: "upstream.streaming",
      meta: { repeat_count: 1 },
    })

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("setStatus should update when repeat_count changes", () => {
    const listener = jest.fn()
    const unsubscribe = useChatStore.subscribe(listener)

    useChatStore.getState().setStatus({
      stage: "listen",
      code: "upstream.streaming",
      meta: { repeat_count: 1 },
    })
    useChatStore.getState().setStatus({
      stage: "listen",
      code: "upstream.streaming",
      meta: { repeat_count: 2 },
    })

    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
