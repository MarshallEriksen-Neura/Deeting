import { type GatewayLogDTO } from "@/types/gateway_log"

export interface GatewayLogListResponse {
  items: GatewayLogDTO[]
  total: number
  page: number
  page_size: number
}

export interface GatewayLogListParams {
  page?: number
  page_size?: number
  user_id?: string
  preset_id?: string
  model?: string
  status_code?: number
}
