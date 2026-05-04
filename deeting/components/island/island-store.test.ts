import type { Message } from "@/lib/chat/message-types"

import { useIslandStore } from "./island-store"

type HydrateSnapshot = Parameters<
  ReturnType<typeof useIslandStore.getState>["hydrateFromChat"]
>[0]

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
})
