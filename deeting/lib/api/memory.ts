import { request } from "@/lib/http"
import {
  appendLocalMemory,
  clearLocalMemories,
  deleteLocalMemory,
  listLocalMemories,
  type LocalMemoryItem,
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

function toMemoryItem(item: LocalMemoryItem): MemoryItem {
  return {
    id: item.id,
    content: item.content,
    payload: item.meta_info ?? {},
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
    let cursor: string | null = null
    let target: LocalMemoryItem | null = null

    do {
      const page = await listLocalMemories({
        limit: LOCAL_PAGE_LIMIT,
        cursor,
      })
      target = page.items.find((item) => item.id === memoryId) ?? null
      if (target) break
      cursor = page.next_cursor ?? null
    } while (cursor)

    if (!target) {
      throw new Error(`memory not found: ${memoryId}`)
    }

    const appended = await appendLocalMemory({
      content: data.content,
      session_id: target.session_id ?? null,
      assistant_id: target.assistant_id ?? null,
      meta_info: target.meta_info ?? null,
    })

    try {
      await deleteLocalMemory(memoryId)
    } catch (error) {
      await deleteLocalMemory(appended.id).catch(() => undefined)
      throw error
    }

    return toMemoryItem(appended)
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
