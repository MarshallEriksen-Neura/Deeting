import { fetchGatewayLogsForQuery } from "@/lib/swr/use-gateway-logs"
import { fetchAdminGatewayLogs } from "@/lib/api/admin-dashboard"

jest.mock("@/lib/api/admin-dashboard", () => ({
  fetchAdminGatewayLogs: jest.fn(),
}))

const mockFetchAdminGatewayLogs = fetchAdminGatewayLogs as jest.MockedFunction<
  typeof fetchAdminGatewayLogs
>

describe("fetchGatewayLogsForQuery", () => {
  afterEach(() => {
    mockFetchAdminGatewayLogs.mockReset()
  })

  it("maps local gateway logs to cursor page dto shape", async () => {
    mockFetchAdminGatewayLogs.mockResolvedValue({
      total: 3,
      skip: 0,
      limit: 2,
      items: [
        {
          id: "log-local-1",
          user_id: "user-1",
          model: "gpt-4o",
          status_code: 200,
          duration_ms: 120,
          ttft_ms: 60,
          input_tokens: 10,
          output_tokens: 20,
          cost_user: 0.02,
          is_cached: true,
          error_code: null,
          created_at: "2026-03-04T10:00:00.000Z",
        },
        {
          id: "log-local-2",
          user_id: "user-2",
          model: "gpt-4o-mini",
          status_code: 500,
          duration_ms: 300,
          ttft_ms: null,
          input_tokens: 5,
          output_tokens: 5,
          cost_user: 0.01,
          is_cached: false,
          error_code: "UPSTREAM_ERROR",
          created_at: "2026-03-04T09:00:00.000Z",
        },
      ],
    } as never)

    const result = await fetchGatewayLogsForQuery({ size: 2, cursor: "0" })

    expect(result.items).toHaveLength(2)
    expect(result.items[0]?.total_tokens).toBe(30)
    expect(result.items[0]?.cost_upstream).toBe(0.02)
    expect(result.previous_page).toBeNull()
    expect(result.next_page).toBe("2")
    expect(mockFetchAdminGatewayLogs).toHaveBeenCalledWith({
      skip: 0,
      limit: 2,
      start_time: undefined,
      end_time: undefined,
      model: undefined,
      status_code: undefined,
      is_cached: undefined,
      error_code: undefined,
    })
  })

  it("passes error and time range filters through to backend query", async () => {
    mockFetchAdminGatewayLogs.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 20,
      items: [
        {
          id: "log-err",
          user_id: "user-1",
          model: "gpt-4o",
          status_code: 500,
          duration_ms: 200,
          ttft_ms: 100,
          input_tokens: 2,
          output_tokens: 2,
          cost_user: 0.002,
          is_cached: false,
          error_code: "E500",
          created_at: "2026-03-04T11:00:00.000Z",
        },
      ],
    } as never)

    const result = await fetchGatewayLogsForQuery({
      error_code: "E500",
      start_time: "2026-03-04T10:30:00.000Z",
      end_time: "2026-03-04T11:30:00.000Z",
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe("log-err")
    expect(mockFetchAdminGatewayLogs).toHaveBeenCalledWith({
      skip: 0,
      limit: 20,
      start_time: "2026-03-04T10:30:00.000Z",
      end_time: "2026-03-04T11:30:00.000Z",
      model: undefined,
      status_code: undefined,
      is_cached: undefined,
      error_code: "E500",
    })
  })
})
