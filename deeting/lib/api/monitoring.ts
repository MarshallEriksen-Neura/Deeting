import { z } from "zod"
import { request } from "@/lib/http"

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

/**
 * Fetch latency heatmap data
 */
export async function fetchLatencyHeatmap(
  params?: {
    timeRange?: "24h" | "7d" | "30d"
    model?: string
  }
): Promise<LatencyHeatmap> {
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
  params?: {
    timeRange?: "24h" | "7d" | "30d"
  }
): Promise<PercentileTrends> {
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
  params?: { timeRange?: "24h" | "7d" | "30d" }
): Promise<ModelCostBreakdown> {
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
  params?: { timeRange?: "24h" | "7d" | "30d"; model?: string }
): Promise<ErrorDistribution> {
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
  params?: {
    timeRange?: "24h" | "7d" | "30d"
    limit?: number
  }
): Promise<KeyActivityRanking> {
  const data = await request<KeyActivityRanking>({
    url: `${MONITORING_BASE}/key-activity-ranking`,
    method: "GET",
    params: {
      timeRange: params?.timeRange,
      limit: params?.limit || 5,
    },
  })
  return KeyActivityRankingSchema.parse(data)
}
