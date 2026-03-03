import { z } from "zod"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const LocalMemoryItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  session_id: z.string().nullable().optional(),
  assistant_id: z.string().nullable().optional(),
  meta_info: z.record(z.string(), z.any()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type LocalMemoryItem = z.infer<typeof LocalMemoryItemSchema>

export const LocalMemoryListResponseSchema = z.object({
  items: z.array(LocalMemoryItemSchema).default([]),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().default(false),
})

export type LocalMemoryListResponse = z.infer<typeof LocalMemoryListResponseSchema>

export const LocalMemoryDeleteResponseSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
})

export type LocalMemoryDeleteResponse = z.infer<typeof LocalMemoryDeleteResponseSchema>

export const LocalMemoryClearResponseSchema = z.object({
  cleared: z.number().int(),
})

export type LocalMemoryClearResponse = z.infer<typeof LocalMemoryClearResponseSchema>

export type AppendLocalMemoryRequest = {
  content: string
  session_id?: string | null
  assistant_id?: string | null
  meta_info?: Record<string, any> | null
}

export type LocalMemoryListQuery = {
  cursor?: string | null
  limit?: number | null
  session_id?: string | null
  assistant_id?: string | null
}

export type ClearLocalMemoriesRequest = {
  session_id?: string | null
  assistant_id?: string | null
}

function ensureTauriRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("local memory api is only supported in Tauri runtime")
  }
}

export async function appendLocalMemory(
  payload: AppendLocalMemoryRequest
): Promise<LocalMemoryItem> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemoryItem>("append_local_memory", {
    payload: {
      content: payload.content,
      session_id: payload.session_id ?? null,
      assistant_id: payload.assistant_id ?? null,
      meta_info: payload.meta_info ?? null,
    },
  })
  return LocalMemoryItemSchema.parse(data)
}

export async function listLocalMemories(
  query: LocalMemoryListQuery = {}
): Promise<LocalMemoryListResponse> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemoryListResponse>("list_local_memories", {
    query: {
      cursor: query.cursor ?? null,
      limit: query.limit ?? null,
      session_id: query.session_id ?? null,
      assistant_id: query.assistant_id ?? null,
    },
  })
  return LocalMemoryListResponseSchema.parse(data)
}

export async function deleteLocalMemory(id: string): Promise<LocalMemoryDeleteResponse> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemoryDeleteResponse>("delete_local_memory", { id })
  return LocalMemoryDeleteResponseSchema.parse(data)
}

export async function clearLocalMemories(
  payload: ClearLocalMemoriesRequest = {}
): Promise<LocalMemoryClearResponse> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemoryClearResponse>("clear_local_memories", {
    payload: {
      session_id: payload.session_id ?? null,
      assistant_id: payload.assistant_id ?? null,
    },
  })
  return LocalMemoryClearResponseSchema.parse(data)
}
