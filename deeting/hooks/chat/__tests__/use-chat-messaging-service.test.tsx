"use client"

import { act, renderHook, waitFor } from "@testing-library/react"
import {
  cancelChatCompletion,
  cancelDesktopLocalChatCompletion,
  finalizeDesktopLocalCompare,
  streamChatCompletion,
  streamDesktopLocalChatCompletion,
} from "@/lib/api/chat"
import {
  fetchConversationHistory,
} from "@/lib/api/conversations"
import { listCustomTaskAgents } from "@/lib/api/custom-task-agents"
import { useChatMessagingService } from "@/hooks/chat/use-chat-messaging-service"
import { useChatStore } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/lib/api/custom-task-agents", () => ({
  listCustomTaskAgents: jest.fn().mockResolvedValue([]),
}))

jest.mock("@/lib/api/conversations", () => ({
  fetchConversationHistory: jest.fn(),
}))

jest.mock("@/lib/api/chat", () => ({
  cancelChatCompletion: jest.fn(),
  cancelDesktopLocalChatCompletion: jest.fn(),
  finalizeDesktopLocalCompare: jest.fn(),
  streamChatCompletion: jest.fn(),
  streamDesktopLocalChatCompletion: jest.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mockStreamChatCompletion =
  streamChatCompletion as jest.MockedFunction<typeof streamChatCompletion>
const mockStreamDesktopLocalChatCompletion =
  streamDesktopLocalChatCompletion as jest.MockedFunction<
    typeof streamDesktopLocalChatCompletion
  >
const mockCancelChatCompletion =
  cancelChatCompletion as jest.MockedFunction<typeof cancelChatCompletion>
const mockCancelDesktopLocalChatCompletion =
  cancelDesktopLocalChatCompletion as jest.MockedFunction<
    typeof cancelDesktopLocalChatCompletion
  >
const mockFinalizeDesktopLocalCompare =
  finalizeDesktopLocalCompare as jest.MockedFunction<typeof finalizeDesktopLocalCompare>
const mockFetchConversationHistory =
  fetchConversationHistory as jest.MockedFunction<typeof fetchConversationHistory>
const mockListCustomTaskAgents =
  listCustomTaskAgents as jest.MockedFunction<typeof listCustomTaskAgents>
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("useChatMessagingService pending takeover orchestration", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockStreamChatCompletion.mockReset()
    mockStreamDesktopLocalChatCompletion.mockReset()
    mockCancelChatCompletion.mockReset()
    mockCancelDesktopLocalChatCompletion.mockReset()
    mockFinalizeDesktopLocalCompare.mockReset()
    mockFetchConversationHistory.mockReset()
    mockListCustomTaskAgents.mockReset()
    mockListCustomTaskAgents.mockResolvedValue([])
    useChatRuntimeStore.getState().resetSession()
    useChatStore.setState({
      models: [{ id: "model-1", provider_model_id: "model-1" }],
      config: {
        model: "model-1",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
    })
    useChatRuntimeStore.setState({
      sessionId: "session-1",
      initialized: true,
      isLoading: false,
      globalLoading: false,
      activeMessageId: null,
      interruptedMessageId: null,
      statusMessageId: null,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
      errorMessage: null,
      historyCursor: null,
      historyHasMore: false,
      pendingTakeover: null,
      pendingTakeoverRequestedAction: null,
    })
  })

  it("queues a pending takeover from the current draft", () => {
    useChatStore.setState({
      input: "follow-up prompt",
      attachments: [{ id: "att-1", kind: "image" } as any],
      selectedKnowledgeFileIds: ["doc-1"],
    })
    useChatRuntimeStore.setState({ isLoading: true })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      result.current.queuePendingTakeoverFromCurrentDraft()
    })

    expect(useChatRuntimeStore.getState().pendingTakeover).toEqual(
      expect.objectContaining({
        input: "follow-up prompt",
        attachments: [{ id: "att-1", kind: "image" }],
        selectedKnowledgeFileIds: ["doc-1"],
      })
    )
  })

  it("uses pool selection plus preferred provider member for desktop local chat requests", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    mockStreamDesktopLocalChatCompletion.mockResolvedValueOnce("")

    useChatStore.setState({
      models: [
        {
          id: "qwen-local",
          provider_model_id: "provider-local-1",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "qwen-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "hello desktop",
    })
    useChatRuntimeStore.setState({ sessionId: "session-local-1", isLoading: false })

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.sendMessage()
    })

    expect(mockStreamDesktopLocalChatCompletion).toHaveBeenCalledTimes(1)
    const payload = mockStreamDesktopLocalChatCompletion.mock.calls[0]?.[0]
    expect(payload?.model).toBe("qwen-local")
    expect(payload?.model_selection_mode).toBe("pool")
    expect(payload?.provider_model_id).toBe("provider-local-1")

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("injects transient browser page context into the outgoing local request and user message meta", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    mockStreamDesktopLocalChatCompletion.mockResolvedValueOnce("")

    useChatStore.setState({
      models: [
        {
          id: "qwen-local",
          provider_model_id: "provider-local-1",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "qwen-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "What is this page explaining?",
      pageContext: {
        tabId: 42,
        title: "MIT 18.06 Linear Algebra Notes",
        url: "https://linalg.apachecn.org/chapter01/",
        host: "linalg.apachecn.org",
        headingsSummary: ["第一讲：方程组的几何解释"],
        mainTextSnippet: "Linear equations with intersecting lines.",
        visibleTextSnippet: "We call the first vector col1.",
        capturedAt: 1,
      },
    })
    useChatRuntimeStore.setState({ sessionId: "session-local-ctx-1", isLoading: false })

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.sendMessage()
    })

    const payload = mockStreamDesktopLocalChatCompletion.mock.calls[0]?.[0]
    expect(payload?.messages?.[0]).toMatchObject({
      role: "system",
    })
    expect(JSON.stringify(payload?.messages?.[0]?.content ?? "")).toContain(
      "MIT 18.06 Linear Algebra Notes"
    )
    expect(useChatStore.getState().messages[0]?.metaInfo).toMatchObject({
      page_context: {
        title: "MIT 18.06 Linear Algebra Notes",
        url: "https://linalg.apachecn.org/chapter01/",
        host: "linalg.apachecn.org",
      },
    })
    expect(useChatStore.getState().pageContext).toBeNull()

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("converts a leading task-agent mention into explicit_task_agent_id for local requests", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    mockStreamDesktopLocalChatCompletion.mockResolvedValueOnce("")
    mockListCustomTaskAgents.mockResolvedValueOnce([
      { id: "agent-image-1", name: "Image Agent" } as any,
    ])

    useChatStore.setState({
      models: [
        {
          id: "qwen-local",
          provider_model_id: "provider-local-1",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "qwen-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "@Image Agent 画一只长翅膀的猫",
    })
    useChatRuntimeStore.setState({ sessionId: "session-local-mention-1", isLoading: false })

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.sendMessage()
    })

    const payload = mockStreamDesktopLocalChatCompletion.mock.calls[0]?.[0]
    expect(payload?.explicit_task_agent_id).toBe("agent-image-1")
    expect(JSON.stringify(payload?.messages ?? [])).toContain("画一只长翅膀的猫")
    expect(JSON.stringify(payload?.messages ?? [])).not.toContain("@Image Agent")
    expect(useChatStore.getState().messages[0]?.metaInfo).toMatchObject({
      display_content: "@Image Agent 画一只长翅膀的猫",
    })

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("keeps approval-required status active after a local request pauses for tool approval", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    mockStreamDesktopLocalChatCompletion.mockImplementationOnce(async (_payload, handlers) => {
      handlers?.onMessage?.({
        type: "blocks",
        blocks: [
          {
            id: "call-approval-1",
            type: "tool_call",
            callId: "call-approval-1",
            toolName: "shell_execute",
            status: "running",
          },
          {
            id: "result-approval-1",
            type: "tool_result",
            callId: "call-approval-1",
            toolName: "shell_execute",
            status: "requires_approval",
            result: {
              status: "REQUIRES_APPROVAL",
              approval_token: "approval-1",
            },
          },
        ],
      })
      return ""
    })

    useChatStore.setState({
      models: [
        {
          id: "qwen-local",
          provider_model_id: "provider-local-1",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "qwen-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "check local folder",
    })
    useChatRuntimeStore.setState({ sessionId: "session-local-approval-1", isLoading: false })

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.sendMessage()
    })

    expect(useChatRuntimeStore.getState().statusStage).toBe("render")
    expect(useChatRuntimeStore.getState().statusCode).toBe("approval.required")
    expect(useChatStore.getState().messages.at(-1)?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          callId: "call-approval-1",
          status: "requires_approval",
        }),
        expect.objectContaining({
          type: "tool_result",
          callId: "call-approval-1",
          status: "requires_approval",
        }),
      ])
    )

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("cancels the active request and sends the pending takeover draft", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    const firstRequest = createDeferred<string>()
    mockStreamDesktopLocalChatCompletion.mockImplementationOnce(async (_payload, _handlers, control) => {
      control?.onCancel?.(() => {
        firstRequest.resolve("")
      })
      return firstRequest.promise
    })
    mockStreamDesktopLocalChatCompletion.mockImplementationOnce(async () => "")
    mockCancelDesktopLocalChatCompletion.mockResolvedValue({
      request_id: "request-1",
      status: "cancelled",
    })

    useChatStore.setState({
      models: [
        {
          id: "model-local",
          provider_model_id: "model-local",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "model-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "initial prompt",
    })
    useChatRuntimeStore.setState({
      sessionId: "session-local-1",
      isLoading: false,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      void result.current.sendMessage()
    })

    await waitFor(() => {
      expect(useChatRuntimeStore.getState().isLoading).toBe(true)
    })

    act(() => {
      useChatStore.setState({
        input: "follow-up prompt",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-2"],
      })
    })

    act(() => {
      result.current.queuePendingTakeoverFromCurrentDraft()
    })

    await act(async () => {
      await result.current.stopAndSendPendingTakeover()
    })

    await waitFor(() => {
      expect(mockCancelDesktopLocalChatCompletion).toHaveBeenCalledTimes(1)
      expect(mockStreamDesktopLocalChatCompletion).toHaveBeenCalledTimes(2)
    })

    const secondPayload = mockStreamDesktopLocalChatCompletion.mock.calls[1]?.[0]
    expect(JSON.stringify(secondPayload?.messages ?? [])).toContain("follow-up prompt")
    expect(useChatStore.getState().pendingTakeover).toBeNull()
    expect(useChatStore.getState().input).toBe("")
    expect(useChatStore.getState().selectedKnowledgeFileIds).toEqual([])

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("does not double-dispatch when immediate stop consumes a deferred takeover", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    const firstRequest = createDeferred<string>()
    mockStreamDesktopLocalChatCompletion.mockImplementationOnce(async (_payload, _handlers, control) => {
      control?.onCancel?.(() => {
        firstRequest.resolve("")
      })
      return firstRequest.promise
    })
    mockStreamDesktopLocalChatCompletion.mockImplementation(async () => "")

    useChatStore.setState({
      models: [
        {
          id: "model-local",
          provider_model_id: "model-local",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "model-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "initial prompt",
    })
    useChatRuntimeStore.setState({
      sessionId: "session-local-2",
      isLoading: false,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      void result.current.sendMessage()
    })

    await waitFor(() => {
      expect(useChatRuntimeStore.getState().isLoading).toBe(true)
      expect(mockStreamDesktopLocalChatCompletion).toHaveBeenCalledTimes(1)
    })

    act(() => {
      useChatStore.setState({
        input: "follow-up prompt",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-2"],
      })
      result.current.queuePendingTakeoverFromCurrentDraft("send_after_step")
    })

    await act(async () => {
      await result.current.stopAndSendPendingTakeover()
    })

    await waitFor(() => {
      expect(useChatRuntimeStore.getState().isLoading).toBe(false)
    })

    expect(mockStreamDesktopLocalChatCompletion).toHaveBeenCalledTimes(2)
    const secondPayload = mockStreamDesktopLocalChatCompletion.mock.calls[1]?.[0]
    expect(JSON.stringify(secondPayload?.messages ?? [])).toContain("follow-up prompt")
    expect(useChatRuntimeStore.getState().pendingTakeover).toBeNull()
    expect(useChatRuntimeStore.getState().pendingTakeoverRequestedAction).toBeNull()

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("auto-dispatches a deferred pending takeover once the active request settles", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    useChatStore.setState({
      models: [
        {
          id: "model-local",
          provider_model_id: "model-local",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "model-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "deferred prompt",
      selectedKnowledgeFileIds: ["doc-3"],
    })
    useChatRuntimeStore.setState({
      sessionId: "session-local-3",
      isLoading: true,
    })

    mockStreamDesktopLocalChatCompletion.mockResolvedValueOnce("")

    const { result, rerender } = renderHook(() => useChatMessagingService())

    act(() => {
      result.current.queuePendingTakeoverFromCurrentDraft("send_after_step")
      useChatRuntimeStore.getState().setIsLoading(false)
    })
    rerender()

    await waitFor(() => {
      expect(mockStreamDesktopLocalChatCompletion).toHaveBeenCalledTimes(1)
    })

    const firstPayload = mockStreamDesktopLocalChatCompletion.mock.calls[0]?.[0]
    expect(JSON.stringify(firstPayload?.messages ?? [])).toContain("deferred prompt")
    expect(useChatStore.getState().pendingTakeover).toBeNull()
    expect(useChatStore.getState().pendingTakeoverRequestedAction).toBeNull()
    expect(useChatStore.getState().input).toBe("")
    expect(useChatStore.getState().selectedKnowledgeFileIds).toEqual([])

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("auto-dispatches a scheduled takeover after the active streamed request naturally finishes", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    const firstRequest = createDeferred<string>()
    mockStreamDesktopLocalChatCompletion.mockImplementationOnce(async () => firstRequest.promise)
    mockStreamDesktopLocalChatCompletion.mockImplementationOnce(async () => "")

    useChatStore.setState({
      models: [
        {
          id: "model-local",
          provider_model_id: "model-local",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "model-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      input: "initial prompt",
    })
    useChatRuntimeStore.setState({
      sessionId: "session-local-4",
      isLoading: false,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      void result.current.sendMessage()
    })

    await waitFor(() => {
      expect(useChatRuntimeStore.getState().isLoading).toBe(true)
      expect(mockStreamDesktopLocalChatCompletion).toHaveBeenCalledTimes(1)
    })

    act(() => {
      useChatStore.setState({
        input: "queued follow-up",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-5"],
      })
      result.current.queuePendingTakeoverFromCurrentDraft("send_after_step")
    })

    expect(useChatStore.getState().pendingTakeoverRequestedAction).toBe("send_after_step")

    await act(async () => {
      firstRequest.resolve("")
      await firstRequest.promise
    })

    await waitFor(() => {
      expect(mockStreamDesktopLocalChatCompletion).toHaveBeenCalledTimes(2)
    })

    const secondPayload = mockStreamDesktopLocalChatCompletion.mock.calls[1]?.[0]
    expect(JSON.stringify(secondPayload?.messages ?? [])).toContain("queued follow-up")
    expect(useChatRuntimeStore.getState().pendingTakeover).toBeNull()
    expect(useChatRuntimeStore.getState().pendingTakeoverRequestedAction).toBeNull()
    expect(useChatStore.getState().input).toBe("")
    expect(useChatStore.getState().selectedKnowledgeFileIds).toEqual([])

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("cancels the pending takeover without touching the active run", () => {
    useChatRuntimeStore.setState({
      pendingTakeover: {
        input: "cancel me",
        attachments: [],
        selectedKnowledgeFileIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      pendingTakeoverRequestedAction: "send_after_step",
      isLoading: true,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      result.current.cancelPendingTakeover()
    })

    expect(useChatStore.getState().pendingTakeover).toBeNull()
    expect(useChatStore.getState().pendingTakeoverRequestedAction).toBeNull()
    expect(mockCancelChatCompletion).not.toHaveBeenCalled()
  })

  it("keeps the pending takeover draft when follow-up dispatch is not accepted", async () => {
    useChatStore.setState({
      pendingTakeover: {
        input: "keep me",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-4"],
        createdAt: 1,
        updatedAt: 1,
      },
      models: [],
    })

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.stopAndSendPendingTakeover()
    })

    expect(useChatStore.getState().pendingTakeover).toEqual(
      expect.objectContaining({
        input: "keep me",
        selectedKnowledgeFileIds: ["doc-4"],
      })
    )
  })

  it("preserves execution_tree when finalizing a compare winner", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    useChatStore.setState({
      messages: [
        {
          id: "assistant-compare-finalize",
          role: "assistant",
          content: "baseline",
          createdAt: 1,
          metaInfo: {
            execution_tree: {
              schema_version: 1,
              root_execution_id: "exec-1",
              execution_id: "exec-1",
            },
          },
          blocks: [
            {
              id: "exec-ui-1",
              type: "ui",
              viewType: "execution.lifecycle",
              payload: {
                schema_version: 1,
                root_execution_id: "exec-1",
                execution_id: "exec-1",
              },
            } as any,
          ],
        },
      ],
      compareByMessageId: {
        "assistant-compare-finalize": {
          messageId: "assistant-compare-finalize",
          baselineModelKey: "model-a",
          activeModelKey: "model-b",
          isFinalizing: false,
          candidates: {
            "model-a": {
              modelKey: "model-a",
              modelId: "model-a",
              content: "baseline",
              blocks: [],
              loading: false,
              baseline: true,
            },
            "model-b": {
              modelKey: "model-b",
              modelId: "model-b",
              providerModelId: "model-b",
              content: "candidate",
              blocks: [],
              loading: false,
              baseline: false,
            },
          },
        },
      },
    })

    mockFinalizeDesktopLocalCompare.mockResolvedValue({
      session_id: "session-1",
      replaced_turn_index: 1,
      message: {
        role: "assistant",
        content: "candidate",
        turn_index: 2,
        meta_info: {},
      },
    } as any)

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.finalizeCompareWinner("assistant-compare-finalize", "model-b")
    })

    const updated = useChatStore
      .getState()
      .messages.find((message) => message.id === "assistant-compare-finalize")

    expect(updated?.metaInfo?.execution_tree).toMatchObject({
      root_execution_id: "exec-1",
      execution_id: "exec-1",
    })
  })

  it("sends the current root_execution_id when regenerating an assistant turn", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    useChatStore.setState({
      models: [
        {
          id: "model-local",
          provider_model_id: "model-local",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "model-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      messages: [
        {
          id: "assistant-regen-1",
          role: "assistant",
          content: "baseline",
          createdAt: 1,
          metaInfo: {
            execution_tree: {
              schema_version: 1,
              root_execution_id: "exec-root-regen",
              execution_id: "exec-root-regen",
            },
          },
        },
      ],
    })
    useChatRuntimeStore.setState({ sessionId: "session-1" })
    mockStreamChatCompletion.mockResolvedValueOnce("")
    mockStreamDesktopLocalChatCompletion.mockResolvedValueOnce("")

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.regenerateMessage("assistant-regen-1")
    })

    const totalStreamCalls =
      mockStreamDesktopLocalChatCompletion.mock.calls.length +
      mockStreamChatCompletion.mock.calls.length
    expect(totalStreamCalls).toBe(1)
    const payload =
      mockStreamDesktopLocalChatCompletion.mock.calls[0]?.[0] ??
      mockStreamChatCompletion.mock.calls[0]?.[0]
    expect(payload?.metadata).toMatchObject({
      execution: {
        root_execution_id: "exec-root-regen",
      },
    })
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("preserves explicit_task_agent_id when regenerating a reply from a task-agent mention", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    mockListCustomTaskAgents.mockResolvedValueOnce([
      { id: "agent-da-vinci", name: "达芬奇" } as any,
    ])
    mockStreamDesktopLocalChatCompletion.mockResolvedValueOnce("")

    useChatStore.setState({
      models: [
        {
          id: "model-local",
          provider_model_id: "model-local",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "model-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      messages: [
        {
          id: "user-mention-1",
          role: "user",
          content: "帮我画一只带翅膀的猫咪",
          createdAt: 1,
          metaInfo: {
            display_content: "@达芬奇 帮我画一只带翅膀的猫咪",
          },
        },
        {
          id: "assistant-mention-1",
          role: "assistant",
          content: "baseline",
          createdAt: 2,
        },
      ],
    })
    useChatRuntimeStore.setState({ sessionId: "session-mention-regen-1" })

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.regenerateMessage("assistant-mention-1")
    })

    const payload = mockStreamDesktopLocalChatCompletion.mock.calls[0]?.[0]
    expect(payload?.regenerate).toBe(true)
    expect(payload?.explicit_task_agent_id).toBe("agent-da-vinci")

    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("keeps the same root_execution_id when continuing interrupted generation", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    const firstRequest = createDeferred<string>()
    mockStreamDesktopLocalChatCompletion.mockImplementationOnce(async (_payload, _handlers, control) => {
      control?.onCancel?.(() => {
        firstRequest.resolve("")
      })
      return firstRequest.promise
    })
    mockStreamDesktopLocalChatCompletion.mockResolvedValueOnce("")
    mockCancelChatCompletion.mockResolvedValue({
      request_id: "request-continue-1",
      status: "cancelled",
    })

    useChatStore.setState({
      models: [
        {
          id: "model-local",
          provider_model_id: "model-local",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        } as any,
      ],
      config: {
        model: "model-local",
        temperatureEnabled: true,
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
        reasoningEnabled: false,
        reasoningEffort: "medium",
      },
      sessionId: "session-1",
      input: "initial prompt",
      isLoading: false,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      void result.current.sendMessage()
    })

    await waitFor(() => {
      expect(useChatRuntimeStore.getState().isLoading).toBe(true)
    })

    const assistantMessage = useChatStore
      .getState()
      .messages.find((message) => message.role === "assistant")
    expect(assistantMessage?.id).toBeTruthy()

    act(() => {
      useChatStore.getState().mergeMessageMeta(assistantMessage!.id, {
        execution_tree: {
          schema_version: 1,
          root_execution_id: "exec-root-continue",
          execution_id: "exec-root-continue",
        },
      })
    })

    await act(async () => {
      await result.current.cancelActiveRequest()
    })

    await act(async () => {
      await result.current.continueInterruptedGeneration()
    })

    const totalStreamCalls =
      mockStreamDesktopLocalChatCompletion.mock.calls.length +
      mockStreamChatCompletion.mock.calls.length
    expect(totalStreamCalls).toBe(2)
    const secondPayload =
      mockStreamDesktopLocalChatCompletion.mock.calls[1]?.[0] ??
      mockStreamChatCompletion.mock.calls[1]?.[0]
    expect(secondPayload?.metadata).toMatchObject({
      execution: {
        root_execution_id: "exec-root-continue",
      },
    })
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("uses persisted execution trees already reconciled in fetched history", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI_INTERNALS__ = {}
    mockFetchConversationHistory.mockResolvedValue({
      session_id: "session-1",
      messages: [
        {
          role: "assistant",
          content: "",
          turn_index: 1,
          meta_info: {
            execution_tree: {
              schema_version: 1,
              root_execution_id: "exec-root-history",
              execution_id: "exec-root-history",
              execution_status: "integrated",
              persisted_snapshot: true,
              target: {
                name: "Hydrated Worker",
                workflow_run_id: "run-hydrated",
              },
            },
          },
        },
      ],
      next_cursor: null,
      has_more: false,
    } as any)

    const { result } = renderHook(() => useChatMessagingService())

    await act(async () => {
      await result.current.loadHistoryBySession("session-1")
    })

    const message = useChatStore.getState().messages[0]
    expect(message?.metaInfo?.execution_tree).toMatchObject({
      execution_status: "integrated",
      persisted_snapshot: true,
      target: expect.objectContaining({
        name: "Hydrated Worker",
        workflow_run_id: "run-hydrated",
      }),
    })
    expect(message?.blocks?.[0]).toMatchObject({
      type: "ui",
      viewType: "execution.lifecycle",
      payload: expect.objectContaining({
        persisted_snapshot: true,
      }),
    })
    delete windowWithTauri.__TAURI_INTERNALS__
  })
})


