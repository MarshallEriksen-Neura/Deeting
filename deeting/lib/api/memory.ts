import { request } from "@/lib/http"
import {
  clearLocalMemories,
  deleteLocalMemory,
  listLocalMemories,
  type LocalMemoryItem,
  type LocalMemorySearchItem,
  updateLocalMemory,
} from "@/lib/api/local-memory"
import type {
  MemoryItem,
  MemoryListResponse,
  MemoryUpdateRequest,
} from "@/types/memory"

const BASE = "/api/v1/memory"
const LOCAL_PAGE_LIMIT = 200

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

type DesktopMemoryLike = LocalMemoryItem | LocalMemorySearchItem

export function toMemoryItem(item: DesktopMemoryLike): MemoryItem {
  return {
    id: item.id,
    content: item.content,
    payload: {
      ...(item.meta_info ?? {}),
      ...(item.category ? { category: item.category } : {}),
      ...(item.source ? { source: item.source } : {}),
      ...(item.tags ? { tags: item.tags } : {}),
      ...(item.vitality != null ? { vitality: item.vitality } : {}),
      ...(item.last_accessed_at ? { last_accessed_at: item.last_accessed_at } : {}),
    },
    session_id: item.session_id ?? null,
    assistant_id: item.assistant_id ?? null,
    category: item.category ?? null,
    source: item.source ?? null,
    tags: item.tags ?? null,
    vitality: item.vitality ?? null,
    last_accessed_at: item.last_accessed_at ?? null,
    created_at: item.created_at,
    updated_at: item.updated_at,
    score: "score" in item ? item.score : undefined,
  }
}

export async function fetchMemories(params?: {
  limit?: number
  cursor?: string | null
}): Promise<MemoryListResponse> {
  if (isTauriRuntime()) {
    const data = await listLocalMemories({
      limit: params?.limit ?? LOCAL_PAGE_LIMIT,
      cursor: params?.cursor ?? null,
    })
    return {
      items: data.items.map(toMemoryItem),
      next_cursor: data.next_cursor ?? null,
    }
  }

  return request<MemoryListResponse>({
    url: BASE,
    params,
  })
}

export async function updateMemory(
  memoryId: string,
  data: MemoryUpdateRequest
): Promise<MemoryItem> {
  if (isTauriRuntime()) {
    const updated = await updateLocalMemory(memoryId, {
      content: data.content,
    })
    return toMemoryItem(updated)
  }

  return request<MemoryItem>({
    url: `${BASE}/${memoryId}`,
    method: "PATCH",
    data,
  })
}

export async function deleteMemory(memoryId: string): Promise<void> {
  if (isTauriRuntime()) {
    await deleteLocalMemory(memoryId)
    return
  }

  await request({
    url: `${BASE}/${memoryId}`,
    method: "DELETE",
  })
}

export async function clearAllMemories(): Promise<void> {
  if (isTauriRuntime()) {
    await clearLocalMemories()
    return
  }

  await request({
    url: BASE,
    method: "DELETE",
  })
}
