import { z } from "zod"
import { request } from "@/lib/http"
import { computePreferredDesktopCacheRate } from "@/lib/gateway-log/cache-metrics"
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

export const DashboardOverviewSchema = z.object({
  stats: DashboardStatsSchema,
  tokenThroughput: TokenThroughputSchema,
  smartRouterStats: SmartRouterStatsSchema,
  providerHealth: z.array(ProviderHealthSchema),
  recentErrors: z.array(RecentErrorSchema),
})

// Types
export type DashboardStats = z.infer<typeof DashboardStatsSchema>
export type TokenThroughput = z.infer<typeof TokenThroughputSchema>
export type SmartRouterStats = z.infer<typeof SmartRouterStatsSchema>
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>
export type RecentError = z.infer<typeof RecentErrorSchema>
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>

// =====================
// API Functions
// =====================

const DASHBOARD_BASE = "/api/v1/dashboard"
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const LOCAL_LOG_PAGE_SIZE = 500
const LOCAL_DASHBOARD_CACHE_TTL_MS = 5_000
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

type LocalGatewayLogStats = Awaited<ReturnType<typeof fetchAdminGatewayLogStats>>
type LocalGatewayStatsWindow = {
  current24h: LocalGatewayLogStats
  previous24h: LocalGatewayLogStats
  today: LocalGatewayLogStats
  yesterday: LocalGatewayLogStats
  month: LocalGatewayLogStats
}
type LocalGatewayLogCacheEntry = {
  maxItems: number
  items: GatewayLogItem[]
  fetchedAt: number
}

type LocalGatewayStatsCacheEntry = {
  value: LocalGatewayLogStats
  fetchedAt: number
}

let localGatewayLogCache: LocalGatewayLogCacheEntry | null = null
let localGatewayLogInflight: { maxItems: number; promise: Promise<GatewayLogItem[]> } | null = null
let localGatewayStatsCache: LocalGatewayStatsCacheEntry | null = null
let localGatewayStatsInflight: Promise<LocalGatewayLogStats> | null = null

export function __resetLocalDashboardCacheForTests(): void {
  localGatewayLogCache = null
  localGatewayLogInflight = null
  localGatewayStatsCache = null
  localGatewayStatsInflight = null
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

function isLocalDashboardCacheFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < LOCAL_DASHBOARD_CACHE_TTL_MS
}

async function loadLocalGatewayLogs(maxItems: number): Promise<GatewayLogItem[]> {
  const safeMax = Math.max(1, Math.floor(maxItems))

  if (
    localGatewayLogCache &&
    localGatewayLogCache.maxItems >= safeMax &&
    isLocalDashboardCacheFresh(localGatewayLogCache.fetchedAt)
  ) {
    return localGatewayLogCache.items.slice(0, safeMax)
  }

  if (localGatewayLogInflight && localGatewayLogInflight.maxItems >= safeMax) {
    const items = await localGatewayLogInflight.promise
    return items.slice(0, safeMax)
  }

  const items: GatewayLogItem[] = []
  let skip = 0
  const promise = (async () => {
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

    localGatewayLogCache = {
      maxItems: safeMax,
      items,
      fetchedAt: Date.now(),
    }

    return items
  })()

  localGatewayLogInflight = {
    maxItems: safeMax,
    promise,
  }

  try {
    const resolved = await promise
    return resolved.slice(0, safeMax)
  } finally {
    if (localGatewayLogInflight?.promise === promise) {
      localGatewayLogInflight = null
    }
  }
}

async function loadLocalGatewayStats(): Promise<LocalGatewayLogStats> {
  if (localGatewayStatsCache && isLocalDashboardCacheFresh(localGatewayStatsCache.fetchedAt)) {
    return localGatewayStatsCache.value
  }

  if (localGatewayStatsInflight) {
    return localGatewayStatsInflight
  }

  const promise = (async () => {
    const value = await fetchAdminGatewayLogStats()
    localGatewayStatsCache = {
      value,
      fetchedAt: Date.now(),
    }
    return value
  })()

  localGatewayStatsInflight = promise

  try {
    return await promise
  } finally {
    if (localGatewayStatsInflight === promise) {
      localGatewayStatsInflight = null
    }
  }
}

async function loadLocalGatewayStatsWindow(nowTs: number): Promise<LocalGatewayStatsWindow> {
  const dayStart = startOfDayTs(nowTs)
  const yesterdayStart = dayStart - DAY_MS
  const nowDate = new Date(nowTs)
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime()
  const nextDayStart = dayStart + DAY_MS

  const [current24h, previous24h, today, yesterday, month] = await Promise.all([
    fetchAdminGatewayLogStats({
      start_time: new Date(nowTs - DAY_MS).toISOString(),
      end_time: new Date(nowTs).toISOString(),
    }),
    fetchAdminGatewayLogStats({
      start_time: new Date(nowTs - 2 * DAY_MS).toISOString(),
      end_time: new Date(nowTs - DAY_MS).toISOString(),
    }),
    fetchAdminGatewayLogStats({
      start_time: new Date(dayStart).toISOString(),
      end_time: new Date(nextDayStart).toISOString(),
    }),
    fetchAdminGatewayLogStats({
      start_time: new Date(yesterdayStart).toISOString(),
      end_time: new Date(dayStart).toISOString(),
    }),
    fetchAdminGatewayLogStats({
      start_time: new Date(monthStart).toISOString(),
      end_time: new Date(nowTs).toISOString(),
    }),
  ])

  return { current24h, previous24h, today, yesterday, month }
}

async function loadLocalProviderHealth(): Promise<ProviderHealth[]> {
  const data = await invokeTauri<unknown[]>("list_local_provider_health")
  return z.array(ProviderHealthSchema).parse(data)
}

function computeDashboardStatsFromLocal(
  localStats: LocalGatewayLogStats,
  logs: GatewayLogItem[],
  nowTs: number
): DashboardStats {
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
  const avgTtftCurrent = average(last24Logs.map(getPreferredLatency).filter((value) => value > 0))
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

function computeDashboardStatsFromLocalStats(
  statsWindow: LocalGatewayStatsWindow,
  logs: GatewayLogItem[],
  nowTs: number
): DashboardStats {
  const dayStart = startOfDayTs(nowTs)
  const nowDate = new Date(nowTs)
  const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate()
  const passedDays = Math.max(1, nowDate.getDate())
  const monthlySpent = statsWindow.month.total_cost_user
  const avgTtftCurrent = average(logs.map(getPreferredLatency).filter((value) => value > 0))
  const avgTtft = avgTtftCurrent > 0 ? avgTtftCurrent : statsWindow.current24h.avg_duration_ms

  const hourlyTrend = Array.from({ length: 24 }, () => 0)
  for (const log of logs) {
    const ts = toTimestamp(log.created_at)
    if (ts == null || ts < dayStart || ts >= dayStart + DAY_MS) continue
    const hourIdx = Math.floor((ts - dayStart) / HOUR_MS)
    if (hourIdx >= 0 && hourIdx < 24) {
      hourlyTrend[hourIdx] += 1
    }
  }

  return DashboardStatsSchema.parse({
    financial: {
      monthlySpent,
      balance: 0,
      quotaUsedPercent: 0,
      estimatedMonthEnd: (monthlySpent / passedDays) * daysInMonth,
    },
    traffic: {
      todayRequests: statsWindow.today.total,
      hourlyTrend,
      trendPercent: percentChange(statsWindow.today.total, statsWindow.yesterday.total),
    },
    speed: {
      avgTTFT: avgTtft,
      trendPercent: percentChange(
        statsWindow.current24h.avg_duration_ms,
        statsWindow.previous24h.avg_duration_ms
      ),
    },
    health: {
      successRate: statsWindow.current24h.success_rate,
      totalRequests: statsWindow.current24h.total,
      successfulRequests: Math.round(
        (statsWindow.current24h.total * statsWindow.current24h.success_rate) / 100
      ),
    },
  })
}

function computeTokenThroughputFromLocal(
  logs: GatewayLogItem[],
  period: "24h" | "7d" | "30d",
  nowTs: number
): TokenThroughput {
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

function computeSmartRouterStatsFromLocal(
  stats: LocalGatewayLogStats,
  logs: GatewayLogItem[]
): SmartRouterStats {
  const cacheHitRate = computePreferredDesktopCacheRate(
    logs,
    toFiniteNumber(stats.cache_hit_rate, 0)
  )
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
    cacheHitRate,
    costSavings,
    requestsBlocked: blocked,
    avgSpeedup: Number(speedup.toFixed(2)),
  })
}

function computeRecentErrorsFromLocal(logs: GatewayLogItem[], limit: number): RecentError[] {
  const safeLimit = Math.max(1, Math.floor(limit))
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
    .slice(0, safeLimit)
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

export async function fetchDashboardOverview(options?: {
  source?: DashboardDataSource
  period?: "24h" | "7d" | "30d"
  recentErrorLimit?: number
}): Promise<DashboardOverview> {
  const period = options?.period ?? "24h"
  const recentErrorLimit = Math.max(1, Math.floor(options?.recentErrorLimit ?? 10))

  if (shouldUseLocal(options?.source)) {
    const maxItems = Math.max(
      5000,
      period === "30d" ? 10000 : 5000,
      Math.max(500, recentErrorLimit * 40)
    )
    const nowTs = Date.now()
    const [statsWindow, logs, providerHealth] = await Promise.all([
      loadLocalGatewayStatsWindow(nowTs),
      loadLocalGatewayLogs(maxItems),
      loadLocalProviderHealth(),
    ])

    return DashboardOverviewSchema.parse({
      stats: computeDashboardStatsFromLocalStats(statsWindow, logs, nowTs),
      tokenThroughput: computeTokenThroughputFromLocal(logs, period, nowTs),
      smartRouterStats: computeSmartRouterStatsFromLocal(statsWindow.current24h, logs),
      providerHealth,
      recentErrors: computeRecentErrorsFromLocal(logs, recentErrorLimit),
    })
  }

  const [stats, tokenThroughput, smartRouterStats, providerHealth, recentErrors] = await Promise.all([
    fetchDashboardStats({ source: options?.source }),
    fetchTokenThroughput({ period, source: options?.source }),
    fetchSmartRouterStats({ source: options?.source }),
    fetchProviderHealth({ source: options?.source }),
    fetchRecentErrors({ limit: recentErrorLimit, source: options?.source }),
  ])

  return DashboardOverviewSchema.parse({
    stats,
    tokenThroughput,
    smartRouterStats,
    providerHealth,
    recentErrors,
  })
}

/**
 * Fetch overall dashboard statistics
 */
export async function fetchDashboardStats(options?: {
  source?: DashboardDataSource
}): Promise<DashboardStats> {
  if (shouldUseLocal(options?.source)) {
    const nowTs = Date.now()
    const [statsWindow, logs] = await Promise.all([
      loadLocalGatewayStatsWindow(nowTs),
      loadLocalGatewayLogs(5000),
    ])
    return computeDashboardStatsFromLocalStats(statsWindow, logs, nowTs)
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
    return computeTokenThroughputFromLocal(logs, period, Date.now())
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
      loadLocalGatewayStats(),
      loadLocalGatewayLogs(3000),
    ])
    return computeSmartRouterStatsFromLocal(stats, logs)
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
    return loadLocalProviderHealth()
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
    return computeRecentErrorsFromLocal(logs, limit)
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
