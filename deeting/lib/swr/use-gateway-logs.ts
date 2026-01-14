import useSWR, { type SWRConfiguration } from "swr"
import { swrFetcher, type SWRResult } from "./fetcher"
import type { GatewayLogDTO } from "@/types/gateway_log"
import type { CursorPage } from "@/types/pagination"
import type { ApiError } from "@/lib/http/client"

export type GatewayLogQuery = {
  cursor?: string | null
  size?: number
  start_time?: string
  end_time?: string
  model?: string
  status_code?: number
  is_cached?: boolean
  error_code?: string
}

const buildQueryString = (query: GatewayLogQuery | undefined) => {
  if (!query) return ""
  const params = new URLSearchParams()
  if (query.cursor) params.set("cursor", query.cursor)
  if (query.size) params.set("size", String(query.size))
  if (query.start_time) params.set("start_time", query.start_time)
  if (query.end_time) params.set("end_time", query.end_time)
  if (query.model) params.set("model", query.model)
  if (query.status_code !== undefined) params.set("status_code", String(query.status_code))
  if (query.is_cached !== undefined) params.set("is_cached", String(query.is_cached))
  if (query.error_code) params.set("error_code", query.error_code)
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export const getGatewayLogsKey = (query: GatewayLogQuery | undefined): [string] | null => {
  const qs = buildQueryString(query)
  return ["/api/v1/logs" + qs]
}

export function useGatewayLogs(
  query: GatewayLogQuery | undefined,
  config?: SWRConfiguration<CursorPage<GatewayLogDTO>, ApiError>
): SWRResult<CursorPage<GatewayLogDTO>> {
  const key = getGatewayLogsKey(query)
  return useSWR<CursorPage<GatewayLogDTO>, ApiError>(key, swrFetcher, config)
}
