export interface MemoryItem {
  id: string
  content: string
  payload?: Record<string, unknown>
  session_id?: string | null
  assistant_id?: string | null
  category?: string | null
  source?: string | null
  tags?: string[] | null
  vitality?: number | null
  last_accessed_at?: string | null
  created_at?: string
  updated_at?: string
  score?: number
}

export interface MemoryListResponse {
  items: MemoryItem[]
  next_cursor?: string | null
}

export interface MemoryUpdateRequest {
  content: string
}
