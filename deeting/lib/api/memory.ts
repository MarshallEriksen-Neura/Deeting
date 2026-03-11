import { request } from "@/lib/http"
import {
  clearLocalMemories,
  deleteLocalMemory,
  listLocalMemories,
  listMemorySnapshots as listLocalMemorySnapshots,
  type LocalMemoryItem,
  type LocalMemorySearchItem,
  rollbackMemory as rollbackLocalMemory,
  searchLocalMemories,
  type LocalMemorySnapshot,
  updateLocalMemory,
} from "@/lib/api/local-memory"
import type {
  MemoryItem,
  MemoryListResponse,
  MemoryRollbackResponse,
  MemorySearchParams,
  MemorySnapshotItem,
  MemorySnapshotListResponse,
  MemoryUpdateRequest,
} from "@/types/memory"

const BASE = "/api/v1/memory"
const LOCAL_PAGE_LIMIT = 200

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

type DesktopMemoryLike = LocalMemoryItem | LocalMemorySearchItem

type CloudMemorySnapshotLike = {
  id: string
  memory_point_id: string
  action: string
  old_content?: string | null
  new_content?: string | null
  old_metadata?: Record<string, unknown> | string | null
  new_metadata?: Record<string, unknown> | string | null
  created_at: string
  updated_at?: string
}

function readStringField(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function readBooleanField(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key]
  return typeof value === "boolean" ? value : null
}

function buildDesktopMetaInfo(data: MemoryUpdateRequest) {
  const metaInfo: Record<string, unknown> = {}

  if (data.recall_when !== undefined) {
    if (data.recall_when && data.recall_when.trim().length > 0) {
      metaInfo.recall_when = data.recall_when.trim()
    } else {
      metaInfo.recall_when = null
    }
  }

  if (data.memory_tier !== undefined) {
    if (data.memory_tier && data.memory_tier.trim().length > 0) {
      metaInfo.memory_tier = data.memory_tier.trim()
    } else {
      metaInfo.memory_tier = null
    }
  }

  if (data.is_core !== undefined) {
    metaInfo.is_core = data.is_core
  }

  if (data.is_boot !== undefined) {
    metaInfo.is_boot = data.is_boot
  }

  return Object.keys(metaInfo).length > 0 ? metaInfo : undefined
}

export function toMemoryItem(item: DesktopMemoryLike): MemoryItem {
  const payload = {
    ...(item.meta_info ?? {}),
    ...(item.category ? { category: item.category } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.tags ? { tags: item.tags } : {}),
    ...(item.vitality != null ? { vitality: item.vitality } : {}),
    ...(item.last_accessed_at ? { last_accessed_at: item.last_accessed_at } : {}),
  }

  return {
    id: item.id,
    content: item.content,
    payload,
    session_id: item.session_id ?? null,
    capability_id: item.capability_id ?? null,
    category: item.category ?? null,
    source: item.source ?? null,
    tags: item.tags ?? null,
    vitality: item.vitality ?? null,
    last_accessed_at: item.last_accessed_at ?? null,
    recall_when: readStringField(payload, "recall_when"),
    memory_tier: readStringField(payload, "memory_tier"),
    is_core: readBooleanField(payload, "is_core"),
    is_boot: readBooleanField(payload, "is_boot"),
    created_at: item.created_at,
    updated_at: item.updated_at,
    score: "score" in item ? item.score : undefined,
  }
}

function toMemorySnapshotItem(
  item: LocalMemorySnapshot | CloudMemorySnapshotLike
): MemorySnapshotItem {
  return {
    id: item.id,
    memory_id: "memory_id" in item ? item.memory_id : item.memory_point_id,
    action: item.action,
    old_content: item.old_content ?? null,
    new_content: item.new_content ?? null,
    old_metadata: item.old_metadata ?? null,
    new_metadata: item.new_metadata ?? null,
    created_at: item.created_at,
    ...(item.updated_at ? { updated_at: item.updated_at } : {}),
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
      meta_info: buildDesktopMetaInfo(data),
    })
    return toMemoryItem(updated)
  }

  return request<MemoryItem>({
    url: `${BASE}/${memoryId}`,
    method: "PATCH",
    data,
  })
}

export async function searchMemories(params: MemorySearchParams): Promise<MemoryItem[]> {
  if (isTauriRuntime()) {
    const result = await searchLocalMemories({
      query: params.query,
      limit: params.limit ?? null,
      session_id: params.session_id ?? null,
      capability_id: params.capability_id ?? null,
      category: params.category ?? null,
      source: params.source ?? null,
      tags: params.tags ?? null,
    })
    return result.items.map(toMemoryItem)
  }

  return request<MemoryItem[]>({
    url: `${BASE}/search`,
    params: {
      q: params.query,
      limit: params.limit,
      session_id: params.session_id,
      capability_id: params.capability_id,
      category: params.category,
      source: params.source,
      tags: params.tags,
    },
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

export async function listMemorySnapshots(
  memoryId: string,
  limit: number = 20
): Promise<MemorySnapshotItem[]> {
  if (isTauriRuntime()) {
    const snapshots = await listLocalMemorySnapshots(memoryId, limit)
    return snapshots.map(toMemorySnapshotItem)
  }

  const response = await request<MemorySnapshotListResponse & { items: CloudMemorySnapshotLike[] }>({
    url: `${BASE}/${memoryId}/snapshots`,
    params: { limit },
  })
  return response.items.map(toMemorySnapshotItem)
}

export async function rollbackMemory(
  memoryId: string,
  snapshotId: string
): Promise<MemoryRollbackResponse> {
  if (isTauriRuntime()) {
    const restored = await rollbackLocalMemory(snapshotId)
    return {
      success: restored != null,
      memory_point_id: memoryId,
      restored_content: restored?.content ?? null,
    }
  }

  return request<MemoryRollbackResponse>({
    url: `${BASE}/${memoryId}/rollback`,
    method: "POST",
    data: { snapshot_id: snapshotId },
  })
}
