"use client"

import { act, renderHook, waitFor } from "@testing-library/react"
import {
  cancelChatCompletion,
  finalizeDesktopLocalCompare,
  streamChatCompletion,
  streamDesktopLocalChatCompletion,
} from "@/lib/api/chat"
import {
  fetchConversationHistory,
} from "@/lib/api/conversations"
import { useChatMessagingService } from "@/hooks/chat/use-chat-messaging-service"
import { useChatStore } from "@/store/chat-store"

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
const mockFinalizeDesktopLocalCompare =
  finalizeDesktopLocalCompare as jest.MockedFunction<typeof finalizeDesktopLocalCompare>
const mockFetchConversationHistory =
  fetchConversationHistory as jest.MockedFunction<typeof fetchConversationHistory>
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
    mockFinalizeDesktopLocalCompare.mockReset()
    mockFetchConversationHistory.mockReset()
    useChatStore.getState().resetSession()
    useChatStore.setState({
      models: [{ id: "model-1", provider_model_id: "model-1" }],
      config: {
        model: "model-1",
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
      },
      selectedAssistantId: "assistant-1",
      selectedAssistant: {
        id: "assistant-1",
        name: "Assistant One",
        desc: "",
        color: "from-sky-500 to-cyan-500",
      },
      sessionId: "session-1",
    })
  })

  it("queues a pending takeover from the current draft", () => {
    useChatStore.setState({
      input: "follow-up prompt",
      attachments: [{ id: "att-1", kind: "image" } as any],
      selectedKnowledgeFileIds: ["doc-1"],
      isLoading: true,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      result.current.queuePendingTakeoverFromCurrentDraft()
    })

    expect(useChatStore.getState().pendingTakeover).toEqual(
      expect.objectContaining({
        input: "follow-up prompt",
        attachments: [{ id: "att-1", kind: "image" }],
        selectedKnowledgeFileIds: ["doc-1"],
      })
    )
  })

  it("cancels the active request and sends the pending takeover draft", async () => {
    const firstRequest = createDeferred<string>()
    mockStreamChatCompletion.mockImplementationOnce(async (_payload, _handlers, control) => {
      control?.onCancel?.(() => {
        firstRequest.resolve("")
      })
      return firstRequest.promise
    })
    mockStreamChatCompletion.mockImplementationOnce(async () => "")
    mockCancelChatCompletion.mockResolvedValue({
      request_id: "request-1",
      status: "cancelled",
    })

    useChatStore.setState({
      input: "initial prompt",
      isLoading: false,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      void result.current.sendMessage()
    })

    await waitFor(() => {
      expect(useChatStore.getState().isLoading).toBe(true)
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
      expect(mockCancelChatCompletion).toHaveBeenCalledTimes(1)
      expect(mockStreamChatCompletion).toHaveBeenCalledTimes(2)
    })

    const secondPayload = mockStreamChatCompletion.mock.calls[1]?.[0]
    expect(JSON.stringify(secondPayload?.messages ?? [])).toContain("follow-up prompt")
    expect(useChatStore.getState().pendingTakeover).toBeNull()
    expect(useChatStore.getState().input).toBe("")
    expect(useChatStore.getState().selectedKnowledgeFileIds).toEqual([])
  })

  it("auto-dispatches a deferred pending takeover once the active request settles", async () => {
    useChatStore.setState({
      input: "deferred prompt",
      selectedKnowledgeFileIds: ["doc-3"],
      pendingTakeover: {
        input: "deferred prompt",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-3"],
        createdAt: 1,
        updatedAt: 1,
      },
      pendingTakeoverRequestedAction: "send_after_step",
      isLoading: true,
    })

    mockStreamChatCompletion.mockResolvedValueOnce("")

    const { result, rerender } = renderHook(() => useChatMessagingService())

    act(() => {
      result.current.markPendingTakeoverForDeferredSend()
      useChatStore.getState().setIsLoading(false)
    })
    rerender()

    await waitFor(() => {
      expect(mockStreamChatCompletion).toHaveBeenCalledTimes(1)
    })

    const firstPayload = mockStreamChatCompletion.mock.calls[0]?.[0]
    expect(JSON.stringify(firstPayload?.messages ?? [])).toContain("deferred prompt")
    expect(useChatStore.getState().pendingTakeover).toBeNull()
    expect(useChatStore.getState().pendingTakeoverRequestedAction).toBeNull()
    expect(useChatStore.getState().input).toBe("")
    expect(useChatStore.getState().selectedKnowledgeFileIds).toEqual([])
  })

  it("auto-dispatches a scheduled takeover after the active streamed request naturally finishes", async () => {
    const firstRequest = createDeferred<string>()
    mockStreamChatCompletion.mockImplementationOnce(async () => firstRequest.promise)
    mockStreamChatCompletion.mockImplementationOnce(async () => "")

    useChatStore.setState({
      input: "initial prompt",
      isLoading: false,
    })

    const { result } = renderHook(() => useChatMessagingService())

    act(() => {
      void result.current.sendMessage()
    })

    await waitFor(() => {
      expect(useChatStore.getState().isLoading).toBe(true)
      expect(mockStreamChatCompletion).toHaveBeenCalledTimes(1)
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
      expect(mockStreamChatCompletion).toHaveBeenCalledTimes(2)
    })

    const secondPayload = mockStreamChatCompletion.mock.calls[1]?.[0]
    expect(JSON.stringify(secondPayload?.messages ?? [])).toContain("queued follow-up")
    expect(useChatStore.getState().pendingTakeover).toBeNull()
    expect(useChatStore.getState().pendingTakeoverRequestedAction).toBeNull()
    expect(useChatStore.getState().input).toBe("")
    expect(useChatStore.getState().selectedKnowledgeFileIds).toEqual([])
  })

  it("cancels the pending takeover without touching the active run", () => {
    useChatStore.setState({
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
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
      },
      sessionId: "session-1",
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
        temperature: 0.7,
        topP: 1,
        maxTokens: null,
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
      expect(useChatStore.getState().isLoading).toBe(true)
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
