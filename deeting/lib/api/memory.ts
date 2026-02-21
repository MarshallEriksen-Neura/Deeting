import { request } from "@/lib/http"
import type {
  MemoryItem,
  MemoryListResponse,
  MemoryUpdateRequest,
} from "@/types/memory"

const BASE = "/api/v1/memory"

export async function fetchMemories(params?: {
  limit?: number
  cursor?: string | null
}): Promise<MemoryListResponse> {
  return request<MemoryListResponse>({
    url: BASE,
    params,
  })
}

export async function updateMemory(
  memoryId: string,
  data: MemoryUpdateRequest
): Promise<MemoryItem> {
  return request<MemoryItem>({
    url: `${BASE}/${memoryId}`,
    method: "PATCH",
    data,
  })
}

export async function deleteMemory(memoryId: string): Promise<void> {
  await request({
    url: `${BASE}/${memoryId}`,
    method: "DELETE",
  })
}

export async function clearAllMemories(): Promise<void> {
  await request({
    url: BASE,
    method: "DELETE",
  })
}
