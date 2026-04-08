import { useChatStore } from "../chat-store"
import type { MessageBlock } from "@/lib/chat/message-protocol"

describe("useChatStore session state", () => {
  const resetStore = () => {
    localStorage.clear()
    sessionStorage.clear()
    useChatStore.getState().resetSession()
  }

  beforeEach(() => {
    resetStore()
  })

  it("initSession initializes an empty session without assistant identity", async () => {
    await useChatStore.getState().initSession(null)

    expect(useChatStore.getState().sessionId).toBeNull()
    expect(useChatStore.getState().initialized).toBe(true)
  })

  it("initSession should clear messages when sessionId is removed", async () => {
    useChatStore.setState({
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

    await useChatStore.getState().initSession(null)

    expect(useChatStore.getState().sessionId).toBeNull()
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it("initSession should allow empty session on web", async () => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()

    await useChatStore.getState().initSession(null)

    expect(useChatStore.getState().initialized).toBe(true)
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it("setMessageBlocks should keep assistant content empty even when text blocks exist", () => {
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
    expect(message?.content).toBe("")
    expect(message?.blocks).toHaveLength(3)
  })

  it("appendMessageBlocks should keep assistant content empty", () => {
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
    expect(message?.content).toBe("")
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
    expect(message?.content).toBe("")
    expect(message?.blocks?.filter((block) => block.type === "text")).toHaveLength(1)
  })

  it("appendMessageBlocks should replace matching execution lifecycle blocks by root_execution_id", () => {
    useChatStore.setState({
      messages: [
        {
          id: "assistant-exec-1",
          role: "assistant",
          content: "",
          createdAt: 1,
          blocks: [
            {
              id: "exec-ui-old",
              type: "ui",
              viewType: "execution.lifecycle",
              payload: {
                schema_version: 1,
                root_execution_id: "exec-root-1",
                execution_id: "exec-root-1",
                execution_status: "running",
              },
            } as MessageBlock,
          ],
        },
      ],
    })

    useChatStore.getState().appendMessageBlocks("assistant-exec-1", [
      {
        id: "exec-ui-new",
        type: "ui",
        viewType: "execution.lifecycle",
        payload: {
          schema_version: 1,
          root_execution_id: "exec-root-1",
          execution_id: "exec-root-1",
          execution_status: "integrated",
        },
      } as MessageBlock,
    ])

    const message = useChatStore.getState().messages[0]
    const executionBlocks =
      message?.blocks?.filter(
        (block) => block.type === "ui" && block.viewType === "execution.lifecycle"
      ) ?? []

    expect(executionBlocks).toHaveLength(1)
    expect(executionBlocks[0]).toMatchObject({
      id: "exec-ui-old",
      payload: expect.objectContaining({
        execution_status: "integrated",
      }),
    })
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
          content: "",
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
    expect(useChatStore.getState().messages[0]?.content).toBe("")
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
