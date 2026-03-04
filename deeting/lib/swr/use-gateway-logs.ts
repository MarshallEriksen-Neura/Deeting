import useSWR, { type SWRConfiguration } from "swr"
import { swrFetcher, type SWRResult } from "./fetcher"
import { fetchAdminGatewayLogs } from "@/lib/api/admin-dashboard"
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

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

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

const parseCursorToSkip = (cursor: string | null | undefined): number => {
  if (!cursor) return 0
  const value = Number.parseInt(cursor, 10)
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

const applyLocalOnlyFilters = (
  item: GatewayLogDTO,
  query: GatewayLogQuery | undefined
): boolean => {
  if (!query?.error_code && !query?.start_time && !query?.end_time) return true

  if (query.error_code && item.error_code !== query.error_code) {
    return false
  }

  const createdAt = new Date(item.created_at).getTime()
  if (query.start_time) {
    const start = new Date(query.start_time).getTime()
    if (Number.isFinite(start) && createdAt < start) return false
  }
  if (query.end_time) {
    const end = new Date(query.end_time).getTime()
    if (Number.isFinite(end) && createdAt > end) return false
  }

  return true
}

const toGatewayLogDTO = (item: Awaited<ReturnType<typeof fetchAdminGatewayLogs>>["items"][number]) =>
  ({
    id: item.id,
    user_id: item.user_id ?? null,
    preset_id: null,
    model: item.model,
    status_code: item.status_code,
    duration_ms: item.duration_ms,
    ttft_ms: item.ttft_ms ?? null,
    input_tokens: item.input_tokens,
    output_tokens: item.output_tokens,
    total_tokens: item.input_tokens + item.output_tokens,
    cost_upstream: item.cost_user,
    cost_user: item.cost_user,
    is_cached: item.is_cached,
    error_code: item.error_code ?? null,
    created_at: item.created_at,
  }) satisfies GatewayLogDTO

export async function fetchGatewayLogsForQuery(
  query: GatewayLogQuery | undefined
): Promise<CursorPage<GatewayLogDTO>> {
  const size = query?.size ?? 20
  const skip = parseCursorToSkip(query?.cursor)
  const data = await fetchAdminGatewayLogs({
    skip,
    limit: size,
    model: query?.model,
    status_code: query?.status_code,
    is_cached: query?.is_cached,
  })

  const items = data.items.map(toGatewayLogDTO).filter((item) => applyLocalOnlyFilters(item, query))
  const nextSkip = skip + size
  const previousSkip = Math.max(0, skip - size)

  return {
    items,
    next_page: nextSkip < data.total ? String(nextSkip) : null,
    previous_page: skip > 0 ? String(previousSkip) : null,
  }
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
  return useSWR<CursorPage<GatewayLogDTO>, ApiError>(
    key,
    async ([url]) => {
      if (isTauriRuntime()) {
        return fetchGatewayLogsForQuery(query)
      }
      return swrFetcher<CursorPage<GatewayLogDTO>>([url])
    },
    config
  )
}
