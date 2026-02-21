export interface MemoryItem {
  id: string
  content: string
  payload: Record<string, any>
  score?: number
}

export interface MemoryListResponse {
  items: MemoryItem[]
  next_cursor?: string | null
}

export interface MemoryUpdateRequest {
  content: string
}
