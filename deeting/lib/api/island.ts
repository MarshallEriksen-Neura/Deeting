import { z } from "zod"

import { handleModelConfigRequiredError } from "@/lib/model-config-required"

const EXECUTE_LOCAL_TEXT_CONVERSATION_COMMAND = "execute_local_text_conversation"
const APPROVE_LOCAL_TEXT_CONVERSATION_TOOL_COMMAND = "approve_local_text_conversation_tool"
const REJECT_LOCAL_TEXT_CONVERSATION_TOOL_COMMAND = "reject_local_text_conversation_tool"

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
  const data = await invokeTauri<unknown>(APPROVE_LOCAL_TEXT_CONVERSATION_TOOL_COMMAND, {
    approvalToken,
    toolName,
    callId: callId ?? null,
  })
  return IslandApprovalActionResultSchema.parse(data)
}

export async function rejectIslandTool(
  approvalToken: string,
  toolName: string
): Promise<IslandApprovalActionResult> {
  const data = await invokeTauri<unknown>(REJECT_LOCAL_TEXT_CONVERSATION_TOOL_COMMAND, {
    approvalToken,
    toolName,
  })
  return IslandApprovalActionResultSchema.parse(data)
}
