import type { PendingChatTakeover } from "@/store/chat-store"
import {
  normalizePendingTakeoverDraft,
  shouldAutoDispatchPendingTakeover,
} from "@/lib/chat/takeover"

describe("chat takeover helpers", () => {
  it("normalizes a pending takeover draft and removes duplicate knowledge ids", () => {
    expect(
      normalizePendingTakeoverDraft({
        input: "  follow-up prompt  ",
        attachments: [{ id: "attachment-1", kind: "image" }],
        selectedKnowledgeFileIds: ["doc-1", " doc-2 ", "doc-1", ""],
      })
    ).toEqual({
      input: "follow-up prompt",
      attachments: [{ id: "attachment-1", kind: "image" }],
      selectedKnowledgeFileIds: ["doc-1", "doc-2"],
    })
  })

  it("returns null when a pending takeover draft has neither input nor attachments", () => {
    expect(
      normalizePendingTakeoverDraft({
        input: "   ",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-1"],
      })
    ).toBeNull()
  })

  it("auto-dispatches a deferred takeover when the active run has settled", () => {
    const pendingTakeover: PendingChatTakeover = {
      input: "queued follow-up",
      attachments: [],
      selectedKnowledgeFileIds: [],
      createdAt: 1,
      updatedAt: 1,
    }

    expect(
      shouldAutoDispatchPendingTakeover({
        pendingTakeover,
        requestedAction: "send_after_step",
        isLoading: false,
        statusCode: null,
      })
    ).toBe(true)
  })

  it("treats approval-required pause as a safe deferred-send boundary", () => {
    const pendingTakeover: PendingChatTakeover = {
      input: "queued follow-up",
      attachments: [],
      selectedKnowledgeFileIds: [],
      createdAt: 1,
      updatedAt: 1,
    }

    expect(
      shouldAutoDispatchPendingTakeover({
        pendingTakeover,
        requestedAction: "send_after_step",
        isLoading: true,
        statusCode: "approval.required",
      })
    ).toBe(true)
  })

  it("does not auto-dispatch while the active run is still progressing", () => {
    const pendingTakeover: PendingChatTakeover = {
      input: "queued follow-up",
      attachments: [],
      selectedKnowledgeFileIds: [],
      createdAt: 1,
      updatedAt: 1,
    }

    expect(
      shouldAutoDispatchPendingTakeover({
        pendingTakeover,
        requestedAction: "send_after_step",
        isLoading: true,
        statusCode: "upstream.response",
      })
    ).toBe(false)
  })
})
