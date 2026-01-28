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

export const ConversationHistoryResponseSchema = z.object({
  session_id: z.string(),
  messages: z.array(ConversationMessageSchema).default([]),
  next_cursor: z.number().int().nullable().optional(),
  has_more: z.boolean().default(false),
})

export type ConversationHistoryResponse = z.infer<typeof ConversationHistoryResponseSchema>

const isConversationMessageLike = (value: unknown): value is ConversationMessage =>
  Boolean(value) && typeof value === "object" && "role" in value

const normalizeConversationHistoryPayload = (
  sessionId: string,
  payload: unknown
): ConversationHistoryResponse => {
  if (Array.isArray(payload)) {
    return {
      session_id: sessionId,
      messages: payload.filter(isConversationMessageLike),
      next_cursor: null,
      has_more: false,
    }
  }

  if (!payload || typeof payload !== "object") {
    return { session_id: sessionId, messages: [], next_cursor: null, has_more: false }
  }

  const record = payload as Record<string, unknown>
  const rawMessages = Array.isArray(record.messages) ? record.messages : []
  const nextCursor =
    typeof record.next_cursor === "number"
      ? record.next_cursor
      : typeof record.next_cursor === "string" && record.next_cursor.trim()
        ? Number(record.next_cursor)
        : null

  return {
    session_id:
      typeof record.session_id === "string" && record.session_id.trim()
        ? record.session_id
        : sessionId,
    messages: rawMessages.filter(isConversationMessageLike),
    next_cursor: Number.isFinite(nextCursor) ? nextCursor : null,
    has_more: typeof record.has_more === "boolean" ? record.has_more : false,
  }
}

export async function fetchConversationHistory(
  sessionId: string,
  options: { cursor?: number; limit?: number } = {}
): Promise<ConversationHistoryResponse> {
  const params = new URLSearchParams()
  if (options.cursor) {
    params.set("cursor", String(options.cursor))
  }
  if (options.limit) {
    params.set("limit", String(options.limit))
  }
  const query = params.toString()

  try {
    const data = await request({
      url: `${CONVERSATION_BASE}/${sessionId}/history${query ? `?${query}` : ""}`,
      method: "GET",
    })

    const normalized = normalizeConversationHistoryPayload(sessionId, data)
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return normalized
    }

    try {
      const result = ConversationHistoryResponseSchema.safeParse(data)
      if (result.success) {
        return result.data
      }
      console.warn("Conversation history schema mismatch, fallback to normalized payload.", result.error)
    } catch (error) {
      console.warn("Conversation history schema parse failed, fallback to normalized payload.", error)
    }

    return normalized
  } catch (error) {
    console.error("Failed to fetch conversation history:", error)
    return { session_id: sessionId, messages: [], next_cursor: null, has_more: false }
  }
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

export const ConversationCreateResponseSchema = z.object({
  session_id: z.string(),
  title: z.string().nullable().optional(),
})

export type ConversationCreateResponse = z.infer<typeof ConversationCreateResponseSchema>

export type ConversationCreateRequest = {
  assistant_id?: string | null
  title?: string | null
}

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

export async function createConversation(
  payload: ConversationCreateRequest = {}
): Promise<ConversationCreateResponse> {
  const data = await request({
    url: CONVERSATION_BASE,
    method: "POST",
    data: payload,
  })
  return ConversationCreateResponseSchema.parse(data)
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
