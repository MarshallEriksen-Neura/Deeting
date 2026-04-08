import { streamChatCompletion, streamDesktopLocalChatCompletion } from "@/lib/api/chat"
import { rejectDesktopTool, streamDesktopApproveTool } from "@/lib/api/mcp-desktop"
import { z } from "zod"

import { handleModelConfigRequiredError } from "@/lib/model-config-required"

const EXECUTE_LOCAL_TEXT_CONVERSATION_COMMAND = "execute_local_text_conversation"

async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    handleModelConfigRequiredError(error)
    throw error
  }
}

export const IslandToolApprovalSchema = z.object({
  approval_token: z.string(),
  call_id: z.string().nullable().optional(),
  tool_name: z.string(),
  description: z.string().nullable().optional(),
  risk_level: z.string().nullable().optional(),
  risk_reasons: z.array(z.string()).default([]),
  arguments: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const IslandTextConversationReplySchema = z.object({
  text: z.string().nullable().optional(),
  approval_request: IslandToolApprovalSchema.nullable().optional(),
})

export const IslandApprovalActionResultSchema = z.object({
  tool_name: z.string(),
  approved: z.boolean(),
  follow_up_texts: z.array(z.string()).default([]),
})

export type IslandToolApproval = z.infer<typeof IslandToolApprovalSchema>
export type IslandTextConversationReply = z.infer<typeof IslandTextConversationReplySchema>
export type IslandApprovalActionResult = z.infer<typeof IslandApprovalActionResultSchema>

function extractFollowUpTextsFromApprovalResult(result: unknown): string[] {
  if (!result || typeof result !== "object") return []
  const payload = result as Record<string, unknown>

  const continuationBlocks = Array.isArray(payload.continuation_blocks)
    ? payload.continuation_blocks
    : []
  const continuationTexts = continuationBlocks
    .filter(
      (block): block is { type?: unknown; content?: unknown } =>
        Boolean(block && typeof block === "object")
    )
    .filter((block) => block.type === "text" && typeof block.content === "string")
    .map((block) => block.content.trim())
    .filter((value) => value.length > 0)

  if (continuationTexts.length > 0) {
    return continuationTexts
  }

  const error =
    typeof payload.error === "string" && payload.error.trim().length > 0
      ? payload.error.trim()
      : null
  return error ? [error] : []
}

export interface IslandChatRequestConfig {
  model: string
  model_selection_mode?: "pool" | "exact_provider"
  provider_model_id?: string
  useDesktopLocalGateway: boolean
}

export async function streamIslandTextConversation(
  sessionId: string,
  text: string,
  requestConfig: IslandChatRequestConfig,
  handlers: {
    onDelta?: (delta: string, snapshot: string) => void
    onMessage?: (data: unknown) => void
  } = {}
): Promise<string> {
  const streamFn = requestConfig.useDesktopLocalGateway
    ? streamDesktopLocalChatCompletion
    : streamChatCompletion

  return streamFn(
    {
      model: requestConfig.model,
      model_selection_mode: requestConfig.model_selection_mode,
      provider_model_id: requestConfig.provider_model_id,
      session_id: sessionId,
      messages: [{ role: "user", content: text }],
      stream: true,
      status_stream: true,
    },
    handlers
  )
}

export async function executeIslandTextConversation(
  sessionId: string,
  text: string
): Promise<IslandTextConversationReply | null> {
  const data = await invokeTauri<unknown>(EXECUTE_LOCAL_TEXT_CONVERSATION_COMMAND, {
    sessionId,
    text,
  })
  if (data == null) {
    return null
  }
  return IslandTextConversationReplySchema.parse(data)
}

export async function approveIslandTool(
  approvalToken: string,
  toolName: string,
  callId?: string | null
): Promise<IslandApprovalActionResult> {
  const data = await streamDesktopApproveTool({
    approvalToken,
    approvalMode: "allow_once",
    callId: callId ?? undefined,
  })

  return IslandApprovalActionResultSchema.parse({
    tool_name: toolName,
    approved: true,
    follow_up_texts: extractFollowUpTextsFromApprovalResult(data),
  })
}

export async function rejectIslandTool(
  approvalToken: string,
  toolName: string
): Promise<IslandApprovalActionResult> {
  await rejectDesktopTool({
    approvalToken,
    rejectMode: "reject_once",
  })

  return IslandApprovalActionResultSchema.parse({
    tool_name: toolName,
    approved: false,
    follow_up_texts: [],
  })
}
