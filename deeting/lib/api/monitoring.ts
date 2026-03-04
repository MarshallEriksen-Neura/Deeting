import { z } from "zod"
import { request } from "@/lib/http"
import { fetchAdminGatewayLogs } from "@/lib/api/admin-dashboard"

export type MonitoringTimeRange = "24h" | "7d" | "30d"

export type MonitoringQueryFilters = {
  timeRange?: MonitoringTimeRange
  model?: string
  apiKey?: string
  errorCode?: string
}

// =====================
// Schema Definitions
// =====================

export const LatencyHeatmapSchema = z.object({
  grid: z.array(
    z.array(
      z.object({
        intensity: z.number(),
        count: z.number(),
      })
    )
  ),
  peakLatency: z.number(),
  medianLatency: z.number(),
})

export const PercentileTrendsSchema = z.object({
  timeline: z.array(
    z.object({
      time: z.string(),
      p50: z.number(),
      p99: z.number(),
    })
  ),
})

export const ModelCostBreakdownSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      cost: z.number(),
      percentage: z.number(),
    })
  ),
})

export const ErrorDistributionSchema = z.object({
  categories: z.array(
    z.object({
      category: z.string(),
      label: z.string(),
      count: z.number(),
      color: z.string(),
    })
  ),
})

export const KeyActivityRankingSchema = z.object({
  keys: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      maskedKey: z.string(),
      rpm: z.number(),
      trend: z.number(),
    })
  ),
})

// Types
export type LatencyHeatmap = z.infer<typeof LatencyHeatmapSchema>
export type PercentileTrends = z.infer<typeof PercentileTrendsSchema>
export type ModelCostBreakdown = z.infer<typeof ModelCostBreakdownSchema>
export type ErrorDistribution = z.infer<typeof ErrorDistributionSchema>
export type KeyActivityRanking = z.infer<typeof KeyActivityRankingSchema>

// =====================
// API Functions
// =====================

const MONITORING_BASE = "/api/v1/monitoring"
const LOCAL_LOG_PAGE_SIZE = 500
const LOCAL_LOG_MAX_SCAN = 5000

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

type LocalGatewayLogItem = Awaited<ReturnType<typeof fetchAdminGatewayLogs>>["items"][number]

function getRangeMs(timeRange: MonitoringTimeRange = "24h"): number {
  if (timeRange === "7d") return 7 * 24 * 60 * 60 * 1000
  if (timeRange === "30d") return 30 * 24 * 60 * 60 * 1000
  return 24 * 60 * 60 * 1000
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

function matchErrorCodeFilter(
  log: LocalGatewayLogItem,
  errorCode: MonitoringQueryFilters["errorCode"]
): boolean {
  if (!errorCode) return true
  if (errorCode === "4xx") return log.status_code >= 400 && log.status_code < 500
  if (errorCode === "5xx") return log.status_code >= 500
  if (errorCode === "429") return log.status_code === 429 || log.error_code === "429"
  return log.error_code === errorCode
}

function matchMonitoringFilters(
  log: LocalGatewayLogItem,
  params: MonitoringQueryFilters | undefined,
  nowMs: number
): boolean {
  const rangeMs = getRangeMs(params?.timeRange)
  const startMs = nowMs - rangeMs
  const createdMs = new Date(log.created_at).getTime()
  if (!Number.isFinite(createdMs) || createdMs < startMs || createdMs > nowMs) return false
  if (params?.model && log.model !== params.model) return false
  if (params?.apiKey && log.api_key_id !== params.apiKey) return false
  return matchErrorCodeFilter(log, params?.errorCode)
}

async function fetchLocalMonitoringLogs(
  params: MonitoringQueryFilters | undefined
): Promise<LocalGatewayLogItem[]> {
  const nowMs = Date.now()
  let skip = 0
  const logs: LocalGatewayLogItem[] = []

  while (skip < LOCAL_LOG_MAX_SCAN) {
    const page = await fetchAdminGatewayLogs({
      skip,
      limit: LOCAL_LOG_PAGE_SIZE,
      model: params?.model,
    })

    if (!page.items.length) break
    logs.push(...page.items)

    skip += page.items.length
    if (page.items.length < LOCAL_LOG_PAGE_SIZE || skip >= page.total) break
  }

  return logs.filter((log) => matchMonitoringFilters(log, params, nowMs))
}

/**
 * Fetch latency heatmap data
 */
export async function fetchLatencyHeatmap(
  params?: MonitoringQueryFilters
): Promise<LatencyHeatmap> {
  if (isTauriRuntime()) {
    const logs = await fetchLocalMonitoringLogs(params)
    const columns = 24
    const rows = 20
    const maxLatency = 2000
    const nowMs = Date.now()
    const rangeMs = getRangeMs(params?.timeRange)
    const startMs = nowMs - rangeMs
    const grid = Array.from({ length: columns }, () =>
      Array.from({ length: rows }, () => ({ intensity: 0, count: 0 }))
    )
    const durations = logs.map((log) => Math.max(0, log.duration_ms))

    for (const log of logs) {
      const createdMs = new Date(log.created_at).getTime()
      const relative = Math.min(Math.max(createdMs - startMs, 0), rangeMs)
      const col = Math.min(columns - 1, Math.max(0, Math.floor((relative / rangeMs) * columns)))
      const clampedLatency = Math.min(maxLatency, Math.max(0, log.duration_ms))
      const row = Math.min(rows - 1, Math.max(0, Math.floor((clampedLatency / maxLatency) * rows)))
      const cell = grid[col]?.[row]
      if (cell) {
        cell.count += 1
      }
    }

    const peakCount = Math.max(0, ...grid.flatMap((column) => column.map((cell) => cell.count)))
    for (const column of grid) {
      for (const cell of column) {
        cell.intensity = peakCount > 0 ? cell.count / peakCount : 0
      }
    }

    return LatencyHeatmapSchema.parse({
      grid,
      peakLatency: durations.length ? Math.max(...durations) : 0,
      medianLatency: percentile(durations, 50),
    })
  }

  const data = await request<LatencyHeatmap>({
    url: `${MONITORING_BASE}/latency-heatmap`,
    method: "GET",
    params,
  })
  return LatencyHeatmapSchema.parse(data)
}

/**
 * Fetch percentile trends (P50, P99)
 */
export async function fetchPercentileTrends(
  params?: MonitoringQueryFilters
): Promise<PercentileTrends> {
  if (isTauriRuntime()) {
    const logs = await fetchLocalMonitoringLogs(params)
    const range = params?.timeRange ?? "24h"
    const buckets = range === "24h" ? 24 : range === "7d" ? 7 : 30
    const rangeMs = getRangeMs(range)
    const bucketMs = Math.floor(rangeMs / buckets)
    const nowMs = Date.now()
    const startMs = nowMs - rangeMs
    const series = Array.from({ length: buckets }, () => [] as number[])

    for (const log of logs) {
      const createdMs = new Date(log.created_at).getTime()
      const offset = Math.max(0, createdMs - startMs)
      const index = Math.min(buckets - 1, Math.floor(offset / bucketMs))
      series[index]?.push(Math.max(0, log.duration_ms))
    }

    const timeline = series.map((bucket, index) => {
      const slotStart = startMs + index * bucketMs
      const labelDate = new Date(slotStart)
      const time =
        range === "24h"
          ? `${String(labelDate.getHours()).padStart(2, "0")}:00`
          : `${labelDate.getMonth() + 1}/${labelDate.getDate()}`

      return {
        time,
        p50: Math.round(percentile(bucket, 50)),
        p99: Math.round(percentile(bucket, 99)),
      }
    })

    return PercentileTrendsSchema.parse({ timeline })
  }

  const data = await request<PercentileTrends>({
    url: `${MONITORING_BASE}/percentile-trends`,
    method: "GET",
    params,
  })
  return PercentileTrendsSchema.parse(data)
}

/**
 * Fetch model cost breakdown
 */
export async function fetchModelCostBreakdown(
  params?: MonitoringQueryFilters
): Promise<ModelCostBreakdown> {
  if (isTauriRuntime()) {
    const logs = await fetchLocalMonitoringLogs(params)
    const costByModel = new Map<string, number>()

    for (const log of logs) {
      costByModel.set(log.model, (costByModel.get(log.model) ?? 0) + (log.cost_user ?? 0))
    }

    const totalCost = Array.from(costByModel.values()).reduce((sum, value) => sum + value, 0)
    const models = Array.from(costByModel.entries())
      .map(([name, cost]) => ({
        name,
        cost,
        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)

    return ModelCostBreakdownSchema.parse({ models })
  }

  const data = await request<ModelCostBreakdown>({
    url: `${MONITORING_BASE}/model-cost-breakdown`,
    method: "GET",
    params,
  })
  return ModelCostBreakdownSchema.parse(data)
}

/**
 * Fetch error distribution
 */
export async function fetchErrorDistribution(
  params?: MonitoringQueryFilters
): Promise<ErrorDistribution> {
  if (isTauriRuntime()) {
    const logs = await fetchLocalMonitoringLogs(params)
    const counts = {
      success: 0,
      client_error: 0,
      rate_limit: 0,
      server_error: 0,
      other: 0,
    }

    for (const log of logs) {
      if (log.status_code >= 200 && log.status_code < 400) {
        counts.success += 1
      } else if (log.status_code === 429) {
        counts.rate_limit += 1
      } else if (log.status_code >= 400 && log.status_code < 500) {
        counts.client_error += 1
      } else if (log.status_code >= 500) {
        counts.server_error += 1
      } else {
        counts.other += 1
      }
    }

    return ErrorDistributionSchema.parse({
      categories: [
        { category: "success", label: "Success", count: counts.success, color: "#10B981" },
        { category: "client_error", label: "Client Errors", count: counts.client_error, color: "#F59E0B" },
        { category: "rate_limit", label: "Rate Limit", count: counts.rate_limit, color: "#8B5CF6" },
        { category: "server_error", label: "Server Errors", count: counts.server_error, color: "#EF4444" },
        { category: "other", label: "Other", count: counts.other, color: "#6B7280" },
      ],
    })
  }

  const data = await request<ErrorDistribution>({
    url: `${MONITORING_BASE}/error-distribution`,
    method: "GET",
    params,
  })
  return ErrorDistributionSchema.parse(data)
}

/**
 * Fetch key activity ranking
 */
export async function fetchKeyActivityRanking(
  params?: MonitoringQueryFilters & {
    limit?: number
  }
): Promise<KeyActivityRanking> {
  if (isTauriRuntime()) {
    const logs = await fetchLocalMonitoringLogs(params)
    const rangeMs = getRangeMs(params?.timeRange)
    const rangeMinutes = Math.max(1, rangeMs / 60000)
    const nowMs = Date.now()
    const midMs = nowMs - rangeMs / 2
    const bucket = new Map<
      string,
      {
        id: string
        count: number
        firstHalf: number
        secondHalf: number
      }
    >()

    for (const log of logs) {
      const id = log.api_key_id ?? "unknown"
      const current = bucket.get(id) ?? {
        id,
        count: 0,
        firstHalf: 0,
        secondHalf: 0,
      }
      current.count += 1
      const createdMs = new Date(log.created_at).getTime()
      if (createdMs < midMs) current.firstHalf += 1
      else current.secondHalf += 1
      bucket.set(id, current)
    }

    const limit = params?.limit || 5
    const keys = Array.from(bucket.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((entry, index) => {
        const firstRate = entry.firstHalf / Math.max(1, rangeMinutes / 2)
        const secondRate = entry.secondHalf / Math.max(1, rangeMinutes / 2)
        const trend = firstRate > 0 ? ((secondRate - firstRate) / firstRate) * 100 : 0
        const maskedTail = entry.id.slice(-4)
        return {
          id: entry.id,
          name: entry.id === "unknown" ? `Unknown Key ${index + 1}` : `API Key ${index + 1}`,
          maskedKey: entry.id === "unknown" ? "sk-***" : `sk-***${maskedTail}`,
          rpm: Math.round((entry.count / rangeMinutes) * 100) / 100,
          trend: Math.round(trend),
        }
      })

    return KeyActivityRankingSchema.parse({ keys })
  }

  const data = await request<KeyActivityRanking>({
    url: `${MONITORING_BASE}/key-activity-ranking`,
    method: "GET",
    params: {
      timeRange: params?.timeRange,
      model: params?.model,
      apiKey: params?.apiKey,
      errorCode: params?.errorCode,
      limit: params?.limit || 5,
    },
  })
  return KeyActivityRankingSchema.parse(data)
}
