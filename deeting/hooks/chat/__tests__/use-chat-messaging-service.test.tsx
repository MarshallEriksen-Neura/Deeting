"use client"

import { act, renderHook, waitFor } from "@testing-library/react"
import {
  cancelChatCompletion,
  streamChatCompletion,
} from "@/lib/api/chat"
import { useChatMessagingService } from "@/hooks/chat/use-chat-messaging-service"
import { useChatStore } from "@/store/chat-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/lib/api/custom-task-agents", () => ({
  listCustomTaskAgents: jest.fn().mockResolvedValue([]),
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
const mockCancelChatCompletion =
  cancelChatCompletion as jest.MockedFunction<typeof cancelChatCompletion>

describe("useChatMessagingService pending takeover orchestration", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockStreamChatCompletion.mockReset()
    mockCancelChatCompletion.mockReset()
    useChatStore.getState().resetSession()
    useChatStore.setState({
      models: [{ id: "model-1", provider_model_id: "model-1" }],
      config: {
        model: "model-1",
        temperature: 0.7,
        topP: 1,
        maxTokens: 8192,
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
})
