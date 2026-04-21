import { useChatRuntimeStore } from "../chat-runtime-store"
import { useChatStore } from "../chat-store"

jest.mock("@/lib/chat/history-loader", () => ({
  loadConversationHistoryPage: jest.fn(),
}))

jest.mock("@/lib/runtime/tauri", () => ({
  isTauriRuntime: () => true,
}))

const { loadConversationHistoryPage } = jest.requireMock("@/lib/chat/history-loader") as {
  loadConversationHistoryPage: jest.Mock
}

function resetStores() {
  localStorage.clear()
  sessionStorage.clear()
  useChatRuntimeStore.getState().resetSession()
  useChatStore.getState().resetSession()
}

describe("useChatRuntimeStore initSession", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetStores()
  })

  it("refreshes persisted history when re-entering the same session", async () => {
    useChatRuntimeStore.setState({
      sessionId: "session-recovery-1",
      initialized: true,
      isLoading: false,
      historyCursor: 9,
      historyHasMore: true,
    })
    useChatStore.setState({
      messages: [
        {
          id: "stale-message",
          role: "assistant",
          content: "",
          createdAt: 1,
          metaInfo: {},
          blocks: [],
        },
      ],
      input: "keep this draft",
      compareByMessageId: {
        "stale-message": {
          messageId: "stale-message",
          baselineModelKey: "baseline",
          activeModelKey: "baseline",
          isFinalizing: false,
          candidates: {},
        },
      },
    })
    loadConversationHistoryPage.mockResolvedValue({
      messages: [
        {
          id: "session-recovery-1-2",
          role: "assistant",
          content: "",
          createdAt: 2,
          metaInfo: {
            recovery: {
              execution_id: "exec-recovery-1",
              stage: "resume_failed",
              available_actions: ["continue", "retry", "abandon"],
            },
          },
          blocks: [],
        },
      ],
      nextCursor: null,
      hasMore: false,
      raw: { messages: [], next_cursor: null, has_more: false },
    })

    await useChatRuntimeStore.getState().initSession("session-recovery-1")

    expect(loadConversationHistoryPage).toHaveBeenCalledWith("session-recovery-1", {
      limit: 30,
      idPrefix: "session-recovery-1",
      isTauriRuntime: true,
    })
    expect(useChatStore.getState().messages).toMatchObject([
      {
        id: "session-recovery-1-2",
        metaInfo: {
          recovery: expect.objectContaining({
            execution_id: "exec-recovery-1",
            stage: "resume_failed",
          }),
        },
      },
    ])
    expect(useChatStore.getState().input).toBe("keep this draft")
    expect(useChatStore.getState().compareByMessageId).toEqual({})
    expect(useChatRuntimeStore.getState().historyCursor).toBeNull()
    expect(useChatRuntimeStore.getState().historyHasMore).toBe(false)
  })

  it("does not reload same-session history while an active request is still loading", async () => {
    useChatRuntimeStore.setState({
      sessionId: "session-loading-1",
      initialized: true,
      isLoading: true,
    })

    await useChatRuntimeStore.getState().initSession("session-loading-1")

    expect(loadConversationHistoryPage).not.toHaveBeenCalled()
  })
})
