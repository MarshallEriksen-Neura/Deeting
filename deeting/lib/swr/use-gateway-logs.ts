import useSWR, { type SWRConfiguration } from "swr"
import { swrFetcher, type SWRResult } from "./fetcher"
import { fetchAdminGatewayLogs, fetchAdminGatewayLogStats } from "@/lib/api/admin-dashboard"
import type { GatewayLogDTO } from "@/types/gateway_log"
import type { CursorPage } from "@/types/pagination"
import type { ApiError } from "@/lib/http/client"

export type GatewayLogQuery = {
  cursor?: string | null
  size?: number
  start_time?: string
  end_time?: string
  user_id?: string
  api_key_id?: string
  preset_id?: string
  model?: string
  status_code?: number
  is_cached?: boolean
  error_code?: string
}

type GatewayLogStatsQuery = Omit<GatewayLogQuery, "cursor" | "size">

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
  if (query.user_id) params.set("user_id", query.user_id)
  if (query.api_key_id) params.set("api_key_id", query.api_key_id)
  if (query.preset_id) params.set("preset_id", query.preset_id)
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

const toGatewayLogFilterQuery = (query: GatewayLogQuery | undefined): GatewayLogStatsQuery => {
  if (!query) return {}

  return {
    start_time: query.start_time,
    end_time: query.end_time,
    user_id: query.user_id,
    api_key_id: query.api_key_id,
    preset_id: query.preset_id,
    model: query.model,
    status_code: query.status_code,
    is_cached: query.is_cached,
    error_code: query.error_code,
  }
}

const toGatewayLogDTO = (item: Awaited<ReturnType<typeof fetchAdminGatewayLogs>>["items"][number]) =>
  ({
    id: item.id,
    user_id: item.user_id ?? null,
    preset_id: item.preset_id ?? null,
    model: item.model,
    status_code: item.status_code,
    duration_ms: item.duration_ms,
    ttft_ms: item.ttft_ms ?? null,
    input_tokens: item.input_tokens,
    output_tokens: item.output_tokens,
    total_tokens: item.total_tokens,
    cost_upstream: item.cost_upstream,
    cost_user: item.cost_user,
    is_cached: item.is_cached,
    cached_tokens: item.cached_tokens ?? null,
    cache_read_input_tokens: item.cache_read_input_tokens ?? null,
    cache_write_input_tokens: item.cache_write_input_tokens ?? null,
    cache_source: item.cache_source ?? null,
    usage_source: item.usage_source ?? null,
    error_code: item.error_code ?? null,
    meta:
      item.meta && typeof item.meta === "object"
        ? (item.meta as Record<string, unknown>)
        : null,
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
    ...toGatewayLogFilterQuery(query),
  })

  const items = data.items.map(toGatewayLogDTO)
  const nextSkip = skip + size
  const previousSkip = Math.max(0, skip - size)

  return {
    items,
    next_page: nextSkip < data.total ? String(nextSkip) : null,
    previous_page: skip > 0 ? String(previousSkip) : null,
  }
}

export async function fetchGatewayLogStatsForQuery(query: GatewayLogQuery | undefined) {
  return fetchAdminGatewayLogStats(toGatewayLogFilterQuery(query))
}

export const getGatewayLogStatsKey = (query: GatewayLogQuery | undefined): [string] | null => {
  const qs = buildQueryString(toGatewayLogFilterQuery(query))
  return ["/api/v1/logs/stats" + qs]
}

export function useGatewayLogStats(
  query: GatewayLogQuery | undefined,
  config?: SWRConfiguration<Awaited<ReturnType<typeof fetchAdminGatewayLogStats>>, ApiError>
): SWRResult<Awaited<ReturnType<typeof fetchAdminGatewayLogStats>>> {
  const key = getGatewayLogStatsKey(query)
  return useSWR(key, async ([url]) => {
    if (isTauriRuntime()) {
      return fetchGatewayLogStatsForQuery(query)
    }
    return swrFetcher([url])
  }, config)
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
