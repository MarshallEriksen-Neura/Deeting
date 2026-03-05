import { z } from "zod"

import { request } from "@/lib/http"
import { handleModelConfigRequiredError } from "@/lib/model-config-required"

const CONVERSATION_BASE = "/api/v1/internal/conversations"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    handleModelConfigRequiredError(error)
    throw error
  }
}

const LOCAL_CHAT_STREAM_EVENT = "local-chat-stream"

export type LocalConversationStreamEvent = {
  request_id?: string | null
  trace_id?: string | null
  type?: string
  stage?: string | null
  code?: string | null
  delta?: string | null
  message?: string | null
  error_code?: string | null
  blocks?: unknown
  meta?: unknown
}

export type LocalConversationStreamOptions = {
  onStreamEvent?: (event: LocalConversationStreamEvent) => void
}

const normalizeRequestId = (value?: string | null): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function withLocalConversationStream<T>(
  requestId: string | null,
  options: LocalConversationStreamOptions | undefined,
  run: () => Promise<T>
): Promise<T> {
  const onStreamEvent = options?.onStreamEvent
  if (!onStreamEvent || !requestId || !isTauriRuntime()) {
    return run()
  }

  let unlisten: (() => void) | undefined
  try {
    try {
      const { listen } = await import("@tauri-apps/api/event")
      unlisten = await listen<LocalConversationStreamEvent>(
        LOCAL_CHAT_STREAM_EVENT,
        (event) => {
          const payload = event?.payload
          if (!payload || typeof payload !== "object") return
          const payloadRequestId = normalizeRequestId((payload as LocalConversationStreamEvent).request_id)
          if (!payloadRequestId || payloadRequestId !== requestId) return
          onStreamEvent(payload as LocalConversationStreamEvent)
        }
      )
    } catch (error) {
      console.warn("local_conversation_stream_subscribe_failed", error)
    }

    return await run()
  } finally {
    try {
      unlisten?.()
    } catch {
      // ignore unlisten errors
    }
  }
}

export const ConversationMessageSchema = z.object({
  role: z.string(),
  content: z.any().nullable().optional(),
  turn_index: z.number().int().nullable().optional(),
  created_at: z.string().nullable().optional(),
  is_truncated: z.boolean().nullable().optional(),
  name: z.string().nullable().optional(),
  meta_info: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough()

export const ConversationWindowSchema = z.object({
  session_id: z.string(),
  messages: z.array(ConversationMessageSchema).default([]),
  meta: z.record(z.string(), z.any()).nullable().optional(),
  summary: z.record(z.string(), z.any()).nullable().optional(),
})

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>
export type ConversationWindow = z.infer<typeof ConversationWindowSchema>

export async function fetchConversationWindow(sessionId: string): Promise<ConversationWindow> {
  if (isTauriRuntime()) {
    try {
      const data = await invokeTauri<ConversationWindow>("get_local_conversation_window", {
        sessionId,
      })
      return ConversationWindowSchema.parse(data)
    } catch {
      const history = await invokeTauri<ConversationHistoryResponse>(
        "list_local_conversation_history",
        { query: { session_id: sessionId, limit: 200 } }
      )
      return ConversationWindowSchema.parse({
        session_id: sessionId,
        messages: history.messages ?? [],
        meta: null,
        summary: null,
      })
    }
  }
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
  if (isTauriRuntime()) {
    try {
      const data = await invokeTauri<ConversationHistoryResponse>(
        "list_local_conversation_history",
        {
          query: {
            session_id: sessionId,
            cursor: options.cursor ?? null,
            limit: options.limit ?? null,
          },
        }
      )
      const normalized = normalizeConversationHistoryPayload(sessionId, data)
      const parsed = ConversationHistoryResponseSchema.safeParse(data)
      return parsed.success ? parsed.data : normalized
    } catch {
      return { session_id: sessionId, messages: [], next_cursor: null, has_more: false }
    }
  }

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

export const ConversationDeleteResponseSchema = z.object({
  session_id: z.string(),
  turn_index: z.number().int(),
  deleted: z.boolean(),
})

export type ConversationDeleteResponse = z.infer<typeof ConversationDeleteResponseSchema>

export const ConversationClearResponseSchema = z.object({
  session_id: z.string(),
  cleared: z.boolean(),
})

export type ConversationClearResponse = z.infer<typeof ConversationClearResponseSchema>

export const ConversationRegenerateResponseSchema = z.object({
  session_id: z.string(),
  deleted_turn_index: z.number().int().nullable().optional(),
  message: ConversationMessageSchema,
})

export type ConversationRegenerateResponse = z.infer<typeof ConversationRegenerateResponseSchema>

export const ConversationSendResponseSchema = z.object({
  session_id: z.string(),
  user_message: ConversationMessageSchema,
  assistant_message: ConversationMessageSchema,
})

export type ConversationSendResponse = z.infer<typeof ConversationSendResponseSchema>
export const ConversationCancelResponseSchema = z.object({
  request_id: z.string(),
  status: z.enum(["cancelled", "not_found"]),
})
export type ConversationCancelResponse = z.infer<typeof ConversationCancelResponseSchema>

export type ConversationRegenerateRequest = {
  model: string
  provider_model_id?: string | null
  temperature?: number
  top_p?: number
  max_tokens?: number
  request_id?: string | null
}

export type ConversationSendRequest = {
  content: string
  model: string
  provider_model_id?: string | null
  temperature?: number
  top_p?: number
  max_tokens?: number
  request_id?: string | null
  assistant_id?: string | null
}

export type ConversationSessionsQuery = {
  cursor?: string | null
  size?: number
  assistant_id?: string | null
  status?: ConversationSessionStatus
}

export async function fetchConversationSessions(
  query: ConversationSessionsQuery
): Promise<ConversationSessionPage> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<ConversationSessionPage>("list_local_conversations", {
      query: {
        cursor: query.cursor ?? null,
        size: query.size ?? null,
        assistant_id: query.assistant_id ?? null,
        status: query.status ?? "active",
      },
    })
    return ConversationSessionPageSchema.parse(data)
  }

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
  if (isTauriRuntime()) {
    const data = await invokeTauri<ConversationCreateResponse>("create_local_conversation", {
      payload: {
        assistant_id: payload.assistant_id ?? null,
        title: payload.title ?? null,
      },
    })
    return ConversationCreateResponseSchema.parse(data)
  }

  const data = await request({
    url: CONVERSATION_BASE,
    method: "POST",
    data: payload,
  })
  return ConversationCreateResponseSchema.parse(data)
}

export async function archiveConversation(sessionId: string): Promise<ConversationArchiveResponse> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<ConversationArchiveResponse>("archive_local_conversation", {
      sessionId,
    })
    return ConversationArchiveResponseSchema.parse(data)
  }

  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}/archive`,
    method: "POST",
  })
  return ConversationArchiveResponseSchema.parse(data)
}

export async function unarchiveConversation(sessionId: string): Promise<ConversationArchiveResponse> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<ConversationArchiveResponse>("unarchive_local_conversation", {
      sessionId,
    })
    return ConversationArchiveResponseSchema.parse(data)
  }

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
  if (isTauriRuntime()) {
    const data = await invokeTauri<ConversationRenameResponse>("rename_local_conversation", {
      sessionId,
      payload: { title },
    })
    return ConversationRenameResponseSchema.parse(data)
  }

  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}/title`,
    method: "PATCH",
    data: { title },
  })
  return ConversationRenameResponseSchema.parse(data)
}

export async function deleteConversationMessage(
  sessionId: string,
  turnIndex: number
): Promise<ConversationDeleteResponse> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<ConversationDeleteResponse>("delete_local_conversation_message", {
      sessionId,
      turnIndex,
    })
    return ConversationDeleteResponseSchema.parse(data)
  }

  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}/messages/${turnIndex}`,
    method: "DELETE",
  })
  return ConversationDeleteResponseSchema.parse(data)
}

export async function clearConversation(sessionId: string): Promise<ConversationClearResponse> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<ConversationClearResponse>("clear_local_conversation", {
      sessionId,
    })
    return ConversationClearResponseSchema.parse(data)
  }

  const data = await request({
    url: `${CONVERSATION_BASE}/${sessionId}/clear`,
    method: "POST",
  })
  return ConversationClearResponseSchema.parse(data)
}

export async function regenerateConversationReply(
  sessionId: string,
  payload: ConversationRegenerateRequest,
  options?: LocalConversationStreamOptions
): Promise<ConversationRegenerateResponse> {
  if (isTauriRuntime()) {
    const requestId = normalizeRequestId(payload.request_id)
    const data = await withLocalConversationStream(requestId, options, () =>
      invokeTauri<ConversationRegenerateResponse>("regenerate_local_conversation_reply", {
        payload: {
          session_id: sessionId,
          model: payload.model,
          provider_model_id: payload.provider_model_id ?? null,
          temperature: payload.temperature ?? null,
          top_p: payload.top_p ?? null,
          max_tokens: payload.max_tokens ?? null,
          request_id: requestId,
        },
      })
    )
    return ConversationRegenerateResponseSchema.parse(data)
  }

  const data = await request<{
    session_id?: string | null
    choices?: Array<{ message?: { content?: string | null } }>
  }>({
    url: `${CONVERSATION_BASE}/${sessionId}/regenerate`,
    method: "POST",
    data: {
      model: payload.model,
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
    },
  })

  const content = data?.choices?.[0]?.message?.content ?? ""
  return ConversationRegenerateResponseSchema.parse({
    session_id: data?.session_id || sessionId,
    deleted_turn_index: null,
    message: {
      role: "assistant",
      content,
      turn_index: null,
      created_at: null,
      is_truncated: null,
      name: null,
      meta_info: null,
    },
  })
}

export async function sendConversationMessage(
  sessionId: string,
  payload: ConversationSendRequest,
  options?: LocalConversationStreamOptions
): Promise<ConversationSendResponse> {
  if (!isTauriRuntime()) {
    throw new Error("sendConversationMessage is only supported in Tauri runtime")
  }

  const requestId = normalizeRequestId(payload.request_id)
  const data = await withLocalConversationStream(requestId, options, () =>
    invokeTauri<ConversationSendResponse>("send_local_conversation_message", {
      payload: {
        session_id: sessionId,
        assistant_id: payload.assistant_id ?? null,
        content: payload.content,
        model: payload.model,
        provider_model_id: payload.provider_model_id ?? null,
        temperature: payload.temperature ?? null,
        top_p: payload.top_p ?? null,
        max_tokens: payload.max_tokens ?? null,
        request_id: requestId,
      },
    })
  )
  return ConversationSendResponseSchema.parse(data)
}

export async function cancelLocalConversationRequest(
  requestId: string
): Promise<ConversationCancelResponse> {
  if (!isTauriRuntime()) {
    throw new Error("cancelLocalConversationRequest is only supported in Tauri runtime")
  }

  const normalized = normalizeRequestId(requestId)
  if (!normalized) {
    throw new Error("request_id is required")
  }

  const data = await invokeTauri<ConversationCancelResponse>(
    "cancel_local_conversation_request",
    { requestId: normalized }
  )
  return ConversationCancelResponseSchema.parse(data)
}
