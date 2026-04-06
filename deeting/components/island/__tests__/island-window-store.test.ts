import { useIslandWindowStore } from "../island-window-store"

jest.mock("@/lib/api/island", () => ({
  streamIslandTextConversation: jest.fn(),
  approveIslandTool: jest.fn(),
  rejectIslandTool: jest.fn(),
}))

jest.mock("@/lib/api/conversations", () => ({
  createConversation: jest.fn(),
}))

jest.mock("@/lib/chat/history-loader", () => ({
  loadConversationHistoryPage: jest.fn(),
}))

jest.mock("@/lib/runtime/tauri", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@tauri-apps/api/event", () => ({
  emit: jest.fn().mockResolvedValue(undefined),
}))

const { streamIslandTextConversation } = jest.requireMock("@/lib/api/island") as {
  streamIslandTextConversation: jest.Mock
}
const { createConversation } = jest.requireMock("@/lib/api/conversations") as {
  createConversation: jest.Mock
}
const { loadConversationHistoryPage } = jest.requireMock("@/lib/chat/history-loader") as {
  loadConversationHistoryPage: jest.Mock
}
const { emit } = jest.requireMock("@tauri-apps/api/event") as {
  emit: jest.Mock
}

function resetStore() {
  useIslandWindowStore.setState({
    mode: "expanded",
    statusLabel: "Ready",
    summaryText: "Current summary",
    lastReplyText: "Previous answer",
    lastReplyAt: 2,
    recentMessages: [{ role: "assistant", content: "Previous answer", createdAt: 2 }],
    pendingApproval: null,
    isBusy: false,
    errorMessage: null,
    sessionId: "session-1",
    chatRequestConfig: {
      model: "model-local-1",
      model_selection_mode: "pool",
      useDesktopLocalGateway: true,
    },
    suspendRemoteSync: false,
  })
}

describe("useIslandWindowStore", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetStore()
  })

  it("keeps optimistic user text visible until local history sync completes", async () => {
    streamIslandTextConversation.mockResolvedValue("")
    loadConversationHistoryPage.mockResolvedValue({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Previous answer",
          createdAt: 2,
        },
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: 3,
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: "new reply",
          createdAt: 4,
        },
      ],
      nextCursor: null,
      hasMore: false,
      raw: { messages: [], next_cursor: null, has_more: false },
    })

    const sendPromise = useIslandWindowStore.getState().sendQuickReply("hello")

    expect(useIslandWindowStore.getState().isBusy).toBe(true)
    expect(useIslandWindowStore.getState().statusLabel).toBe("Working...")
    expect(useIslandWindowStore.getState().recentMessages.at(-1)?.content).toBe("hello")

    useIslandWindowStore.getState().syncFromEvent({
      mode: "expanded",
      statusLabel: "Ready",
      summaryText: "Old summary",
      lastReplyText: "Previous answer",
      lastReplyAt: 2,
      recentMessages: [{ role: "assistant", content: "Previous answer", createdAt: 2 }],
      pendingApproval: null,
      isBusy: false,
      errorMessage: null,
      sessionId: "session-1",
      chatRequestConfig: {
        model: "model-local-1",
        model_selection_mode: "pool",
        useDesktopLocalGateway: true,
      },
    })

    expect(useIslandWindowStore.getState().statusLabel).toBe("Working...")
    expect(useIslandWindowStore.getState().recentMessages.at(-1)?.content).toBe("hello")

    await sendPromise

    expect(useIslandWindowStore.getState().isBusy).toBe(false)
    expect(useIslandWindowStore.getState().suspendRemoteSync).toBe(false)
    expect(useIslandWindowStore.getState().recentMessages.at(-2)?.content).toBe("hello")
    expect(useIslandWindowStore.getState().recentMessages.at(-1)?.content).toBe("new reply")
  })

  it("creates a session before sending when island window starts blank", async () => {
    useIslandWindowStore.setState({
      sessionId: null,
      recentMessages: [],
    })
    createConversation.mockResolvedValue({ session_id: "session-new", title: null })
    streamIslandTextConversation.mockResolvedValue("")
    loadConversationHistoryPage.mockResolvedValue({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: 3,
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: "new reply",
          createdAt: 4,
        },
      ],
      nextCursor: null,
      hasMore: false,
      raw: { messages: [], next_cursor: null, has_more: false },
    })

    await useIslandWindowStore.getState().sendQuickReply("hello")

    expect(createConversation).toHaveBeenCalledWith({})
    expect(streamIslandTextConversation).toHaveBeenCalledWith(
      "session-new",
      "hello",
      {
        model: "model-local-1",
        model_selection_mode: "pool",
        useDesktopLocalGateway: true,
      },
      expect.any(Object)
    )
    expect(useIslandWindowStore.getState().sessionId).toBe("session-new")
    expect(emit).toHaveBeenCalledWith("island:action-completed", {
      sessionId: "session-new",
    })
  })
})
