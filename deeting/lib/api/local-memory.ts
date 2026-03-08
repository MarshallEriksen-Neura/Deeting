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
  embedding_model: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  vitality: z.number().nullable().optional(),
  last_accessed_at: z.string().nullable().optional(),
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

export const LocalMemorySearchItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  session_id: z.string().nullable().optional(),
  assistant_id: z.string().nullable().optional(),
  meta_info: z.record(z.string(), z.any()).nullable().optional(),
  score: z.number(),
  category: z.string().nullable().optional(),
  vitality: z.number().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type LocalMemorySearchItem = z.infer<typeof LocalMemorySearchItemSchema>

export const LocalMemorySearchResultSchema = z.object({
  items: z.array(LocalMemorySearchItemSchema).default([]),
})

export type LocalMemorySearchResult = z.infer<typeof LocalMemorySearchResultSchema>

export const WriteGuardResultSchema = z.object({
  action: z.enum(["add", "update", "noop"]),
  item: LocalMemoryItemSchema.nullable().optional(),
  similarity_score: z.number().nullable().optional(),
  updated_memory_id: z.string().nullable().optional(),
})

export type WriteGuardResult = z.infer<typeof WriteGuardResultSchema>

export type AppendLocalMemoryRequest = {
  content: string
  session_id?: string | null
  assistant_id?: string | null
  meta_info?: Record<string, any> | null
  category?: string | null
  source?: string | null
  tags?: string[] | null
}

export type LocalMemoryListQuery = {
  cursor?: string | null
  limit?: number | null
  session_id?: string | null
  assistant_id?: string | null
}

export type LocalMemorySearchQuery = {
  query: string
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
      category: payload.category ?? null,
      source: payload.source ?? null,
      tags: payload.tags ?? null,
    },
  })
  return LocalMemoryItemSchema.parse(data)
}

export async function appendLocalMemoryGuarded(
  payload: AppendLocalMemoryRequest
): Promise<WriteGuardResult> {
  ensureTauriRuntime()
  const data = await invokeTauri<WriteGuardResult>("append_local_memory_guarded", {
    payload: {
      content: payload.content,
      session_id: payload.session_id ?? null,
      assistant_id: payload.assistant_id ?? null,
      meta_info: payload.meta_info ?? null,
      category: payload.category ?? null,
      source: payload.source ?? null,
      tags: payload.tags ?? null,
    },
  })
  return WriteGuardResultSchema.parse(data)
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

export async function searchLocalMemories(
  query: LocalMemorySearchQuery
): Promise<LocalMemorySearchResult> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemorySearchResult>("search_local_memories", {
    query: {
      query: query.query,
      limit: query.limit ?? null,
      session_id: query.session_id ?? null,
      assistant_id: query.assistant_id ?? null,
    },
  })
  return LocalMemorySearchResultSchema.parse(data)
}

export async function deleteLocalMemory(id: string): Promise<LocalMemoryDeleteResponse> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemoryDeleteResponse>("delete_local_memory", { id })
  return LocalMemoryDeleteResponseSchema.parse(data)
}

// --- Snapshot & Rollback Types ---

export const LocalMemorySnapshotSchema = z.object({
  id: z.string(),
  memory_id: z.string(),
  action: z.string(),
  old_content: z.string().nullable().optional(),
  new_content: z.string().nullable().optional(),
  old_metadata: z.record(z.string(), z.any()).nullable().optional(),
  new_metadata: z.record(z.string(), z.any()).nullable().optional(),
  created_at: z.string(),
})

export type LocalMemorySnapshot = z.infer<typeof LocalMemorySnapshotSchema>

export async function listMemorySnapshots(
  memoryId: string,
  limit: number = 20
): Promise<LocalMemorySnapshot[]> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemorySnapshot[]>("list_memory_snapshots", {
    memoryId,
    limit,
  })
  return z.array(LocalMemorySnapshotSchema).parse(data)
}

export async function rollbackMemory(
  snapshotId: string
): Promise<LocalMemoryItem | null> {
  ensureTauriRuntime()
  const data = await invokeTauri<LocalMemoryItem | null>("rollback_memory", {
    snapshotId,
  })
  return data ? LocalMemoryItemSchema.parse(data) : null
}

// --- Unified Search ---

export type UnifiedSearchSource = "memory" | "knowledge" | "summary"

export const UnifiedSearchResultSchema = z.object({
  id: z.string(),
  source: z.enum(["memory", "knowledge", "summary"]),
  content: z.string(),
  score: z.number(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
})

export type UnifiedSearchResultItem = z.infer<typeof UnifiedSearchResultSchema>

export async function searchUnified(
  query: string,
  limit: number = 10
): Promise<UnifiedSearchResultItem[]> {
  ensureTauriRuntime()
  const data = await invokeTauri<UnifiedSearchResultItem[]>("search_unified", {
    query,
    limit,
  })
  return z.array(UnifiedSearchResultSchema).parse(data)
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

// --- Knowledge Semantic Search ---

export const KnowledgeSearchResultSchema = z.object({
  chunk_id: z.string(),
  content: z.string(),
  score: z.number(),
  document_id: z.string().nullable().optional(),
  document_name: z.string().nullable().optional(),
  chunk_index: z.number().int().nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
})

export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>

export async function searchKnowledgeSemantic(
  query: string,
  limit?: number
): Promise<KnowledgeSearchResult[]> {
  ensureTauriRuntime()
  const data = await invokeTauri<KnowledgeSearchResult[]>("search_knowledge_semantic", {
    query,
    limit: limit ?? 10,
  })
  return z.array(KnowledgeSearchResultSchema).parse(data)
}
