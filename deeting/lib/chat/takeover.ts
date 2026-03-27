import type { ChatImageAttachment } from "@/lib/chat/message-content"
import { deriveAssistantActivityState } from "@/lib/chat/assistant-activity"
import type { MessageBlock } from "@/lib/chat/message-protocol"
import type {
  PendingChatTakeover,
  PendingTakeoverRequestedAction,
} from "@/store/chat-store"

type PendingTakeoverDraftInput = {
  input: string
  attachments: ChatImageAttachment[]
  selectedKnowledgeFileIds: string[]
}

export type PendingTakeoverDispatchDraft = PendingTakeoverDraftInput

export function normalizePendingTakeoverDraft(
  draft: PendingTakeoverDraftInput
): PendingTakeoverDraftInput | null {
  const input = draft.input.trim()
  const attachments = Array.isArray(draft.attachments) ? draft.attachments : []
  if (!input && attachments.length === 0) {
    return null
  }

  return {
    input,
    attachments,
    selectedKnowledgeFileIds: Array.from(
      new Set(
        draft.selectedKnowledgeFileIds
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    ),
  }
}

export function buildPendingTakeoverDispatchDraft(
  pendingTakeover: PendingChatTakeover
): PendingTakeoverDispatchDraft {
  return {
    input: pendingTakeover.input,
    attachments: pendingTakeover.attachments,
    selectedKnowledgeFileIds: pendingTakeover.selectedKnowledgeFileIds,
  }
}

export function shouldAutoDispatchPendingTakeover({
  pendingTakeover,
  requestedAction,
  isLoading,
  statusCode,
}: {
  pendingTakeover: PendingChatTakeover | null
  requestedAction: PendingTakeoverRequestedAction | null
  isLoading: boolean
  statusCode: string | null
}) {
  if (!pendingTakeover) return false
  if (requestedAction !== "send_after_step") return false
  if (!isLoading) return true
  return statusCode === "approval.required"
}

export function isPendingTakeoverSafeBoundary({
  isLoading,
  statusCode,
  assistantBlocks,
}: {
  isLoading: boolean
  statusCode: string | null
  assistantBlocks: MessageBlock[]
}) {
  if (!isLoading) return true
  if (statusCode === "approval.required") return true
  return deriveAssistantActivityState(assistantBlocks).statusCode === "approval.required"
}
