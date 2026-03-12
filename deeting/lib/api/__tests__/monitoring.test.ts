import {
  fetchErrorDistribution,
  fetchKeyActivityRanking,
  fetchLatencyHeatmap,
  fetchModelCostBreakdown,
  fetchPercentileTrends,
} from "@/lib/api/monitoring"
import { fetchAdminGatewayLogs } from "@/lib/api/admin-dashboard"
import { request } from "@/lib/http"

jest.mock("@/lib/api/admin-dashboard", () => ({
  fetchAdminGatewayLogs: jest.fn(),
}))

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

const mockFetchAdminGatewayLogs = fetchAdminGatewayLogs as jest.MockedFunction<
  typeof fetchAdminGatewayLogs
>
const mockRequest = request as jest.MockedFunction<typeof request>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("monitoring api", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-03-04T12:00:00.000Z"))
  })

  afterEach(() => {
    jest.useRealTimers()
    mockFetchAdminGatewayLogs.mockReset()
    mockRequest.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("builds monitoring datasets from local logs in tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockFetchAdminGatewayLogs.mockResolvedValue({
      total: 3,
      skip: 0,
      limit: 500,
      items: [
        {
          id: "log-1",
          api_key_id: "key-1111",
          model: "gpt-4o",
          status_code: 200,
          duration_ms: 120,
          ttft_ms: 60,
          input_tokens: 10,
          output_tokens: 20,
          cost_user: 0.03,
          is_cached: false,
          error_code: null,
          created_at: "2026-03-04T11:50:00.000Z",
        },
        {
          id: "log-2",
          api_key_id: "key-1111",
          model: "gpt-4o",
          status_code: 429,
          duration_ms: 300,
          ttft_ms: 120,
          input_tokens: 5,
          output_tokens: 5,
          cost_user: 0.01,
          is_cached: false,
          error_code: "429",
          created_at: "2026-03-04T11:10:00.000Z",
        },
        {
          id: "log-3",
          api_key_id: "key-2222",
          model: "gpt-4o-mini",
          status_code: 500,
          duration_ms: 800,
          ttft_ms: 250,
          input_tokens: 6,
          output_tokens: 4,
          cost_user: 0.02,
          is_cached: true,
          error_code: "UPSTREAM_ERROR",
          created_at: "2026-03-04T10:20:00.000Z",
        },
      ],
    } as never)

    const [heatmap, trends, breakdown, distribution, ranking] = await Promise.all([
      fetchLatencyHeatmap({ timeRange: "24h" }),
      fetchPercentileTrends({ timeRange: "24h" }),
      fetchModelCostBreakdown({ timeRange: "24h" }),
      fetchErrorDistribution({ timeRange: "24h" }),
      fetchKeyActivityRanking({ timeRange: "24h", limit: 5 }),
    ])

    expect(heatmap.grid).toHaveLength(24)
    expect(heatmap.peakLatency).toBe(800)
    expect(trends.timeline).toHaveLength(24)
    expect(breakdown.models[0]?.name).toBe("gpt-4o")
    expect(distribution.categories.some((c) => c.category === "rate_limit" && c.count === 1)).toBe(
      true
    )
    expect(ranking.keys.length).toBeGreaterThan(0)
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockFetchAdminGatewayLogs).toHaveBeenCalledWith({
      skip: 0,
      limit: 500,
      start_time: "2026-03-03T12:00:00.000Z",
      end_time: "2026-03-04T12:00:00.000Z",
      model: undefined,
    })
  })

  it("uses cloud monitoring endpoint outside tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      models: [{ name: "gpt-4o", cost: 1, percentage: 100 }],
    } as never)

    const result = await fetchModelCostBreakdown({ timeRange: "7d" })

    expect(result.models).toHaveLength(1)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/monitoring/model-cost-breakdown",
      method: "GET",
      params: { timeRange: "7d" },
    })
    expect(mockFetchAdminGatewayLogs).not.toHaveBeenCalled()
  })
})
