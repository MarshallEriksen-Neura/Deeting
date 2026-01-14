import { z } from "zod"
import { request } from "@/lib/http"

// =====================
// Schema Definitions
// =====================

export const DashboardStatsSchema = z.object({
  financial: z.object({
    monthlySpent: z.number(),
    balance: z.number(),
    quotaUsedPercent: z.number(),
    estimatedMonthEnd: z.number().optional(),
  }),
  traffic: z.object({
    todayRequests: z.number(),
    hourlyTrend: z.array(z.number()),
    trendPercent: z.number().optional(),
  }),
  speed: z.object({
    avgTTFT: z.number(),
    trendPercent: z.number().optional(),
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
  status: z.enum(["active", "down", "degraded"]),
  priority: z.number(),
  latency: z.number(),
  sparkline: z.array(z.number()).optional(),
})

export const RecentErrorSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  statusCode: z.number(),
  model: z.string(),
  errorMessage: z.string(),
  errorCode: z.string().optional(),
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

/**
 * Fetch overall dashboard statistics
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
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
  }
): Promise<TokenThroughput> {
  const data = await request<TokenThroughput>({
    url: `${DASHBOARD_BASE}/token-throughput`,
    method: "GET",
    params,
  })
  return TokenThroughputSchema.parse(data)
}

/**
 * Fetch smart router statistics
 */
export async function fetchSmartRouterStats(): Promise<SmartRouterStats> {
  const data = await request<SmartRouterStats>({
    url: `${DASHBOARD_BASE}/smart-router-stats`,
    method: "GET",
  })
  return SmartRouterStatsSchema.parse(data)
}

/**
 * Fetch provider health status
 */
export async function fetchProviderHealth(): Promise<ProviderHealth[]> {
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
  }
): Promise<RecentError[]> {
  const data = await request<RecentError[]>({
    url: `${DASHBOARD_BASE}/recent-errors`,
    method: "GET",
    params: {
      limit: params?.limit || 10,
    },
  })
  return z.array(RecentErrorSchema).parse(data)
}
