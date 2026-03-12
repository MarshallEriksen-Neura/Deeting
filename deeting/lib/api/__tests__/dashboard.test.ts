import {
  fetchDashboardStats,
  fetchProviderHealth,
  fetchRecentErrors,
  fetchSmartRouterStats,
  fetchTokenThroughput,
} from "@/lib/api/dashboard"
import { fetchAdminGatewayLogs, fetchAdminGatewayLogStats } from "@/lib/api/admin-dashboard"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@/lib/api/admin-dashboard", () => ({
  fetchAdminGatewayLogs: jest.fn(),
  fetchAdminGatewayLogStats: jest.fn(),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockFetchAdminGatewayLogs = fetchAdminGatewayLogs as jest.MockedFunction<
  typeof fetchAdminGatewayLogs
>
const mockFetchAdminGatewayLogStats = fetchAdminGatewayLogStats as jest.MockedFunction<
  typeof fetchAdminGatewayLogStats
>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("dashboard apis", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-03-04T10:00:00.000Z"))
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
  })

  afterEach(() => {
    jest.useRealTimers()
    mockRequest.mockReset()
    mockInvoke.mockReset()
    mockFetchAdminGatewayLogs.mockReset()
    mockFetchAdminGatewayLogStats.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("aggregates dashboard stats from local gateway logs in tauri runtime", async () => {
    mockFetchAdminGatewayLogStats.mockResolvedValue({
      total: 3,
      success_rate: 66.67,
      cache_hit_rate: 33.33,
      error_distribution: [],
      model_ranking: [],
      latency_histogram: [],
    })
    mockFetchAdminGatewayLogs.mockResolvedValue({
      total: 3,
      skip: 0,
      limit: 500,
      items: [
        {
          id: "log-1",
          model: "gpt-4o",
          status_code: 200,
          duration_ms: 120,
          ttft_ms: 80,
          input_tokens: 100,
          output_tokens: 50,
          cost_user: 0.12,
          is_cached: false,
          error_code: null,
          created_at: "2026-03-04T09:00:00.000Z",
        },
        {
          id: "log-2",
          model: "gpt-4o-mini",
          status_code: 500,
          duration_ms: 300,
          ttft_ms: null,
          input_tokens: 40,
          output_tokens: 0,
          cost_user: 0.03,
          is_cached: false,
          error_code: "UPSTREAM_TIMEOUT",
          created_at: "2026-03-04T08:00:00.000Z",
        },
        {
          id: "log-3",
          model: "gpt-4o",
          status_code: 200,
          duration_ms: 100,
          ttft_ms: 60,
          input_tokens: 30,
          output_tokens: 20,
          cost_user: 0.02,
          is_cached: true,
          error_code: null,
          created_at: "2026-03-03T12:00:00.000Z",
        },
      ],
    })

    const result = await fetchDashboardStats()

    expect(result.traffic.todayRequests).toBe(2)
    expect(result.health.totalRequests).toBeGreaterThan(0)
    expect(result.speed.avgTTFT).toBeGreaterThan(0)
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockFetchAdminGatewayLogStats).toHaveBeenCalledTimes(1)
    expect(mockFetchAdminGatewayLogs).toHaveBeenCalledTimes(1)
  })

  it("builds token throughput and smart-router stats in tauri runtime", async () => {
    mockFetchAdminGatewayLogStats.mockResolvedValue({
      total: 2,
      success_rate: 100,
      cache_hit_rate: 50,
      error_distribution: [],
      model_ranking: [],
      latency_histogram: [],
    })
    mockFetchAdminGatewayLogs.mockResolvedValue({
      total: 2,
      skip: 0,
      limit: 500,
      items: [
        {
          id: "log-1",
          model: "gpt-4o",
          status_code: 200,
          duration_ms: 150,
          ttft_ms: 90,
          input_tokens: 120,
          output_tokens: 80,
          cost_upstream: 0.1,
          cost_user: 0.1,
          is_cached: false,
          error_code: null,
          created_at: "2026-03-04T09:30:00.000Z",
        },
        {
          id: "log-2",
          model: "gpt-4o",
          status_code: 200,
          duration_ms: 70,
          ttft_ms: 40,
          input_tokens: 80,
          output_tokens: 40,
          cost_upstream: 0.08,
          cost_user: 0.04,
          is_cached: true,
          error_code: null,
          created_at: "2026-03-04T08:30:00.000Z",
        },
      ],
    })

    const [throughput, routerStats] = await Promise.all([
      fetchTokenThroughput({ period: "24h" }),
      fetchSmartRouterStats(),
    ])

    expect(throughput.timeline).toHaveLength(24)
    expect(throughput.totalInput).toBe(200)
    expect(routerStats.cacheHitRate).toBe(50)
    expect(routerStats.costSavings).toBe(0.04)
    expect(routerStats.avgSpeedup).toBeGreaterThan(0)
  })

  it("maps provider health and recent errors from local tauri commands", async () => {
    mockFetchAdminGatewayLogs.mockResolvedValue({
      total: 2,
      skip: 0,
      limit: 500,
      items: [
        {
          id: "log-err-1",
          model: "gpt-4o",
          status_code: 502,
          duration_ms: 200,
          ttft_ms: null,
          input_tokens: 10,
          output_tokens: 0,
          cost_user: 0.01,
          is_cached: false,
          error_code: "BAD_GATEWAY",
          created_at: "2026-03-04T09:00:00.000Z",
        },
        {
          id: "log-ok-1",
          model: "gpt-4o-mini",
          status_code: 200,
          duration_ms: 80,
          ttft_ms: 50,
          input_tokens: 20,
          output_tokens: 10,
          cost_user: 0.01,
          is_cached: true,
          error_code: null,
          created_at: "2026-03-04T08:00:00.000Z",
        },
      ],
    })
    mockInvoke
      .mockResolvedValueOnce([
        { id: "inst-1", name: "OpenAI", is_enabled: true, priority: 10 },
        { id: "inst-2", name: "Disabled Provider", is_enabled: false, priority: 20 },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "model-1",
          is_active: true,
          extra_meta: { latency_ms: 320 },
        },
      ] as never)

    const [providers, errors] = await Promise.all([
      fetchProviderHealth(),
      fetchRecentErrors({ limit: 5 }),
    ])

    expect(providers).toHaveLength(2)
    expect(providers[0]?.status).toBe("active")
    expect(providers[1]?.status).toBe("down")
    expect(errors).toHaveLength(1)
    expect(errors[0]?.errorCode).toBe("BAD_GATEWAY")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_provider_instances", undefined)
  })

  it("falls back to http request outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    delete windowWithTauri.__TAURI__
    mockRequest.mockResolvedValue({
      financial: {
        monthlySpent: 0,
        balance: 0,
        quotaUsedPercent: 0,
        estimatedMonthEnd: 0,
      },
      traffic: { todayRequests: 0, hourlyTrend: [], trendPercent: 0 },
      speed: { avgTTFT: 0, trendPercent: 0 },
      health: { successRate: 0, totalRequests: 0, successfulRequests: 0 },
    } as never)

    const result = await fetchDashboardStats()
    expect(result.health.totalRequests).toBe(0)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/dashboard/stats",
      method: "GET",
    })
  })

  it("uses cloud request when source is explicitly cloud in tauri runtime", async () => {
    mockRequest.mockResolvedValue({
      financial: {
        monthlySpent: 1.5,
        balance: 0,
        quotaUsedPercent: 0,
        estimatedMonthEnd: 2,
      },
      traffic: { todayRequests: 12, hourlyTrend: [12], trendPercent: 10 },
      speed: { avgTTFT: 120, trendPercent: -5 },
      health: { successRate: 98, totalRequests: 12, successfulRequests: 11 },
    } as never)

    const result = await fetchDashboardStats({ source: "cloud" })

    expect(result.traffic.todayRequests).toBe(12)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/dashboard/stats",
      method: "GET",
    })
    expect(mockFetchAdminGatewayLogStats).not.toHaveBeenCalled()
    expect(mockFetchAdminGatewayLogs).not.toHaveBeenCalled()
  })
})
