import { request } from "@/lib/http"
import type {
  MemoryItem,
  MemoryListResponse,
  MemoryUpdateRequest,
} from "@/types/memory"

const BASE = "/api/v1/admin/memory"

export async function fetchAdminSystemMemories(params?: {
  limit?: number
  cursor?: string | null
}): Promise<MemoryListResponse> {
  return request<MemoryListResponse>({
    url: BASE,
    params,
  })
}

export async function addAdminSystemMemory(
  data: MemoryUpdateRequest
): Promise<MemoryItem> {
  return request<MemoryItem>({
    url: BASE,
    method: "POST",
    data,
  })
}

export async function updateAdminSystemMemory(
  memoryId: string,
  data: MemoryUpdateRequest
): Promise<MemoryItem> {
  return request<MemoryItem>({
    url: `${BASE}/${memoryId}`,
    method: "PATCH",
    data,
  })
}

export async function deleteAdminSystemMemory(memoryId: string): Promise<void> {
  await request({
    url: `${BASE}/${memoryId}`,
    method: "DELETE",
  })
}
