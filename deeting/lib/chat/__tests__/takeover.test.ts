import type { PendingChatTakeover } from "@/store/chat-store"
import {
  isPendingTakeoverSafeBoundary,
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
      pageContext: null,
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

  it("does not treat a non-loading but still-active assistant message as a safe boundary", () => {
    expect(
      isPendingTakeoverSafeBoundary({
        isLoading: false,
        statusCode: null,
        assistantBlocks: [
          {
            id: "call-running-1",
            type: "tool_call",
            callId: "call-running-1",
            toolName: "shell_execute",
            status: "running",
          },
        ],
      })
    ).toBe(false)
  })

  it("still treats an approval pause as a safe boundary", () => {
    expect(
      isPendingTakeoverSafeBoundary({
        isLoading: false,
        statusCode: null,
        assistantBlocks: [
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
    ).toBe(true)
  })
})
