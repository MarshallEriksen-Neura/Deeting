import { z } from "zod"

import { request } from "@/lib/http"

const CONVERSATION_BASE = "/api/v1/internal/conversations"

export const ConversationMessageSchema = z.object({
  role: z.string(),
  content: z.any().nullable().optional(),
  turn_index: z.number().int().nullable().optional(),
  is_truncated: z.boolean().nullable().optional(),
  name: z.string().nullable().optional(),
  meta_info: z.record(z.any()).nullable().optional(),
}).passthrough()

export const ConversationWindowSchema = z.object({
  session_id: z.string(),
  messages: z.array(ConversationMessageSchema).default([]),
  meta: z.record(z.any()).nullable().optional(),
  summary: z.record(z.any()).nullable().optional(),
})

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>
export type ConversationWindow = z.infer<typeof ConversationWindowSchema>

export async function fetchConversationWindow(sessionId: string): Promise<ConversationWindow> {
  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}`,
    method: "GET",
  })
  return ConversationWindowSchema.parse(data)
}

export const ConversationSessionItemSchema = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
  summary_text: z.string().nullable().optional(),
  message_count: z.number().int().optional().default(0),
  first_message_at: z.string().nullable().optional(),
  last_active_at: z.string().nullable().optional(),
})

export const ConversationSessionPageSchema = z.object({
  items: z.array(ConversationSessionItemSchema),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
})

export type ConversationSessionItem = z.infer<typeof ConversationSessionItemSchema>
export type ConversationSessionPage = z.infer<typeof ConversationSessionPageSchema>

export type ConversationSessionStatus = "active" | "archived" | "closed"

export const ConversationArchiveResponseSchema = z.object({
  session_id: z.string(),
  status: z.enum(["active", "archived", "closed"]),
})

export type ConversationArchiveResponse = z.infer<typeof ConversationArchiveResponseSchema>

export const ConversationRenameResponseSchema = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
})

export type ConversationRenameResponse = z.infer<typeof ConversationRenameResponseSchema>

export type ConversationSessionsQuery = {
  cursor?: string | null
  size?: number
  assistant_id?: string | null
  status?: ConversationSessionStatus
}

export async function fetchConversationSessions(
  query: ConversationSessionsQuery
): Promise<ConversationSessionPage> {
  const data = await request({
    url: CONVERSATION_BASE,
    method: "GET",
    params: query,
  })
  return ConversationSessionPageSchema.parse(data)
}

export async function archiveConversation(sessionId: string): Promise<ConversationArchiveResponse> {
  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}/archive`,
    method: "POST",
  })
  return ConversationArchiveResponseSchema.parse(data)
}

export async function unarchiveConversation(sessionId: string): Promise<ConversationArchiveResponse> {
  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}/unarchive`,
    method: "POST",
  })
  return ConversationArchiveResponseSchema.parse(data)
}

export async function renameConversation(
  sessionId: string,
  title: string
): Promise<ConversationRenameResponse> {
  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}/title`,
    method: "PATCH",
    data: { title },
  })
  return ConversationRenameResponseSchema.parse(data)
}
