export interface MemoryItem {
  id: string
  content: string
  payload?: Record<string, unknown>
  session_id?: string | null
  assistant_id?: string | null
  capability_id?: string | null
  category?: string | null
  source?: string | null
  tags?: string[] | null
  vitality?: number | null
  last_accessed_at?: string | null
  recall_when?: string | null
  memory_tier?: string | null
  is_core?: boolean | null
  is_boot?: boolean | null
  created_at?: string
  updated_at?: string
  score?: number
}

export interface MemoryListResponse {
  items: MemoryItem[]
  next_cursor?: string | null
}

export interface MemorySearchParams {
  query: string
  limit?: number
  session_id?: string | null
  assistant_id?: string | null
  capability_id?: string | null
  category?: string | null
  source?: string | null
  tags?: string[] | null
}

export interface MemoryUpdateRequest {
  content: string
  recall_when?: string | null
  memory_tier?: string | null
  is_core?: boolean | null
  is_boot?: boolean | null
}

export interface MemorySnapshotItem {
  id: string
  memory_id: string
  action: string
  old_content?: string | null
  new_content?: string | null
  old_metadata?: Record<string, unknown> | string | null
  new_metadata?: Record<string, unknown> | string | null
  created_at: string
  updated_at?: string
}

export interface MemorySnapshotListResponse {
  items: MemorySnapshotItem[]
}

export interface MemoryRollbackResponse {
  success: boolean
  memory_point_id: string
  restored_content?: string | null
}
