import type { Message } from "@/lib/chat/message-types"

export type ComposerRecoveryAction = "continue" | "retry" | "abandon"

export interface ComposerRecoveryPrompt {
  messageId: string
  executionId: string | null
  stage: string | null
  availableActions: ComposerRecoveryAction[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function normalizeRecoveryActions(value: unknown): ComposerRecoveryAction[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<ComposerRecoveryAction>()

  value.forEach((item) => {
    const normalized = typeof item === "string" ? item.trim().toLowerCase() : ""
    if (
      normalized === "continue" ||
      normalized === "retry" ||
      normalized === "abandon"
    ) {
      allowed.add(normalized)
    }
  })

  return Array.from(allowed)
}

export function extractLatestComposerRecoveryPrompt(
  messages: Message[]
): ComposerRecoveryPrompt | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue

    const recovery = asRecord(message.metaInfo?.recovery)
    if (!recovery) continue

    const availableActions = normalizeRecoveryActions(recovery.available_actions)
    if (availableActions.length === 0) continue

    return {
      messageId: message.id,
      executionId: asTrimmedString(recovery.execution_id),
      stage: asTrimmedString(recovery.stage),
      availableActions,
    }
  }

  return null
}
