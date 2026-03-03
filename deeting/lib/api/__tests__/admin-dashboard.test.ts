import {
  fetchAdminConversations,
  fetchAdminConversationSummaries,
  fetchAdminGatewayLogs,
  fetchAdminGatewayLogStats,
} from "@/lib/api/admin-dashboard"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("admin dashboard api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("lists gateway logs via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 100,
      items: [
        {
          id: "log-local-1",
          model: "gpt-4o",
          status_code: 200,
          duration_ms: 120,
          created_at: "2026-03-03T00:00:00Z",
        },
      ],
    } as unknown)

    const result = await fetchAdminGatewayLogs({
      limit: 100,
      model: "gpt-4o",
      is_cached: false,
    })

    expect(result.total).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_gateway_logs", {
      query: {
        skip: 0,
        limit: 100,
        model: "gpt-4o",
        status_code: undefined,
        is_cached: false,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("lists admin conversations via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 100,
      items: [
        {
          id: "session-local-1",
          title: "Local Session",
          user_id: "00000000-0000-0000-0000-000000000000",
          assistant_id: null,
          channel: "internal",
          status: "active",
          message_count: 3,
          last_active_at: "2026-03-03T00:00:00Z",
          last_summary_version: 1,
        },
      ],
    } as unknown)

    const result = await fetchAdminConversations({
      limit: 100,
      status: "active",
      channel: "internal",
    })

    expect(result.total).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_admin_conversations", {
      query: {
        skip: 0,
        limit: 100,
        status: "active",
        channel: "internal",
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("lists admin conversations via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 100,
      items: [
        {
          id: "session-cloud-1",
          title: "Cloud Session",
          channel: "external",
          status: "archived",
          message_count: 5,
          last_active_at: "2026-03-03T00:05:00Z",
          last_summary_version: 2,
        },
      ],
    })

    const result = await fetchAdminConversations({
      status: "archived",
      channel: "external",
    })

    expect(result.items[0]?.id).toBe("session-cloud-1")
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/conversations",
      method: "GET",
      params: {
        skip: 0,
        limit: 100,
        status: "archived",
        channel: "external",
      },
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("lists conversation summaries via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      items: [
        {
          id: "summary-local-1",
          session_id: "session-local-1",
          version: 1,
          summary_text: "summary text",
          covered_from_turn: 1,
          covered_to_turn: 4,
          token_estimate: 120,
          summarizer_model: "gpt-4o-mini",
          created_at: "2026-03-03T00:00:00Z",
          updated_at: "2026-03-03T00:00:00Z",
        },
      ],
    } as unknown)

    const result = await fetchAdminConversationSummaries("session-local-1")

    expect(result.items[0]?.id).toBe("summary-local-1")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_admin_conversation_summaries", {
      session_id: "session-local-1",
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("lists conversation summaries via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      items: [
        {
          id: "summary-cloud-1",
          session_id: "session-cloud-1",
          version: 3,
          summary_text: "cloud summary",
          covered_from_turn: 5,
          covered_to_turn: 10,
          token_estimate: 240,
          summarizer_model: null,
          created_at: "2026-03-03T00:10:00Z",
          updated_at: "2026-03-03T00:10:00Z",
        },
      ],
    })

    const result = await fetchAdminConversationSummaries("session-cloud-1")

    expect(result.items[0]?.version).toBe(3)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/conversations/session-cloud-1/summaries",
      method: "GET",
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("lists gateway logs via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 100,
      items: [
        {
          id: "log-cloud-1",
          model: "claude-3-opus",
          status_code: 502,
          duration_ms: 450,
          created_at: "2026-03-03T00:10:00Z",
        },
      ],
    })

    const result = await fetchAdminGatewayLogs({
      status_code: 502,
      limit: 100,
    })

    expect(result.items[0]?.id).toBe("log-cloud-1")
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/gateway-logs",
      method: "GET",
      params: {
        skip: 0,
        limit: 100,
        model: undefined,
        status_code: 502,
        is_cached: undefined,
      },
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("gets gateway log stats via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      total: 4,
      success_rate: 75,
      cache_hit_rate: 25,
      error_distribution: [{ key: "UPSTREAM_ERROR", count: 1 }],
      model_ranking: [{ key: "gpt-4o", count: 4 }],
      latency_histogram: [{ key: "lt_200ms", count: 3 }],
    } as unknown)

    const result = await fetchAdminGatewayLogStats({
      model: "gpt-4o",
      is_cached: false,
    })

    expect(result.success_rate).toBe(75)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_gateway_log_stats", {
      query: {
        model: "gpt-4o",
        status_code: undefined,
        is_cached: false,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("gets gateway log stats via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      total: 2,
      success_rate: 50,
      cache_hit_rate: 0,
      error_distribution: [{ key: "500", count: 1 }],
      model_ranking: [{ key: "deepseek-v3", count: 2 }],
      latency_histogram: [{ key: "200_500ms", count: 2 }],
    })

    const result = await fetchAdminGatewayLogStats({
      status_code: 500,
    })

    expect(result.total).toBe(2)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/gateway-logs/stats",
      method: "GET",
      params: {
        model: undefined,
        status_code: 500,
        is_cached: undefined,
      },
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
