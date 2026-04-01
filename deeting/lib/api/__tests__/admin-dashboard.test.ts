import {
  approveAdminPluginReview,
  archiveAdminConversation,
  closeAdminConversation,
  fetchAdminConversation,
  fetchAdminConversations,
  fetchAdminConversationMessages,
  fetchAdminConversationSummaries,
  fetchAdminGatewayLogs,
  fetchAdminGatewayLogStats,
  fetchAdminPendingReviewCounts,
  fetchAdminPluginMarketReviews,
  fetchLocalConversationSummaryIdleTasks,
  fetchLocalConversationSummaryJobs,
  fetchLocalConversationSummaryQueueStats,
  rejectAdminPluginReview,
  retryLocalConversationSummaryJob,
  retryLocalConversationSummaryJobs,
  triggerLocalConversationSummary,
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
          cached_tokens: 24,
          cache_read_input_tokens: 24,
          cache_source: "provider_reported",
          usage_source: "provider_reported",
          meta: {
            usage_normalized: {
              cached_tokens: 24,
              cache_source: "provider_reported",
            },
          },
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
    expect(result.items[0]?.cached_tokens).toBe(24)
    expect(result.items[0]?.cache_source).toBe("provider_reported")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_gateway_logs", {
      query: {
        skip: 0,
        limit: 100,
        start_time: undefined,
        end_time: undefined,
        user_id: undefined,
        api_key_id: undefined,
        preset_id: undefined,
        model: "gpt-4o",
        status_code: undefined,
        is_cached: false,
        error_code: undefined,
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
      user_id: "00000000-0000-0000-0000-000000000000",
      assistant_id: "assistant-local-1",
      start_time: "2026-03-02T00:00:00.000Z",
      end_time: "2026-03-03T00:00:00.000Z",
    })

    expect(result.total).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_admin_conversations", {
      query: {
        skip: 0,
        limit: 100,
        status: "active",
        channel: "internal",
        user_id: "00000000-0000-0000-0000-000000000000",
        assistant_id: "assistant-local-1",
        start_time: "2026-03-02T00:00:00.000Z",
        end_time: "2026-03-03T00:00:00.000Z",
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("archives and closes conversations via tauri commands", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-1",
        status: "archived",
      } as unknown)
      .mockResolvedValueOnce({
        session_id: "session-local-1",
        status: "closed",
      } as unknown)

    await archiveAdminConversation("session-local-1")
    await closeAdminConversation("session-local-1")

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "archive_local_conversation", {
      sessionId: "session-local-1",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "close_local_conversation", {
      sessionId: "session-local-1",
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
      user_id: "11111111-1111-1111-1111-111111111111",
      assistant_id: "22222222-2222-2222-2222-222222222222",
      start_time: "2026-03-01T00:00:00.000Z",
      end_time: "2026-03-04T00:00:00.000Z",
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
        user_id: "11111111-1111-1111-1111-111111111111",
        assistant_id: "22222222-2222-2222-2222-222222222222",
        start_time: "2026-03-01T00:00:00.000Z",
        end_time: "2026-03-04T00:00:00.000Z",
      },
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("gets admin conversation detail via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      id: "session-local-1",
      title: "Local Detail Session",
      channel: "internal",
      status: "active",
      message_count: 4,
      first_message_at: "2026-03-02T00:00:00Z",
      last_active_at: "2026-03-03T00:00:00Z",
      last_summary_version: 1,
      created_at: "2026-03-02T00:00:00Z",
      updated_at: "2026-03-03T00:00:00Z",
    } as unknown)

    const result = await fetchAdminConversation("session-local-1")

    expect(result.id).toBe("session-local-1")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_admin_conversation", {
      sessionId: "session-local-1",
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("gets admin conversation detail via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      id: "session-cloud-1",
      title: "Cloud Detail Session",
      channel: "external",
      status: "closed",
      message_count: 8,
      first_message_at: "2026-03-01T00:00:00Z",
      last_active_at: "2026-03-03T00:10:00Z",
      last_summary_version: 2,
      created_at: "2026-03-01T00:00:00Z",
      updated_at: "2026-03-03T00:10:00Z",
    })

    const result = await fetchAdminConversation("session-cloud-1")

    expect(result.id).toBe("session-cloud-1")
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/conversations/session-cloud-1",
      method: "GET",
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("archives and closes conversations via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue(undefined)

    await archiveAdminConversation("session-cloud-1")
    await closeAdminConversation("session-cloud-1")

    expect(mockRequest).toHaveBeenNthCalledWith(1, {
      url: "/api/v1/admin/conversations/session-cloud-1/archive",
      method: "POST",
    })
    expect(mockRequest).toHaveBeenNthCalledWith(2, {
      url: "/api/v1/admin/conversations/session-cloud-1/close",
      method: "POST",
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("lists conversation messages via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 50,
      items: [
        {
          id: "msg-local-1",
          session_id: "session-local-1",
          turn_index: 1,
          role: "user",
          content: "hello",
          name: null,
          token_estimate: 8,
          meta_info: { source: "admin-test" },
          used_persona_id: null,
          is_deleted: false,
          parent_message_id: null,
          created_at: "2026-03-03T00:00:00Z",
          updated_at: "2026-03-03T00:00:00Z",
        },
      ],
    } as unknown)

    const result = await fetchAdminConversationMessages("session-local-1", {
      include_deleted: false,
      limit: 50,
    })

    expect(result.total).toBe(1)
    expect(result.items[0]?.id).toBe("msg-local-1")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_admin_conversation_messages", {
      sessionId: "session-local-1",
      query: {
        skip: 0,
        limit: 50,
        include_deleted: false,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("lists conversation messages via cloud api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      total: 2,
      skip: 0,
      limit: 50,
      items: [
        {
          id: "msg-cloud-1",
          session_id: "session-cloud-1",
          turn_index: 1,
          role: "user",
          content: "hi",
          name: null,
          token_estimate: 4,
          meta_info: null,
          used_persona_id: null,
          is_deleted: false,
          parent_message_id: null,
          created_at: "2026-03-03T00:10:00Z",
          updated_at: "2026-03-03T00:10:00Z",
        },
      ],
    })

    const result = await fetchAdminConversationMessages("session-cloud-1")

    expect(result.total).toBe(2)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/conversations/session-cloud-1/messages",
      method: "GET",
      params: {
        skip: 0,
        limit: 50,
        include_deleted: true,
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
      sessionId: "session-local-1",
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

  it("lists local conversation summary jobs via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 100,
      items: [
        {
          id: "job-1",
          session_id: "session-local-1",
          status: "failed",
          trigger_source: "idle_check",
          attempts: 5,
          max_attempts: 5,
          available_after_epoch: 1740960000,
          last_error: "timeout",
          created_at: "2026-03-03T00:00:00Z",
          updated_at: "2026-03-03T00:10:00Z",
        },
      ],
    } as unknown)

    const result = await fetchLocalConversationSummaryJobs({
      status: "failed",
      limit: 100,
      error_contains: "timeout",
    })

    expect(result.total).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_conversation_summary_jobs", {
      query: {
        skip: 0,
        limit: 100,
        status: "failed",
        session_id: undefined,
        error_contains: "timeout",
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("lists local conversation summary idle tasks via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      total: 1,
      skip: 0,
      limit: 100,
      items: [
        {
          session_id: "session-local-1",
          last_active_epoch: 1740959000,
          run_after_epoch: 1740960000,
          is_due: true,
          created_at: "2026-03-03T00:00:00Z",
          updated_at: "2026-03-03T00:00:00Z",
        },
      ],
    } as unknown)

    const result = await fetchLocalConversationSummaryIdleTasks({
      limit: 100,
    })

    expect(result.total).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_conversation_summary_idle_tasks", {
      query: {
        skip: 0,
        limit: 100,
        session_id: undefined,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("gets local conversation summary queue stats via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      pending_jobs: 2,
      running_jobs: 1,
      completed_jobs: 6,
      failed_jobs: 3,
      idle_due_tasks: 4,
      idle_total_tasks: 8,
    } as unknown)

    const result = await fetchLocalConversationSummaryQueueStats()

    expect(result.completed_jobs).toBe(6)
    expect(result.failed_jobs).toBe(3)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_conversation_summary_queue_stats", undefined)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("triggers and retries local conversation summary job via tauri commands", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-1",
        queued: true,
      } as unknown)
      .mockResolvedValueOnce({
        session_id: "session-local-1",
        queued: true,
      } as unknown)

    const triggerResult = await triggerLocalConversationSummary("session-local-1")
    const retryResult = await retryLocalConversationSummaryJob("job-1")

    expect(triggerResult.queued).toBe(true)
    expect(retryResult.session_id).toBe("session-local-1")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "trigger_local_conversation_summary_job", {
      sessionId: "session-local-1",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "retry_local_conversation_summary_job", {
      jobId: "job-1",
    })
  })

  it("batch retries local conversation summary jobs via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      matched_count: 5,
      queued_count: 3,
    } as unknown)

    const result = await retryLocalConversationSummaryJobs({
      status: "failed",
      error_contains: "timeout",
      limit: 200,
    })

    expect(result.queued_count).toBe(3)
    expect(mockInvoke).toHaveBeenCalledWith("retry_local_conversation_summary_jobs", {
      payload: {
        limit: 200,
        status: "failed",
        session_id: undefined,
        error_contains: "timeout",
      },
    })
  })

  it("throws for local summary admin api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    await expect(fetchLocalConversationSummaryQueueStats()).rejects.toThrow(
      "fetchLocalConversationSummaryQueueStats is only supported in Tauri runtime"
    )
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
      start_time: "2026-03-03T00:00:00.000Z",
      end_time: "2026-03-04T00:00:00.000Z",
      status_code: 502,
      error_code: "UPSTREAM_ERROR",
      limit: 100,
    })

    expect(result.items[0]?.id).toBe("log-cloud-1")
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/gateway-logs",
      method: "GET",
      params: {
        skip: 0,
        limit: 100,
        start_time: "2026-03-03T00:00:00.000Z",
        end_time: "2026-03-04T00:00:00.000Z",
        model: undefined,
        status_code: 502,
        is_cached: undefined,
        error_code: "UPSTREAM_ERROR",
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
      avg_duration_ms: 180,
      total_cost_user: 0.09,
      error_distribution: [{ key: "UPSTREAM_ERROR", count: 1 }],
      model_ranking: [{ key: "gpt-4o", count: 4 }],
      latency_histogram: [{ key: "lt_200ms", count: 3 }],
    } as unknown)

    const result = await fetchAdminGatewayLogStats({
      start_time: "2026-03-01T00:00:00.000Z",
      end_time: "2026-03-04T00:00:00.000Z",
      api_key_id: "cred-local-1",
      model: "gpt-4o",
      is_cached: false,
      error_code: "UPSTREAM_ERROR",
    })

    expect(result.success_rate).toBe(75)
    expect(result.total_cost_user).toBe(0.09)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_gateway_log_stats", {
      query: {
        start_time: "2026-03-01T00:00:00.000Z",
        end_time: "2026-03-04T00:00:00.000Z",
        user_id: undefined,
        api_key_id: "cred-local-1",
        preset_id: undefined,
        model: "gpt-4o",
        status_code: undefined,
        is_cached: false,
        error_code: "UPSTREAM_ERROR",
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
      avg_duration_ms: 320,
      total_cost_user: 0.04,
      error_distribution: [{ key: "500", count: 1 }],
      model_ranking: [{ key: "deepseek-v3", count: 2 }],
      latency_histogram: [{ key: "200_500ms", count: 2 }],
    })

    const result = await fetchAdminGatewayLogStats({
      start_time: "2026-03-03T00:00:00.000Z",
      end_time: "2026-03-04T00:00:00.000Z",
      status_code: 500,
      error_code: "500",
    })

    expect(result.total).toBe(2)
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/gateway-logs/stats",
      method: "GET",
      params: {
        start_time: "2026-03-03T00:00:00.000Z",
        end_time: "2026-03-04T00:00:00.000Z",
        model: undefined,
        status_code: 500,
        is_cached: undefined,
        error_code: "500",
      },
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("aggregates pending knowledge and plugin review counts", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValueOnce({
      knowledge_reviews: 3,
      plugin_reviews: 4,
    })

    const result = await fetchAdminPendingReviewCounts()

    expect(result).toEqual({
      knowledge_reviews: 3,
      plugin_reviews: 4,
    })
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/admin/pending-reviews",
      method: "GET",
    })
  })

  it("lists and decides plugin market reviews via cloud api", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest
      .mockResolvedValueOnce({
        items: [
          {
            id: "skill.http.fetch",
            name: "HTTP Fetch",
            status: "needs_review",
            risk_level: "high",
            network_targets: ["api.example.com"],
            destructive_actions: [],
            privacy_risks: [],
            findings: [],
            created_at: "2026-03-09T00:00:00Z",
            updated_at: "2026-03-09T00:00:00Z",
          },
        ],
        total: 1,
        skip: 0,
        limit: 100,
      })
      .mockResolvedValueOnce({
        id: "skill.http.fetch",
        name: "HTTP Fetch",
        status: "active",
        risk_level: "high",
        network_targets: [],
        destructive_actions: [],
        privacy_risks: [],
        findings: [],
        created_at: "2026-03-09T00:00:00Z",
        updated_at: "2026-03-09T00:00:00Z",
      })
      .mockResolvedValueOnce({
        id: "skill.http.fetch",
        name: "HTTP Fetch",
        status: "rejected",
        risk_level: "high",
        network_targets: [],
        destructive_actions: [],
        privacy_risks: [],
        findings: [],
        created_at: "2026-03-09T00:00:00Z",
        updated_at: "2026-03-09T00:00:00Z",
      })

    const list = await fetchAdminPluginMarketReviews({ status_filter: "needs_review" })
    const approved = await approveAdminPluginReview("skill.http.fetch")
    const rejected = await rejectAdminPluginReview("skill.http.fetch", "unsafe")

    expect(list.items[0]?.id).toBe("skill.http.fetch")
    expect(approved.status).toBe("active")
    expect(rejected.status).toBe("rejected")
  })
})
