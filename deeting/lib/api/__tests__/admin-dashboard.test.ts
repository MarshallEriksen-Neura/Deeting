import {
  approveAdminPluginReview,
  archiveAdminConversation,
  closeAdminConversation,
  deleteAdminGatewayLogs,
  fetchAdminConversation,
  fetchAdminConversations,
  fetchAdminConversationMessages,
  fetchAdminConversationSummaries,
  fetchAdminGatewayLogs,
  fetchAdminGatewayLogStats,
  fetchAdminPendingReviewCounts,
  fetchAdminPluginMarketReviews,
  fetchLocalFramePhaseAlignmentReadiness,
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

function framePhaseAlignmentReadinessPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    metric: "frame_phase_step_alignment",
    contract_schema_version: 2,
    observation_window: "1-2w",
    window_start_unix_ms: 1000,
    window_end_unix_ms: 604801000,
    observed_payload_start_unix_ms: 1000,
    observed_payload_end_unix_ms: 604801000,
    eligible_sample_start_unix_ms: 1000,
    eligible_sample_end_unix_ms: 604801000,
    observation_window_ms: 604800000,
    minimum_observation_window_ms: 604800000,
    observation_window_met: true,
    graph_count: 10,
    malformed_payload_count: 0,
    malformed_graph_payload_count: 0,
    malformed_e3_payload_count: 0,
    missing_e3_payload_count: 0,
    observed_payload_count: 10,
    eligible_sample_count: 8,
    matched_sample_count: 8,
    mismatched_sample_count: 0,
    excluded_sample_count: 2,
    direct_iteration_sample_count: 7,
    non_direct_strategy_sample_count: 1,
    non_direct_strategy_ratio: 0.125,
    minimum_non_direct_strategy_ratio: 0.01,
    strategy_distribution_met: true,
    overlap_ratio: 1,
    minimum_overlap_ratio: 0.95,
    overlap_threshold_met: true,
    e3_payload_coverage_met: true,
    e3_payload_health_met: true,
    threshold_met: true,
    ...overrides,
  }
}

describe("admin dashboard api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    if (originalTauriFlag === undefined) {
      delete process.env.NEXT_PUBLIC_IS_TAURI
    } else {
      process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    }
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

  it("deletes gateway logs via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(3)

    const deleted = await deleteAdminGatewayLogs({
      start_time: "2026-03-01T00:00:00.000Z",
      end_time: "2026-03-04T00:00:00.000Z",
      model: "gpt-4o",
      status_code: 500,
      is_cached: false,
      error_code: "UPSTREAM_ERROR",
    })

    expect(deleted).toBe(3)
    expect(mockInvoke).toHaveBeenCalledWith("delete_local_gateway_logs", {
      query: {
        start_time: "2026-03-01T00:00:00.000Z",
        end_time: "2026-03-04T00:00:00.000Z",
        user_id: undefined,
        api_key_id: undefined,
        preset_id: undefined,
        model: "gpt-4o",
        status_code: 500,
        is_cached: false,
        error_code: "UPSTREAM_ERROR",
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
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

  it("gets local frame-phase alignment readiness via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(framePhaseAlignmentReadinessPayload())

    const result = await fetchLocalFramePhaseAlignmentReadiness({
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })

    expect(result.threshold_met).toBe(true)
    expect(result.metric).toBe("frame_phase_step_alignment")
    expect(result.contract_schema_version).toBe(2)
    expect(result.observation_window).toBe("1-2w")
    expect(result.observation_window_met).toBe(true)
    expect(result.overlap_threshold_met).toBe(true)
    expect(result.e3_payload_coverage_met).toBe(true)
    expect(result.e3_payload_health_met).toBe(true)
    expect(result.minimum_observation_window_ms).toBe(604800000)
    expect(result.malformed_payload_count).toBe(0)
    expect(result.malformed_graph_payload_count).toBe(0)
    expect(result.malformed_e3_payload_count).toBe(0)
    expect(result.missing_e3_payload_count).toBe(0)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("gets local frame-phase alignment readiness without a bounded request window", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        window_start_unix_ms: null,
        window_end_unix_ms: null,
      })
    )

    const result = await fetchLocalFramePhaseAlignmentReadiness()

    expect(result.window_start_unix_ms).toBeNull()
    expect(result.window_end_unix_ms).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: undefined,
      windowEndUnixMs: undefined,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("gets local frame-phase alignment readiness with open-ended request windows", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValueOnce(
      framePhaseAlignmentReadinessPayload({
        window_end_unix_ms: null,
      })
    )

    const fromStart = await fetchLocalFramePhaseAlignmentReadiness({
      windowStartUnixMs: 1000,
    })

    expect(fromStart.window_start_unix_ms).toBe(1000)
    expect(fromStart.window_end_unix_ms).toBeNull()
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: undefined,
    })

    mockInvoke.mockResolvedValueOnce(
      framePhaseAlignmentReadinessPayload({
        window_start_unix_ms: null,
      })
    )

    const untilEnd = await fetchLocalFramePhaseAlignmentReadiness({
      windowEndUnixMs: 604801000,
    })

    expect(untilEnd.window_start_unix_ms).toBeNull()
    expect(untilEnd.window_end_unix_ms).toBe(604801000)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: undefined,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("accepts collecting frame-phase alignment readiness with nullable ranges", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        window_start_unix_ms: 1000,
        window_end_unix_ms: 2000,
        observed_payload_start_unix_ms: null,
        observed_payload_end_unix_ms: null,
        eligible_sample_start_unix_ms: null,
        eligible_sample_end_unix_ms: null,
        observation_window_ms: null,
        minimum_observation_window_ms: 604800000,
        observation_window_met: false,
        graph_count: 0,
        malformed_payload_count: 0,
        malformed_graph_payload_count: 0,
        malformed_e3_payload_count: 0,
        missing_e3_payload_count: 0,
        observed_payload_count: 0,
        eligible_sample_count: 0,
        matched_sample_count: 0,
        mismatched_sample_count: 0,
        excluded_sample_count: 0,
        direct_iteration_sample_count: 0,
        non_direct_strategy_sample_count: 0,
        non_direct_strategy_ratio: null,
        minimum_non_direct_strategy_ratio: 0.01,
        strategy_distribution_met: false,
        overlap_ratio: null,
        minimum_overlap_ratio: 0.95,
        overlap_threshold_met: false,
        e3_payload_coverage_met: true,
        e3_payload_health_met: true,
        threshold_met: false,
      })
    )

    const result = await fetchLocalFramePhaseAlignmentReadiness({
      windowStartUnixMs: 1000,
      windowEndUnixMs: 2000,
    })

    expect(result.threshold_met).toBe(false)
    expect(result.overlap_ratio).toBeNull()
    expect(result.observation_window_ms).toBeNull()
    expect(result.eligible_sample_start_unix_ms).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 2000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("accepts unhealthy frame-phase alignment readiness when e3 payload health fails", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        graph_count: 11,
        malformed_payload_count: 2,
        malformed_graph_payload_count: 1,
        malformed_e3_payload_count: 1,
        excluded_sample_count: 1,
        e3_payload_health_met: false,
        threshold_met: false,
      })
    )

    const result = await fetchLocalFramePhaseAlignmentReadiness({
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })

    expect(result.observation_window_met).toBe(true)
    expect(result.overlap_threshold_met).toBe(true)
    expect(result.e3_payload_coverage_met).toBe(true)
    expect(result.e3_payload_health_met).toBe(false)
    expect(result.threshold_met).toBe(false)
    expect(result.malformed_payload_count).toBe(2)
    expect(result.malformed_graph_payload_count).toBe(1)
    expect(result.malformed_e3_payload_count).toBe(1)
    expect(result.missing_e3_payload_count).toBe(0)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("accepts unhealthy frame-phase alignment readiness when E3 payload coverage fails", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        graph_count: 11,
        missing_e3_payload_count: 1,
        e3_payload_coverage_met: false,
        threshold_met: false,
      })
    )

    const result = await fetchLocalFramePhaseAlignmentReadiness({
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })

    expect(result.observation_window_met).toBe(true)
    expect(result.overlap_threshold_met).toBe(true)
    expect(result.e3_payload_coverage_met).toBe(false)
    expect(result.e3_payload_health_met).toBe(true)
    expect(result.threshold_met).toBe(false)
    expect(result.missing_e3_payload_count).toBe(1)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with inconsistent derived counts", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        graph_count: 11,
        malformed_payload_count: 0,
        malformed_graph_payload_count: 1,
        malformed_e3_payload_count: 1,
        excluded_sample_count: 1,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("malformed_payload_count")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with inconsistent observed payload breakdown", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        observed_payload_count: 9,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("observed_payload_count")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses that mark unhealthy payloads ready", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        malformed_payload_count: 1,
        malformed_e3_payload_count: 1,
        excluded_sample_count: 1,
        e3_payload_health_met: false,
        threshold_met: true,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("threshold_met")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with inconsistent E3 payload coverage", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        graph_count: 11,
        missing_e3_payload_count: 1,
        e3_payload_coverage_met: true,
        threshold_met: true,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("e3_payload_coverage_met")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses that mark missing E3 payloads ready", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        graph_count: 11,
        missing_e3_payload_count: 1,
        e3_payload_coverage_met: false,
        threshold_met: true,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("threshold_met")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses that undercount graph rows", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        graph_count: 10,
        malformed_payload_count: 1,
        malformed_graph_payload_count: 1,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("graph_count")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with unsafe integer counters", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        graph_count: Number.MAX_SAFE_INTEGER + 1,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("graph_count")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with inconsistent overlap ratio", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        matched_sample_count: 7,
        mismatched_sample_count: 1,
        overlap_ratio: 1,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("overlap_ratio")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with inconsistent eligible window", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        eligible_sample_end_unix_ms: null,
        observation_window_ms: 604800000,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("eligible sample range")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses outside the requested window", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        observed_payload_start_unix_ms: 999,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("observed payload range")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses for a different requested window", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValueOnce(
      framePhaseAlignmentReadinessPayload({
        window_start_unix_ms: 0,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("window_start_unix_ms")

    mockInvoke.mockResolvedValueOnce(
      framePhaseAlignmentReadinessPayload({
        window_end_unix_ms: 604802000,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("window_end_unix_ms")
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with eligible samples outside observed range", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        eligible_sample_end_unix_ms: 604801001,
        observation_window_ms: 604800001,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("eligible sample range")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with drifted overlap gate constant", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        minimum_overlap_ratio: 0.9,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("minimum_overlap_ratio")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with drifted contract identity", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        metric: "other_metric",
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("metric")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with drifted contract schema version", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        contract_schema_version: 1,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("contract_schema_version")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with drifted observation window label", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        observation_window: "7d",
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("observation_window")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects frame-phase alignment readiness responses with drifted observation window constant", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue(
      framePhaseAlignmentReadinessPayload({
        minimum_observation_window_ms: 86400000,
      })
    )

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("minimum_observation_window_ms")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_frame_phase_alignment_readiness", {
      windowStartUnixMs: 1000,
      windowEndUnixMs: 604801000,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("throws for local frame-phase alignment readiness outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    await expect(fetchLocalFramePhaseAlignmentReadiness()).rejects.toThrow(
      "fetchLocalFramePhaseAlignmentReadiness is only supported in Tauri runtime"
    )
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("rejects invalid local frame-phase alignment readiness windows before invoking tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: -1,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("windowStartUnixMs")
    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000,
        windowEndUnixMs: -1,
      })
    ).rejects.toThrow("windowEndUnixMs")
    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 2000,
        windowEndUnixMs: 1000,
      })
    ).rejects.toThrow("windowStartUnixMs must be less than or equal to windowEndUnixMs")
    await expect(
      fetchLocalFramePhaseAlignmentReadiness({
        windowStartUnixMs: 1000.5,
        windowEndUnixMs: 604801000,
      })
    ).rejects.toThrow("windowStartUnixMs")

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockRequest).not.toHaveBeenCalled()
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
