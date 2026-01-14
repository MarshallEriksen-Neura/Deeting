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
  error_code: string | null
  created_at: string
}
