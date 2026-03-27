import { useChatStore } from "../chat-store"

describe("useChatStore pending takeover state", () => {
  const resetStore = () => {
    sessionStorage.clear()
    useChatStore.getState().resetSession()
  }

  beforeEach(() => {
    resetStore()
  })

  it("stores a pending takeover draft with input, attachments, selected knowledge ids, and timestamps", () => {
    useChatStore.getState().setPendingTakeover({
      input: "follow-up prompt",
      attachments: [
        {
          id: "attachment-1",
          kind: "image",
          url: "https://example.com/image.png",
        },
      ],
      selectedKnowledgeFileIds: ["doc-1", "doc-2"],
    })

    expect(useChatStore.getState().pendingTakeover).toEqual(
      expect.objectContaining({
        input: "follow-up prompt",
        attachments: [
          expect.objectContaining({
            id: "attachment-1",
            kind: "image",
            url: "https://example.com/image.png",
          }),
        ],
        selectedKnowledgeFileIds: ["doc-1", "doc-2"],
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      })
    )
  })

  it("replaces the previous pending takeover draft instead of queueing a second item", () => {
    useChatStore.getState().setPendingTakeover({
      input: "first prompt",
      attachments: [{ id: "attachment-1", kind: "image" }],
      selectedKnowledgeFileIds: ["doc-1"],
    })

    const firstDraft = useChatStore.getState().pendingTakeover

    useChatStore.getState().setPendingTakeover({
      input: "second prompt",
      attachments: [{ id: "attachment-2", kind: "file", fileId: "file-2" }],
      selectedKnowledgeFileIds: ["doc-2"],
    })

    expect(useChatStore.getState().pendingTakeover).toEqual(
      expect.objectContaining({
        input: "second prompt",
        attachments: [
          expect.objectContaining({
            id: "attachment-2",
            kind: "file",
            fileId: "file-2",
          }),
        ],
        selectedKnowledgeFileIds: ["doc-2"],
      })
    )
    expect(useChatStore.getState().pendingTakeover).not.toEqual(firstDraft)
  })

  it("clears the pending takeover draft without mutating active messages", () => {
    useChatStore.setState({
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "existing response",
          createdAt: 1,
        },
      ],
    })

    useChatStore.getState().setPendingTakeover({
      input: "queued follow-up",
      attachments: [],
      selectedKnowledgeFileIds: [],
    })

    useChatStore.getState().clearPendingTakeover()

    expect(useChatStore.getState().pendingTakeover).toBeNull()
    expect(useChatStore.getState().messages).toEqual([
      {
        id: "message-1",
        role: "assistant",
        content: "existing response",
        createdAt: 1,
      },
    ])
  })

  it("clears pending takeover state when chat or session state is reset", () => {
    useChatStore.getState().setPendingTakeover({
      input: "queued follow-up",
      attachments: [],
      selectedKnowledgeFileIds: ["doc-1"],
    })

    useChatStore.getState().resetChat()
    expect(useChatStore.getState().pendingTakeover).toBeNull()

    useChatStore.getState().setPendingTakeover({
      input: "queued again",
      attachments: [],
      selectedKnowledgeFileIds: ["doc-2"],
    })

    useChatStore.getState().resetSession()
    expect(useChatStore.getState().pendingTakeover).toBeNull()
  })

  it("clears pending takeover state when switching assistants", () => {
    useChatStore.getState().setPendingTakeover({
      input: "queued follow-up",
      attachments: [],
      selectedKnowledgeFileIds: ["doc-3"],
    })

    useChatStore.getState().switchSelectedAssistant("assistant-2", {
      id: "assistant-2",
      name: "Assistant Two",
      desc: "",
      color: "from-sky-500 to-cyan-500",
    })

    expect(useChatStore.getState().pendingTakeover).toBeNull()
  })
})
