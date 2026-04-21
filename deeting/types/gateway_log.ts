export interface GatewayLogDTO {
  id: string
  user_id: string | null
  preset_id: string | null
  model: string
  status_code: number
  duration_ms: number
  ttft_ms: number | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_upstream: number
  cost_user: number
  is_cached: boolean
  cached_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_write_input_tokens?: number | null
  cache_source?: string | null
  usage_source?: string | null
  error_code: string | null
  meta?: Record<string, unknown> | null
  created_at: string
}
