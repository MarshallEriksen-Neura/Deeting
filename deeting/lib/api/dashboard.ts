import { z } from "zod"
import { request } from "@/lib/http"
import {
  fetchAdminGatewayLogs,
  fetchAdminGatewayLogStats,
  type GatewayLogItem,
} from "@/lib/api/admin-dashboard"

// =====================
// Schema Definitions
// =====================

export const DashboardStatsSchema = z.object({
  financial: z.object({
    monthlySpent: z.number(),
    balance: z.number(),
    quotaUsedPercent: z.number(),
    estimatedMonthEnd: z.number().nullish(),
  }),
  traffic: z.object({
    todayRequests: z.number(),
    hourlyTrend: z.array(z.number()),
    trendPercent: z.number().nullish(),
  }),
  speed: z.object({
    avgTTFT: z.number(),
    trendPercent: z.number().nullish(),
  }),
  health: z.object({
    successRate: z.number(),
    totalRequests: z.number(),
    successfulRequests: z.number(),
  }),
})

export const TokenThroughputSchema = z.object({
  timeline: z.array(
    z.object({
      time: z.string(),
      inputTokens: z.number(),
      outputTokens: z.number(),
    })
  ),
  totalInput: z.number(),
  totalOutput: z.number(),
  ratio: z.number(),
})

export const SmartRouterStatsSchema = z.object({
  cacheHitRate: z.number(),
  costSavings: z.number(),
  requestsBlocked: z.number(),
  avgSpeedup: z.number(),
})

export const ProviderHealthSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "down", "degraded", "unknown"]),
  priority: z.number(),
  latency: z.number(),
  sparkline: z.array(z.number()).nullish().transform((value) => value ?? undefined),
})

export const RecentErrorSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  statusCode: z.number(),
  model: z.string(),
  errorMessage: z.string(),
  errorCode: z.string().nullish().transform((value) => value ?? undefined),
})

// Types
export type DashboardStats = z.infer<typeof DashboardStatsSchema>
export type TokenThroughput = z.infer<typeof TokenThroughputSchema>
export type SmartRouterStats = z.infer<typeof SmartRouterStatsSchema>
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>
export type RecentError = z.infer<typeof RecentErrorSchema>

// =====================
// API Functions
// =====================

const DASHBOARD_BASE = "/api/v1/dashboard"
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const LOCAL_LOG_PAGE_SIZE = 500
export type DashboardDataSource = "auto" | "local" | "cloud"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

type LocalProviderInstance = {
  id: string
  name?: string | null
  is_enabled?: boolean
  priority?: number
}

type LocalProviderModel = {
  id: string
  is_active?: boolean
  extra_meta?: Record<string, unknown> | null
}

function toTimestamp(value?: string | null): number | null {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function percentChange(current: number, previous: number): number | undefined {
  if (previous <= 0) {
    return current > 0 ? 100 : undefined
  }
  return ((current - previous) / previous) * 100
}

function isSuccessStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 400
}

function startOfDayTs(sourceTs: number): number {
  const date = new Date(sourceTs)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function getPreferredLatency(log: GatewayLogItem): number {
  const ttft = toFiniteNumber(log.ttft_ms, 0)
  if (ttft > 0) return ttft
  const duration = toFiniteNumber(log.duration_ms, 0)
  return duration > 0 ? duration : 0
}

async function loadLocalGatewayLogs(maxItems: number): Promise<GatewayLogItem[]> {
  const safeMax = Math.max(1, Math.floor(maxItems))
  const items: GatewayLogItem[] = []
  let skip = 0

  while (skip < safeMax) {
    const limit = Math.min(LOCAL_LOG_PAGE_SIZE, safeMax - skip)
    const page = await fetchAdminGatewayLogs({ skip, limit })
    const pageItems = Array.isArray(page.items) ? page.items : []
    if (pageItems.length === 0) break
    items.push(...pageItems)
    skip += pageItems.length
    if (skip >= page.total || pageItems.length < limit) {
      break
    }
  }

  return items
}

function buildTokenBuckets(
  logs: GatewayLogItem[],
  period: "24h" | "7d" | "30d",
  nowTs: number
): { time: string; inputTokens: number; outputTokens: number }[] {
  if (period === "24h") {
    const bucketStart = nowTs - 23 * HOUR_MS
    const buckets = Array.from({ length: 24 }, (_, index) => ({
      time: new Date(bucketStart + index * HOUR_MS).toISOString(),
      inputTokens: 0,
      outputTokens: 0,
    }))

    for (const log of logs) {
      const ts = toTimestamp(log.created_at)
      if (ts == null || ts < bucketStart || ts > nowTs) continue
      const idx = Math.floor((ts - bucketStart) / HOUR_MS)
      if (idx < 0 || idx >= buckets.length) continue
      buckets[idx].inputTokens += Math.max(0, toFiniteNumber(log.input_tokens, 0))
      buckets[idx].outputTokens += Math.max(0, toFiniteNumber(log.output_tokens, 0))
    }

    return buckets
  }

  const days = period === "7d" ? 7 : 30
  const todayStart = startOfDayTs(nowTs)
  const bucketStart = todayStart - (days - 1) * DAY_MS
  const buckets = Array.from({ length: days }, (_, index) => ({
    time: new Date(bucketStart + index * DAY_MS).toISOString(),
    inputTokens: 0,
    outputTokens: 0,
  }))

  for (const log of logs) {
    const ts = toTimestamp(log.created_at)
    if (ts == null || ts < bucketStart || ts > nowTs) continue
    const idx = Math.floor((startOfDayTs(ts) - bucketStart) / DAY_MS)
    if (idx < 0 || idx >= buckets.length) continue
    buckets[idx].inputTokens += Math.max(0, toFiniteNumber(log.input_tokens, 0))
    buckets[idx].outputTokens += Math.max(0, toFiniteNumber(log.output_tokens, 0))
  }

  return buckets
}

function toProviderLatency(model: LocalProviderModel): number {
  const meta = model.extra_meta
  if (!meta || typeof meta !== "object") return 0

  const fields: Array<keyof typeof meta> = ["latency_ms", "avg_latency_ms", "ttft_ms"]
  for (const key of fields) {
    const value = toFiniteNumber(meta[key], 0)
    if (value > 0) return value
  }

  return 0
}

function shouldUseLocal(source: DashboardDataSource = "auto"): boolean {
  if (source === "cloud") return false
  if (source === "local") return true
  return isTauriRuntime()
}

/**
 * Fetch overall dashboard statistics
 */
export async function fetchDashboardStats(options?: {
  source?: DashboardDataSource
}): Promise<DashboardStats> {
  if (shouldUseLocal(options?.source)) {
    const [localStats, logs] = await Promise.all([
      fetchAdminGatewayLogStats(),
      loadLocalGatewayLogs(5000),
    ])
    const nowTs = Date.now()
    const dayStart = startOfDayTs(nowTs)
    const yesterdayStart = dayStart - DAY_MS
    const nowDate = new Date(nowTs)
    const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime()
    const nextDayStart = dayStart + DAY_MS

    const todayLogs = logs.filter((item) => {
      const ts = toTimestamp(item.created_at)
      return ts != null && ts >= dayStart && ts < nextDayStart
    })
    const yesterdayLogs = logs.filter((item) => {
      const ts = toTimestamp(item.created_at)
      return ts != null && ts >= yesterdayStart && ts < dayStart
    })
    const last24Logs = logs.filter((item) => {
      const ts = toTimestamp(item.created_at)
      return ts != null && ts >= nowTs - DAY_MS && ts <= nowTs
    })
    const previous24Logs = logs.filter((item) => {
      const ts = toTimestamp(item.created_at)
      return ts != null && ts >= nowTs - 2 * DAY_MS && ts < nowTs - DAY_MS
    })
    const currentMonthLogs = logs.filter((item) => {
      const ts = toTimestamp(item.created_at)
      return ts != null && ts >= monthStart && ts <= nowTs
    })

    const hourlyTrend = Array.from({ length: 24 }, () => 0)
    for (const log of todayLogs) {
      const ts = toTimestamp(log.created_at)
      if (ts == null) continue
      const hourIdx = Math.floor((ts - dayStart) / HOUR_MS)
      if (hourIdx >= 0 && hourIdx < 24) {
        hourlyTrend[hourIdx] += 1
      }
    }

    const last24CountableLogs = last24Logs.filter((item) => toFiniteNumber(item.status_code, 0) > 0)
    const successful24h = last24CountableLogs.filter((item) =>
      isSuccessStatus(toFiniteNumber(item.status_code, 0))
    ).length
    const total24h = last24CountableLogs.length
    const recentHealthRate =
      total24h > 0 ? (successful24h / total24h) * 100 : toFiniteNumber(localStats.success_rate, 0)
    const avgTtftCurrent = average(
      last24Logs.map(getPreferredLatency).filter((value) => value > 0)
    )
    const avgTtftPrevious = average(
      previous24Logs.map(getPreferredLatency).filter((value) => value > 0)
    )

    const monthlySpent = currentMonthLogs.reduce(
      (sum, item) => sum + Math.max(0, toFiniteNumber(item.cost_user, 0)),
      0
    )
    const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate()
    const passedDays = Math.max(1, nowDate.getDate())
    const estimatedMonthEnd = passedDays > 0 ? (monthlySpent / passedDays) * daysInMonth : null

    return DashboardStatsSchema.parse({
      financial: {
        monthlySpent,
        balance: 0,
        quotaUsedPercent: 0,
        estimatedMonthEnd,
      },
      traffic: {
        todayRequests: todayLogs.length,
        hourlyTrend,
        trendPercent: percentChange(todayLogs.length, yesterdayLogs.length),
      },
      speed: {
        avgTTFT: avgTtftCurrent,
        trendPercent: percentChange(avgTtftCurrent, avgTtftPrevious),
      },
      health: {
        successRate: recentHealthRate,
        totalRequests: total24h,
        successfulRequests: successful24h,
      },
    })
  }

  const data = await request<DashboardStats>({
    url: `${DASHBOARD_BASE}/stats`,
    method: "GET",
  })
  return DashboardStatsSchema.parse(data)
}

/**
 * Fetch token throughput data
 */
export async function fetchTokenThroughput(
  params?: {
    period?: "24h" | "7d" | "30d"
    source?: DashboardDataSource
  }
): Promise<TokenThroughput> {
  if (shouldUseLocal(params?.source)) {
    const period = params?.period ?? "24h"
    const maxItems = period === "30d" ? 10000 : 5000
    const logs = await loadLocalGatewayLogs(maxItems)
    const nowTs = Date.now()
    const timeline = buildTokenBuckets(logs, period, nowTs)
    const totalInput = timeline.reduce((sum, item) => sum + item.inputTokens, 0)
    const totalOutput = timeline.reduce((sum, item) => sum + item.outputTokens, 0)

    return TokenThroughputSchema.parse({
      timeline,
      totalInput,
      totalOutput,
      ratio: totalInput > 0 ? totalOutput / totalInput : 0,
    })
  }

  const data = await request<TokenThroughput>({
    url: `${DASHBOARD_BASE}/token-throughput`,
    method: "GET",
    params: {
      period: params?.period,
    },
  })
  return TokenThroughputSchema.parse(data)
}

/**
 * Fetch smart router statistics
 */
export async function fetchSmartRouterStats(options?: {
  source?: DashboardDataSource
}): Promise<SmartRouterStats> {
  if (shouldUseLocal(options?.source)) {
    const [stats, logs] = await Promise.all([
      fetchAdminGatewayLogStats(),
      loadLocalGatewayLogs(3000),
    ])
    const cachedDurations = logs
      .filter((item) => item.is_cached)
      .map((item) => toFiniteNumber(item.duration_ms, 0))
      .filter((value) => value > 0)
    const uncachedDurations = logs
      .filter((item) => !item.is_cached)
      .map((item) => toFiniteNumber(item.duration_ms, 0))
      .filter((value) => value > 0)
    const avgCached = average(cachedDurations)
    const avgUncached = average(uncachedDurations)
    const speedup = avgCached > 0 && avgUncached > 0 ? avgUncached / avgCached : 0
    const blocked = logs.filter((item) => {
      const code = toFiniteNumber(item.status_code, 0)
      return code === 403 || code === 429
    }).length
    const directSavings = logs.reduce((sum, item) => {
      const upstreamCost = Math.max(0, toFiniteNumber(item.cost_upstream, 0))
      const userCost = Math.max(0, toFiniteNumber(item.cost_user, 0))
      return sum + Math.max(0, upstreamCost - userCost)
    }, 0)
    const cachedCosts = logs
      .filter((item) => item.is_cached)
      .map((item) => Math.max(0, toFiniteNumber(item.cost_user, 0)))
    const uncachedCosts = logs
      .filter((item) => !item.is_cached)
      .map((item) => Math.max(0, toFiniteNumber(item.cost_user, 0)))
      .filter((value) => value > 0)
    const avgUncachedCost = average(uncachedCosts)
    const fallbackSavings =
      avgUncachedCost > 0
        ? Math.max(
            0,
            avgUncachedCost * cachedCosts.length -
              cachedCosts.reduce((sum, value) => sum + value, 0)
          )
        : 0
    const costSavings = Number((directSavings > 0 ? directSavings : fallbackSavings).toFixed(6))

    return SmartRouterStatsSchema.parse({
      cacheHitRate: toFiniteNumber(stats.cache_hit_rate, 0),
      costSavings,
      requestsBlocked: blocked,
      avgSpeedup: Number(speedup.toFixed(2)),
    })
  }

  const data = await request<SmartRouterStats>({
    url: `${DASHBOARD_BASE}/smart-router-stats`,
    method: "GET",
  })
  return SmartRouterStatsSchema.parse(data)
}

/**
 * Fetch provider health status
 */
export async function fetchProviderHealth(options?: {
  source?: DashboardDataSource
}): Promise<ProviderHealth[]> {
  if (shouldUseLocal(options?.source)) {
    const instances = await invokeTauri<LocalProviderInstance[]>("list_local_provider_instances")
    const normalized = await Promise.all(
      (instances ?? []).map(async (instance, index) => {
        if (instance.is_enabled === false) {
          return {
            id: instance.id,
            name: instance.name || "Local Provider",
            status: "down" as const,
            priority: toFiniteNumber(instance.priority, index + 1),
            latency: 0,
            sparkline: [],
          }
        }

        const models = await invokeTauri<LocalProviderModel[]>("list_local_provider_models", {
          instanceId: instance.id,
        })
        const activeModels = (models ?? []).filter((item) => item.is_active !== false)
        const latencies = activeModels.map(toProviderLatency).filter((value) => value > 0)
        const avgLatency = average(latencies)
        const status: ProviderHealth["status"] =
          activeModels.length === 0 ? "unknown" : avgLatency >= 5000 ? "degraded" : "active"

        return {
          id: instance.id,
          name: instance.name || "Local Provider",
          status,
          priority: toFiniteNumber(instance.priority, index + 1),
          latency: Math.round(avgLatency),
          sparkline: latencies.slice(-8),
        }
      })
    )

    normalized.sort((a, b) => a.priority - b.priority)
    return z.array(ProviderHealthSchema).parse(normalized)
  }

  const data = await request<ProviderHealth[]>({
    url: `${DASHBOARD_BASE}/provider-health`,
    method: "GET",
  })
  return z.array(ProviderHealthSchema).parse(data)
}

/**
 * Fetch recent errors
 */
export async function fetchRecentErrors(
  params?: {
    limit?: number
    source?: DashboardDataSource
  }
): Promise<RecentError[]> {
  if (shouldUseLocal(params?.source)) {
    const limit = Math.max(1, Math.floor(params?.limit ?? 10))
    const logs = await loadLocalGatewayLogs(Math.max(500, limit * 40))
    const errors = logs
      .filter((item) => {
        const code = toFiniteNumber(item.status_code, 0)
        return code >= 400 || Boolean(item.error_code)
      })
      .sort((a, b) => {
        const aTs = toTimestamp(a.created_at) ?? 0
        const bTs = toTimestamp(b.created_at) ?? 0
        return bTs - aTs
      })
      .slice(0, limit)
      .map((item) => {
        const statusCode = toFiniteNumber(item.status_code, 0)
        const errorCode = item.error_code?.trim() || undefined
        return {
          id: item.id,
          timestamp: item.created_at,
          statusCode,
          model: item.model,
          errorMessage: errorCode || `HTTP ${statusCode}`,
          errorCode,
        }
      })

    return z.array(RecentErrorSchema).parse(errors)
  }

  const data = await request<RecentError[]>({
    url: `${DASHBOARD_BASE}/recent-errors`,
    method: "GET",
    params: {
      limit: params?.limit || 10,
    },
  })
  return z.array(RecentErrorSchema).parse(data)
}
