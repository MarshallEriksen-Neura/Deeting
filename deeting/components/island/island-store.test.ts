import type { Message } from "@/lib/chat/message-types"
import { createConversation } from "@/lib/api/conversations"
import { useBridgeApprovalStore } from "@/lib/chat/bridge-approval-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useChatStore } from "@/store/chat-store"

import { useIslandStore } from "./island-store"

jest.mock("@/lib/api/conversations", () => ({
  createConversation: jest.fn(),
}))

type HydrateSnapshot = Parameters<
  ReturnType<typeof useIslandStore.getState>["hydrateFromChat"]
>[0]

const mockCreateConversation = createConversation as jest.MockedFunction<
  typeof createConversation
>

function resetIslandStore() {
  useIslandStore.setState({
    mode: "hidden",
    statusLabel: "Idle",
    summaryText: "Open a conversation to keep Deeting nearby.",
    lastReplyText: "No replies yet.",
    lastReplyAt: null,
    recentMessages: [],
    pendingApproval: null,
    browserLookup: null,
    selectionContext: null,
    isBusy: false,
    errorMessage: null,
    statusStage: null,
    statusCode: null,
    statusMeta: null,
    stageHistory: [],
  })
}

function buildAssistantMessage(): Message {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    createdAt: 123,
    metaInfo: {},
    blocks: [
      {
        id: "assistant-1-block-1",
        type: "text",
        content: "Island reply preview",
        streamState: "completed",
        displayMode: "bubble",
      },
    ],
  }
}

describe("useIslandStore hydrateFromChat", () => {
  beforeEach(() => {
    mockCreateConversation.mockReset()
    useChatRuntimeStore.getState().resetSession()
    useBridgeApprovalStore.getState().clearAll()
    resetIslandStore()
  })

  it("does not publish redundant updates for identical hydrated chat state", () => {
    const snapshot: HydrateSnapshot = {
      sessionId: "session-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "What happened?",
          createdAt: 100,
          metaInfo: {},
          blocks: [],
        },
        buildAssistantMessage(),
      ],
      pendingApprovalSource: null,
      isLoading: false,
      globalLoading: false,
      statusStage: null,
      statusCode: null,
      statusMeta: null,
      errorMessage: null,
    }

    const listener = jest.fn()
    const unsubscribe = useIslandStore.subscribe(listener)

    useIslandStore.getState().hydrateFromChat(snapshot)
    useIslandStore.getState().hydrateFromChat(snapshot)

    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(useIslandStore.getState()).toMatchObject({
      statusLabel: "Ready",
      summaryText: "What happened?",
      lastReplyText: "Island reply preview",
      lastReplyAt: 123,
      recentMessages: [
        { role: "user", content: "What happened?", createdAt: 100 },
        { role: "assistant", content: "Island reply preview", createdAt: 123 },
      ],
    })
  })

  it("presents and clears captured selection context", () => {
    useIslandStore.getState().presentSelectionContext({
      selectionId: "selection-1",
      text: "Selected text",
      source: "accessibility",
      capturedAt: 123,
      charCount: 13,
      truncated: false,
    })

    expect(useIslandStore.getState()).toMatchObject({
      mode: "expanded",
      statusLabel: "Ready",
      selectionContext: {
        selectionId: "selection-1",
        preview: "Selected text",
        activeAction: null,
      },
    })

    useIslandStore.getState().clearSelectionContext("other-selection")
    expect(useIslandStore.getState().selectionContext?.selectionId).toBe(
      "selection-1",
    )

    useIslandStore.getState().clearSelectionContext("selection-1")
    expect(useIslandStore.getState().selectionContext).toBeNull()
  })

  it("starts a clean conversation from the island without restoring the workspace", async () => {
    mockCreateConversation.mockResolvedValue({
      session_id: "new-session",
      title: null,
    })
    useChatRuntimeStore.getState().setSessionId("old-session")
    useChatStore.setState({
      messages: [
        {
          id: "old-message",
          role: "user",
          content: "old draft",
          createdAt: 100,
          metaInfo: {},
          blocks: [],
        },
      ],
      input: "draft",
      attachments: [],
      selectedKnowledgeFileIds: ["file-1"],
      pageContext: {
        tabId: "tab-1",
        title: "Page",
        url: "https://example.test",
        host: "example.test",
        headingsSummary: [],
        mainTextSnippet: "main",
        visibleTextSnippet: "visible",
        capturedAt: 100,
      },
    })
    useBridgeApprovalStore.getState().setPending({
      kind: "bridge_mcp",
      approval_token: "approval-old",
      tool_name: "shell_execute",
      arguments: {},
      meta: { call_id: "call-old" },
    })
    useIslandStore.setState({
      mode: "expanded",
      statusLabel: "Ready",
      summaryText: "old summary",
      recentMessages: [{ role: "user", content: "old", createdAt: 100 }],
      pendingApproval: {
        id: "approval-old",
        title: "shell_execute",
        desc: "old approval",
        approvalToken: "approval-old",
        toolName: "shell_execute",
      },
    })

    await useIslandStore.getState().startNewConversation()

    expect(mockCreateConversation).toHaveBeenCalledWith({})
    expect(useChatRuntimeStore.getState().sessionId).toBe("new-session")
    expect(useChatStore.getState()).toMatchObject({
      messages: [],
      input: "",
      selectedKnowledgeFileIds: [],
      pageContext: null,
    })
    expect(useBridgeApprovalStore.getState().pending).toBeNull()
    expect(useIslandStore.getState()).toMatchObject({
      mode: "expanded",
      statusLabel: "Ready",
      summaryText: "Open a conversation to keep Deeting nearby.",
      lastReplyText: "No replies yet.",
      recentMessages: [],
      pendingApproval: null,
      isBusy: false,
    })
  })
})
