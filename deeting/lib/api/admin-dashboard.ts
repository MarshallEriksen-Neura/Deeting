import { z } from "zod"

import { request } from "@/lib/http"

const ADMIN_BASE = "/api/v1/admin"
const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

const OffsetPageMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  skip: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
})

const createOffsetPageSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  OffsetPageMetaSchema.extend({
    items: z.array(itemSchema).default([]),
  })

const AdminUserTotalListSchema = OffsetPageMetaSchema.extend({
  items: z.array(z.unknown()).default([]),
})

const AssistantListSchema = z.object({
  items: z.array(z.object({ id: z.string() }).passthrough()).default([]),
  next_cursor: z.string().nullable().optional(),
  size: z.number().int().nonnegative().optional(),
})

export async function fetchAdminUsersTotal(params?: {
  is_active?: boolean
}): Promise<number> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/users`,
    method: "GET",
    params: {
      limit: 1,
      is_active: params?.is_active,
    },
  })
  const parsed = AdminUserTotalListSchema.parse(data)
  return parsed.total
}

export async function fetchAdminApiKeysTotal(params?: {
  status?: string
}): Promise<number> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/api-keys`,
    method: "GET",
    params: {
      limit: 1,
      status: params?.status,
    },
  })
  const parsed = OffsetPageMetaSchema.extend({
    items: z.array(z.unknown()).default([]),
  }).parse(data)
  return parsed.total
}

export async function fetchAdminAssistantsTotal(params?: {
  status?: string
}): Promise<{ total: number; has_more: boolean }> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/assistants`,
    method: "GET",
    params: {
      size: 100,
      status: params?.status,
    },
  })
  const parsed = AssistantListSchema.parse(data)
  return {
    total: parsed.items.length,
    has_more: Boolean(parsed.next_cursor),
  }
}

const PendingReviewCountsSchema = z.object({
  assistant_reviews: z.number(),
  knowledge_reviews: z.number(),
  plugin_reviews: z.number(),
})

export async function fetchAdminPendingReviewCounts(): Promise<{
  assistant_reviews: number
  knowledge_reviews: number
  plugin_reviews: number
}> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/pending-reviews`,
    method: "GET",
  })

  return PendingReviewCountsSchema.parse(data)
}

const ConversationItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
  assistant_id: z.string().nullable().optional(),
  channel: z.string(),
  status: z.string(),
  message_count: z.number().int().nonnegative().default(0),
  first_message_at: z.string().nullable().optional(),
  last_active_at: z.string().nullable().optional(),
  last_summary_version: z.number().int().nonnegative().default(0),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough()

export const ConversationListSchema = createOffsetPageSchema(ConversationItemSchema)
export type ConversationItem = z.infer<typeof ConversationItemSchema>
export type ConversationList = z.infer<typeof ConversationListSchema>

export async function fetchAdminConversations(params?: {
  skip?: number
  limit?: number
  status?: string
  channel?: string
  user_id?: string
  assistant_id?: string
  start_time?: string
  end_time?: string
}): Promise<ConversationList> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("list_local_admin_conversations", {
      query: {
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
        status: params?.status,
        channel: params?.channel,
        user_id: params?.user_id,
        assistant_id: params?.assistant_id,
        start_time: params?.start_time,
        end_time: params?.end_time,
      },
    })
    return ConversationListSchema.parse(data)
  }

  const data = await request<unknown>({
    url: `${ADMIN_BASE}/conversations`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      status: params?.status,
      channel: params?.channel,
      user_id: params?.user_id,
      assistant_id: params?.assistant_id,
      start_time: params?.start_time,
      end_time: params?.end_time,
    },
  })
  return ConversationListSchema.parse(data)
}

export async function fetchAdminConversation(sessionId: string): Promise<ConversationItem> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("get_local_admin_conversation", {
      sessionId,
    })
    return ConversationItemSchema.parse(data)
  }

  const data = await request<unknown>({
    url: `${ADMIN_BASE}/conversations/${sessionId}`,
    method: "GET",
  })
  return ConversationItemSchema.parse(data)
}

export async function archiveAdminConversation(sessionId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri("archive_local_conversation", {
      sessionId,
    })
    return
  }

  await request<void>({
    url: `${ADMIN_BASE}/conversations/${sessionId}/archive`,
    method: "POST",
  })
}

export async function closeAdminConversation(sessionId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri("close_local_conversation", {
      sessionId,
    })
    return
  }

  await request<void>({
    url: `${ADMIN_BASE}/conversations/${sessionId}/close`,
    method: "POST",
  })
}

const ConversationMessageItemSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  turn_index: z.number().int(),
  role: z.string(),
  content: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  token_estimate: z.number().int().nonnegative().default(0),
  meta_info: z.record(z.string(), z.unknown()).nullable().optional(),
  used_persona_id: z.string().nullable().optional(),
  is_deleted: z.boolean().default(false),
  parent_message_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const ConversationMessageListSchema = createOffsetPageSchema(
  ConversationMessageItemSchema
)
export type ConversationMessageItem = z.infer<typeof ConversationMessageItemSchema>

export async function fetchAdminConversationMessages(
  sessionId: string,
  params?: {
    skip?: number
    limit?: number
    include_deleted?: boolean
  }
): Promise<z.infer<typeof ConversationMessageListSchema>> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("list_local_admin_conversation_messages", {
      sessionId,
      query: {
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
        include_deleted: params?.include_deleted ?? true,
      },
    })
    return ConversationMessageListSchema.parse(data)
  }

  const data = await request<unknown>({
    url: `${ADMIN_BASE}/conversations/${sessionId}/messages`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 50,
      include_deleted: params?.include_deleted ?? true,
    },
  })
  return ConversationMessageListSchema.parse(data)
}

const ConversationSummaryItemSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  version: z.number().int().nonnegative(),
  summary_text: z.string(),
  covered_from_turn: z.number().int(),
  covered_to_turn: z.number().int(),
  token_estimate: z.number().int().nonnegative().default(0),
  summarizer_model: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const ConversationSummaryListSchema = z.object({
  items: z.array(ConversationSummaryItemSchema).default([]),
})

export type ConversationSummaryItem = z.infer<typeof ConversationSummaryItemSchema>

export async function fetchAdminConversationSummaries(
  sessionId: string
): Promise<z.infer<typeof ConversationSummaryListSchema>> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("list_local_admin_conversation_summaries", {
      sessionId,
    })
    return ConversationSummaryListSchema.parse(data)
  }

  const data = await request<unknown>({
    url: `${ADMIN_BASE}/conversations/${sessionId}/summaries`,
    method: "GET",
  })
  return ConversationSummaryListSchema.parse(data)
}

const ConversationSummaryJobItemSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  status: z.string(),
  trigger_source: z.string().nullable().optional(),
  attempts: z.number().int().nonnegative().default(0),
  max_attempts: z.number().int().nonnegative().default(0),
  available_after_epoch: z.number().int(),
  last_error: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const ConversationSummaryJobListSchema = createOffsetPageSchema(
  ConversationSummaryJobItemSchema
)

export type ConversationSummaryJobItem = z.infer<typeof ConversationSummaryJobItemSchema>

const ConversationSummaryIdleTaskItemSchema = z.object({
  session_id: z.string(),
  last_active_epoch: z.number().int(),
  run_after_epoch: z.number().int(),
  is_due: z.boolean().default(false),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const ConversationSummaryIdleTaskListSchema = createOffsetPageSchema(
  ConversationSummaryIdleTaskItemSchema
)

export type ConversationSummaryIdleTaskItem = z.infer<typeof ConversationSummaryIdleTaskItemSchema>

export const ConversationSummaryQueueStatsSchema = z.object({
  pending_jobs: z.number().int().nonnegative().default(0),
  running_jobs: z.number().int().nonnegative().default(0),
  completed_jobs: z.number().int().nonnegative().default(0),
  failed_jobs: z.number().int().nonnegative().default(0),
  idle_due_tasks: z.number().int().nonnegative().default(0),
  idle_total_tasks: z.number().int().nonnegative().default(0),
})

export type ConversationSummaryQueueStats = z.infer<typeof ConversationSummaryQueueStatsSchema>

const ConversationSummaryEnqueueResponseSchema = z.object({
  session_id: z.string(),
  queued: z.boolean(),
})

export const ConversationSummaryBatchRetryResponseSchema = z.object({
  matched_count: z.number().int().nonnegative().default(0),
  queued_count: z.number().int().nonnegative().default(0),
})

export async function fetchLocalConversationSummaryJobs(params?: {
  skip?: number
  limit?: number
  status?: string
  session_id?: string
  error_contains?: string
}): Promise<z.infer<typeof ConversationSummaryJobListSchema>> {
  if (!isTauriRuntime()) {
    throw new Error("fetchLocalConversationSummaryJobs is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("list_local_conversation_summary_jobs", {
    query: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      status: params?.status,
      session_id: params?.session_id,
      error_contains: params?.error_contains,
    },
  })
  return ConversationSummaryJobListSchema.parse(data)
}

export async function fetchLocalConversationSummaryIdleTasks(params?: {
  skip?: number
  limit?: number
  session_id?: string
}): Promise<z.infer<typeof ConversationSummaryIdleTaskListSchema>> {
  if (!isTauriRuntime()) {
    throw new Error("fetchLocalConversationSummaryIdleTasks is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("list_local_conversation_summary_idle_tasks", {
    query: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      session_id: params?.session_id,
    },
  })
  return ConversationSummaryIdleTaskListSchema.parse(data)
}

export async function fetchLocalConversationSummaryQueueStats(): Promise<ConversationSummaryQueueStats> {
  if (!isTauriRuntime()) {
    throw new Error("fetchLocalConversationSummaryQueueStats is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("get_local_conversation_summary_queue_stats")
  return ConversationSummaryQueueStatsSchema.parse(data)
}

export async function triggerLocalConversationSummary(
  sessionId: string
): Promise<z.infer<typeof ConversationSummaryEnqueueResponseSchema>> {
  if (!isTauriRuntime()) {
    throw new Error("triggerLocalConversationSummary is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("trigger_local_conversation_summary_job", {
    sessionId,
  })
  return ConversationSummaryEnqueueResponseSchema.parse(data)
}

export async function retryLocalConversationSummaryJob(
  jobId: string
): Promise<z.infer<typeof ConversationSummaryEnqueueResponseSchema>> {
  if (!isTauriRuntime()) {
    throw new Error("retryLocalConversationSummaryJob is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("retry_local_conversation_summary_job", {
    jobId,
  })
  return ConversationSummaryEnqueueResponseSchema.parse(data)
}

export async function retryLocalConversationSummaryJobs(params?: {
  limit?: number
  status?: string
  session_id?: string
  error_contains?: string
}): Promise<z.infer<typeof ConversationSummaryBatchRetryResponseSchema>> {
  if (!isTauriRuntime()) {
    throw new Error("retryLocalConversationSummaryJobs is only supported in Tauri runtime")
  }

  const data = await invokeTauri<unknown>("retry_local_conversation_summary_jobs", {
    payload: {
      limit: params?.limit,
      status: params?.status,
      session_id: params?.session_id,
      error_contains: params?.error_contains,
    },
  })
  return ConversationSummaryBatchRetryResponseSchema.parse(data)
}

const SpecPlanItemSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  conversation_session_id: z.string().nullable().optional(),
  project_name: z.string(),
  status: z.string(),
  version: z.number().int(),
  priority: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const SpecPlanListSchema = createOffsetPageSchema(SpecPlanItemSchema)
export type SpecPlanItem = z.infer<typeof SpecPlanItemSchema>

export async function fetchAdminSpecPlans(params?: {
  skip?: number
  limit?: number
  status?: string
}): Promise<z.infer<typeof SpecPlanListSchema>> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-plans`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      status: params?.status,
    },
  })
  return SpecPlanListSchema.parse(data)
}

export async function pauseAdminSpecPlan(planId: string): Promise<SpecPlanItem> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-plans/${planId}/pause`,
    method: "POST",
  })
  return SpecPlanItemSchema.parse(data)
}

export async function resumeAdminSpecPlan(planId: string): Promise<SpecPlanItem> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-plans/${planId}/resume`,
    method: "POST",
  })
  return SpecPlanItemSchema.parse(data)
}

const SpecExecutionLogItemSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  node_id: z.string(),
  status: z.string(),
  worker_info: z.string().nullable().optional(),
  input_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  output_data: z.record(z.string(), z.unknown()).nullable().optional(),
  raw_response: z.unknown().nullable().optional(),
  error_message: z.string().nullable().optional(),
  retry_count: z.number().int().default(0),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const SpecExecutionLogListSchema = createOffsetPageSchema(SpecExecutionLogItemSchema)
export type SpecExecutionLogItem = z.infer<typeof SpecExecutionLogItemSchema>

export async function fetchAdminSpecPlanLogs(
  planId: string,
  params?: {
    skip?: number
    limit?: number
    status?: string
  }
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-plans/${planId}/logs`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      status: params?.status,
    },
  })
  return SpecExecutionLogListSchema.parse(data)
}

const SpecWorkerSessionItemSchema = z.object({
  id: z.string(),
  log_id: z.string(),
  internal_messages: z.array(z.record(z.string(), z.unknown())).default([]),
  thought_trace: z.array(z.record(z.string(), z.unknown())).default([]),
  total_tokens: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

const SpecWorkerSessionListSchema = z.object({
  items: z.array(SpecWorkerSessionItemSchema).default([]),
}).passthrough()

export type SpecWorkerSessionItem = z.infer<typeof SpecWorkerSessionItemSchema>

export async function fetchAdminSpecLogSessions(logId: string) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-logs/${logId}/sessions`,
    method: "GET",
  })
  return SpecWorkerSessionListSchema.parse(data)
}

const GenerationTaskItemSchema = z.object({
  id: z.string(),
  task_type: z.string(),
  model: z.string(),
  user_id: z.string().nullable().optional(),
  status: z.string(),
  prompt_raw: z.string(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  cost_user: z.number().default(0),
  error_code: z.string().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
}).passthrough()

export const GenerationTaskListSchema = createOffsetPageSchema(GenerationTaskItemSchema)
export type GenerationTaskItem = z.infer<typeof GenerationTaskItemSchema>

export async function fetchAdminGenerationTasks(params?: {
  skip?: number
  limit?: number
  status?: string
  task_type?: string
}): Promise<z.infer<typeof GenerationTaskListSchema>> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/generation-tasks`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      status: params?.status,
      task_type: params?.task_type,
    },
  })
  return GenerationTaskListSchema.parse(data)
}

export async function fetchAdminGenerationTask(taskId: string): Promise<GenerationTaskItem> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/generation-tasks/${taskId}`,
    method: "GET",
  })
  return GenerationTaskItemSchema.parse(data)
}

const GenerationOutputItemSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  output_index: z.number().int(),
  media_asset_id: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  content_type: z.string().nullable().optional(),
  size_bytes: z.number().int().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

const GenerationOutputListSchema = z.object({
  items: z.array(GenerationOutputItemSchema).default([]),
}).passthrough()

export type GenerationOutputItem = z.infer<typeof GenerationOutputItemSchema>

export async function fetchAdminGenerationTaskOutputs(taskId: string) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/generation-tasks/${taskId}/outputs`,
    method: "GET",
  })
  return GenerationOutputListSchema.parse(data)
}

const GenerationShareItemSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  user_id: z.string(),
  model: z.string(),
  prompt: z.string().nullable().optional(),
  is_active: z.boolean(),
  shared_at: z.string(),
  revoked_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const GenerationShareListSchema = createOffsetPageSchema(GenerationShareItemSchema)
export type GenerationShareItem = z.infer<typeof GenerationShareItemSchema>

export async function fetchAdminGenerationShares(params?: {
  skip?: number
  limit?: number
  is_active?: boolean
  user_id?: string
  task_id?: string
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/generation-shares`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      is_active: params?.is_active,
      user_id: params?.user_id,
      task_id: params?.task_id,
    },
  })
  return GenerationShareListSchema.parse(data)
}

export async function updateAdminGenerationShareActive(
  shareId: string,
  isActive: boolean
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/generation-shares/${shareId}`,
    method: "PATCH",
    data: {
      is_active: isActive,
    },
  })
  return GenerationShareItemSchema.parse(data)
}

const TenantQuotaItemSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  balance: z.number(),
  credit_limit: z.number(),
  daily_quota: z.number().int().nonnegative(),
  daily_used: z.number().int().nonnegative(),
  monthly_quota: z.number().int().nonnegative(),
  monthly_used: z.number().int().nonnegative(),
  rpm_limit: z.number().int().nonnegative(),
  is_active: z.boolean(),
  updated_at: z.string(),
}).passthrough()

export const TenantQuotaListSchema = createOffsetPageSchema(TenantQuotaItemSchema)
export type TenantQuotaItem = z.infer<typeof TenantQuotaItemSchema>

export async function fetchAdminQuotas(params?: {
  skip?: number
  limit?: number
  is_active?: boolean
}): Promise<z.infer<typeof TenantQuotaListSchema>> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/quotas`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      is_active: params?.is_active,
    },
  })
  return TenantQuotaListSchema.parse(data)
}

const BillingTransactionItemSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  trace_id: z.string(),
  type: z.string(),
  status: z.string(),
  amount: z.number(),
  model: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough()

export const BillingTransactionListSchema = createOffsetPageSchema(BillingTransactionItemSchema)
export type BillingTransactionItem = z.infer<typeof BillingTransactionItemSchema>

export async function fetchAdminBillingTransactions(params?: {
  skip?: number
  limit?: number
  type?: string
  status?: string
}): Promise<z.infer<typeof BillingTransactionListSchema>> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/billing/transactions`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      type: params?.type,
      status: params?.status,
    },
  })
  return BillingTransactionListSchema.parse(data)
}

export const BillingSummarySchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
  income: z.number(),
  refunds: z.number(),
  cost: z.number(),
  profit: z.number(),
  transaction_count: z.number().int().nonnegative(),
})

export type BillingSummary = z.infer<typeof BillingSummarySchema>

export async function fetchAdminBillingSummary(): Promise<BillingSummary> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/billing/summary`,
    method: "GET",
  })
  return BillingSummarySchema.parse(data)
}

const GatewayLogItemSchema = z.object({
  id: z.string(),
  trace_id: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
  api_key_id: z.string().nullable().optional(),
  model: z.string(),
  status_code: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
  ttft_ms: z.number().int().nullable().optional(),
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cost_user: z.number().default(0),
  is_cached: z.boolean().default(false),
  error_code: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough()

export const GatewayLogListSchema = createOffsetPageSchema(GatewayLogItemSchema)
export type GatewayLogItem = z.infer<typeof GatewayLogItemSchema>

type GatewayLogFilterParams = {
  start_time?: string
  end_time?: string
  model?: string
  status_code?: number
  is_cached?: boolean
  error_code?: string
}

export async function fetchAdminGatewayLogs(params?: GatewayLogFilterParams & {
  skip?: number
  limit?: number
}): Promise<z.infer<typeof GatewayLogListSchema>> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("list_local_gateway_logs", {
      query: {
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
        start_time: params?.start_time,
        end_time: params?.end_time,
        model: params?.model,
        status_code: params?.status_code,
        is_cached: params?.is_cached,
        error_code: params?.error_code,
      },
    })
    return GatewayLogListSchema.parse(data)
  }

  const data = await request<unknown>({
    url: `${ADMIN_BASE}/gateway-logs`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      start_time: params?.start_time,
      end_time: params?.end_time,
      model: params?.model,
      status_code: params?.status_code,
      is_cached: params?.is_cached,
      error_code: params?.error_code,
    },
  })
  return GatewayLogListSchema.parse(data)
}

const GatewayLogStatsBucketSchema = z.object({
  key: z.string(),
  count: z.number().int().nonnegative(),
})

export const GatewayLogStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  success_rate: z.number(),
  cache_hit_rate: z.number(),
  avg_duration_ms: z.number().int().nonnegative().default(0),
  total_cost_user: z.number().nonnegative().default(0),
  error_distribution: z.array(GatewayLogStatsBucketSchema).default([]),
  model_ranking: z.array(GatewayLogStatsBucketSchema).default([]),
  latency_histogram: z.array(GatewayLogStatsBucketSchema).default([]),
})

export type GatewayLogStats = z.infer<typeof GatewayLogStatsSchema>

export async function fetchAdminGatewayLogStats(
  params?: GatewayLogFilterParams
): Promise<GatewayLogStats> {
  if (isTauriRuntime()) {
    const data = await invokeTauri<unknown>("get_local_gateway_log_stats", {
      query: {
        start_time: params?.start_time,
        end_time: params?.end_time,
        model: params?.model,
        status_code: params?.status_code,
        is_cached: params?.is_cached,
        error_code: params?.error_code,
      },
    })
    return GatewayLogStatsSchema.parse(data)
  }

  const data = await request<unknown>({
    url: `${ADMIN_BASE}/gateway-logs/stats`,
    method: "GET",
    params: {
      start_time: params?.start_time,
      end_time: params?.end_time,
      model: params?.model,
      status_code: params?.status_code,
      is_cached: params?.is_cached,
      error_code: params?.error_code,
    },
  })
  return GatewayLogStatsSchema.parse(data)
}

const KnowledgeArtifactItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  source_url: z.string(),
  artifact_type: z.string(),
  status: z.string(),
  embedding_model: z.string().nullable().optional(),
  chunk_count: z.number().int().nonnegative().default(0),
  created_at: z.string(),
}).passthrough()

export const KnowledgeArtifactListSchema = createOffsetPageSchema(KnowledgeArtifactItemSchema)
export type KnowledgeArtifactItem = z.infer<typeof KnowledgeArtifactItemSchema>

export async function fetchAdminKnowledgeArtifacts(params?: {
  skip?: number
  limit?: number
  status?: string
  artifact_type?: string
  q?: string
}): Promise<z.infer<typeof KnowledgeArtifactListSchema>> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/knowledge/artifacts`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      status: params?.status,
      artifact_type: params?.artifact_type,
      q: params?.q,
    },
  })
  return KnowledgeArtifactListSchema.parse(data)
}

const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
})

const AdminUserItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const AdminUserListSchema = createOffsetPageSchema(AdminUserItemSchema)
export type AdminUserItem = z.infer<typeof AdminUserItemSchema>

export async function fetchAdminUsers(params?: {
  skip?: number
  limit?: number
  email?: string
  is_active?: boolean
  is_superuser?: boolean
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/users`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      email: params?.email,
      is_active: params?.is_active,
      is_superuser: params?.is_superuser,
    },
  })
  return AdminUserListSchema.parse(data)
}

const UserWithRolesSchema = AdminUserItemSchema.extend({
  roles: z.array(RoleSchema).default([]),
})

export type UserWithRoles = z.infer<typeof UserWithRolesSchema>

export async function fetchAdminUserById(userId: string): Promise<UserWithRoles> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/users/${userId}`,
    method: "GET",
  })
  return UserWithRolesSchema.parse(data)
}

type AdminUserCreatePayload = {
  email: string
  password: string
  username?: string
}

export async function createAdminUser(payload: AdminUserCreatePayload) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/users`,
    method: "POST",
    data: payload,
  })
  return AdminUserItemSchema.parse(data)
}

type AdminUserUpdatePayload = {
  is_active?: boolean
  is_superuser?: boolean
  username?: string
}

export async function updateAdminUser(userId: string, payload: AdminUserUpdatePayload) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/users/${userId}`,
    method: "PATCH",
    data: payload,
  })
  return AdminUserItemSchema.parse(data)
}

const AdminApiKeyItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: z.string(),
  status: z.string(),
  user_id: z.string().nullable().optional(),
  tenant_id: z.string().nullable().optional(),
  key_prefix: z.string(),
  key_hint: z.string(),
  last_used_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const AdminApiKeyListSchema = createOffsetPageSchema(AdminApiKeyItemSchema)
export type AdminApiKeyItem = z.infer<typeof AdminApiKeyItemSchema>

export async function fetchAdminApiKeys(params?: {
  skip?: number
  limit?: number
  type?: string
  status?: string
  tenant_id?: string
  user_id?: string
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/api-keys`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      type: params?.type,
      status: params?.status,
      tenant_id: params?.tenant_id,
      user_id: params?.user_id,
    },
  })
  return AdminApiKeyListSchema.parse(data)
}

const AdminApiKeyCreatedSchema = z.object({
  api_key: AdminApiKeyItemSchema,
  raw_key: z.string(),
}).passthrough()

export type AdminApiKeyCreated = z.infer<typeof AdminApiKeyCreatedSchema>
const AdminApiKeyRotateResponseSchema = z.object({
  new_key: AdminApiKeyItemSchema,
  raw_key: z.string(),
  old_key_expires_at: z.string(),
}).passthrough()

export type AdminApiKeyRotateResponse = z.infer<typeof AdminApiKeyRotateResponseSchema>

type AdminApiKeyCreatePayload = {
  name: string
  type: "internal" | "external"
  tenant_id?: string
  user_id?: string
  expires_at?: string
}

export async function createAdminApiKey(payload: AdminApiKeyCreatePayload) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/api-keys`,
    method: "POST",
    data: payload,
  })
  return AdminApiKeyCreatedSchema.parse(data)
}

export async function revokeAdminApiKey(apiKeyId: string, reason?: string) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/api-keys/${apiKeyId}/revoke`,
    method: "POST",
    data: {
      reason: reason?.trim() || "revoked by admin dashboard",
    },
  })
  return AdminApiKeyItemSchema.parse(data)
}

export async function deleteAdminApiKey(apiKeyId: string) {
  await request<void>({
    url: `${ADMIN_BASE}/api-keys/${apiKeyId}`,
    method: "DELETE",
  })
}

export async function rotateAdminApiKey(
  apiKeyId: string,
  params?: {
    grace_period_hours?: number
  }
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/api-keys/${apiKeyId}/rotate`,
    method: "POST",
    params: {
      grace_period_hours: params?.grace_period_hours,
    },
  })
  return AdminApiKeyRotateResponseSchema.parse(data)
}

const AssistantVersionSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  system_prompt: z.string().nullable().optional(),
  model_config: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).default([]),
  published_at: z.string().nullable().optional(),
}).passthrough()

const AdminAssistantItemSchema = z.object({
  id: z.string(),
  owner_user_id: z.string().nullable().optional(),
  visibility: z.string(),
  status: z.string(),
  summary: z.string().nullable().optional(),
  icon_id: z.string().nullable().optional(),
  current_version_id: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  install_count: z.number().default(0),
  rating_avg: z.number().default(0),
  rating_count: z.number().default(0),
  versions: z.array(AssistantVersionSchema).default([]),
}).passthrough()

export const AdminAssistantListSchema = z.object({
  items: z.array(AdminAssistantItemSchema).default([]),
  next_cursor: z.string().nullable().optional(),
  size: z.number().int().nonnegative().optional(),
})

export type AdminAssistantItem = z.infer<typeof AdminAssistantItemSchema>

export async function fetchAdminAssistants(params?: {
  cursor?: string | null
  size?: number
  status?: string
  visibility?: string
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/assistants`,
    method: "GET",
    params: {
      cursor: params?.cursor ?? undefined,
      size: params?.size ?? 100,
      status: params?.status,
      visibility: params?.visibility,
    },
  })
  return AdminAssistantListSchema.parse(data)
}

type AdminAssistantCreatePayload = {
  visibility?: "private" | "unlisted" | "public"
  status?: "draft" | "published" | "archived"
  summary?: string
  icon_id?: string
  share_to_market?: boolean
  version: {
    version?: string
    name: string
    description?: string
    system_prompt: string
    model_config?: Record<string, unknown>
    tags?: string[]
  }
}

export async function createAdminAssistant(payload: AdminAssistantCreatePayload) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/assistants`,
    method: "POST",
    data: payload,
  })
  return AdminAssistantItemSchema.parse(data)
}

export async function deleteAdminAssistant(assistantId: string): Promise<void> {
  await request<void>({
    url: `${ADMIN_BASE}/assistants/${assistantId}`,
    method: "DELETE",
  })
}

const CursorPageSchema = z.object({
  items: z.array(z.unknown()).default([]),
  next_page: z.string().nullable().optional(),
  previous_page: z.string().nullable().optional(),
  total: z.number().int().nonnegative().optional(),
}).passthrough()

const ReviewTaskSchema = z.object({
  id: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  status: z.string(),
  submitter_user_id: z.string().nullable().optional(),
  reviewer_user_id: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const AssistantReviewPageSchema = CursorPageSchema.extend({
  items: z.array(ReviewTaskSchema).default([]),
})

export type AssistantReviewTask = z.infer<typeof ReviewTaskSchema>

const PluginMarketReviewFindingSchema = z.object({
  severity: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  file: z.string().nullable().optional(),
})

const PluginMarketReviewItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  runtime: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  source_repo: z.string().nullable().optional(),
  source_revision: z.string().nullable().optional(),
  source_subdir: z.string().nullable().optional(),
  risk_level: z.string().nullable().optional(),
  submission_channel: z.string().nullable().optional(),
  requires_admin_approval: z.boolean().default(false),
  submitter_user_id: z.string().nullable().optional(),
  reviewer_user_id: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  review_reason: z.string().nullable().optional(),
  security_review_decision: z.string().nullable().optional(),
  security_review_summary: z.string().nullable().optional(),
  network_targets: z.array(z.string()).default([]),
  destructive_actions: z.array(z.string()).default([]),
  privacy_risks: z.array(z.string()).default([]),
  findings: z.array(PluginMarketReviewFindingSchema).default([]),
  manifest_json: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
})

export const PluginMarketReviewListSchema = createOffsetPageSchema(
  PluginMarketReviewItemSchema
)

export type PluginMarketReviewItem = z.infer<typeof PluginMarketReviewItemSchema>

export async function fetchAdminAssistantReviews(params?: {
  status_filter?: string
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/assistant-reviews`,
    method: "GET",
    params: {
      status_filter: params?.status_filter,
    },
  })
  return AssistantReviewPageSchema.parse(data)
}

export async function approveAdminAssistantReview(
  assistantId: string,
  reason?: string
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/assistant-reviews/${assistantId}/approve`,
    method: "POST",
    data: { reason: reason ?? "approved by admin dashboard" },
  })
  return ReviewTaskSchema.parse(data)
}

export async function rejectAdminAssistantReview(
  assistantId: string,
  reason?: string
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/assistant-reviews/${assistantId}/reject`,
    method: "POST",
    data: { reason: reason ?? "rejected by admin dashboard" },
  })
  return ReviewTaskSchema.parse(data)
}

export async function fetchAdminPluginMarketReviews(params?: {
  skip?: number
  limit?: number
  status_filter?: string
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/plugin-reviews`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      status_filter: params?.status_filter,
    },
  })
  return PluginMarketReviewListSchema.parse(data)
}

export async function approveAdminPluginReview(skillId: string, reason?: string) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/plugin-reviews/${skillId}/approve`,
    method: "POST",
    data: { reason: reason ?? "approved by admin dashboard" },
  })
  return PluginMarketReviewItemSchema.parse(data)
}

export async function rejectAdminPluginReview(skillId: string, reason?: string) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/plugin-reviews/${skillId}/reject`,
    method: "POST",
    data: { reason: reason ?? "rejected by admin dashboard" },
  })
  return PluginMarketReviewItemSchema.parse(data)
}

const SpecKnowledgeCandidateSchema = z.object({
  id: z.string(),
  project_name: z.string().nullable().optional(),
  status: z.string(),
  review_status: z.string().nullable().optional(),
  usage_stats: z.object({
    positive_feedback: z.number().int().default(0),
    negative_feedback: z.number().int().default(0),
    apply_count: z.number().int().default(0),
    revert_count: z.number().int().default(0),
    total_runs: z.number().int().default(0),
    success_runs: z.number().int().default(0),
    success_rate: z.number().default(0),
    unique_sessions: z.number().int().default(0),
  }),
  eval_snapshot: z.object({
    static_pass: z.boolean().default(false),
    llm_score: z.number().int().nullable().optional(),
    critic_reason: z.string().nullable().optional(),
  }),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export const SpecKnowledgeCandidatePageSchema = CursorPageSchema.extend({
  items: z.array(SpecKnowledgeCandidateSchema).default([]),
})
export type SpecKnowledgeCandidate = z.infer<typeof SpecKnowledgeCandidateSchema>

export async function fetchAdminSpecKnowledgeCandidates(params?: {
  status_filter?: string
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-knowledge-candidates`,
    method: "GET",
    params: {
      status_filter: params?.status_filter,
    },
  })
  return SpecKnowledgeCandidatePageSchema.parse(data)
}

export async function approveAdminSpecKnowledgeCandidate(
  candidateId: string,
  reason?: string
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-knowledge-candidates/${candidateId}/approve`,
    method: "POST",
    data: { reason: reason ?? "approved by admin dashboard" },
  })
  return SpecKnowledgeCandidateSchema.parse(data)
}

export async function rejectAdminSpecKnowledgeCandidate(
  candidateId: string,
  reason?: string
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/spec-knowledge-candidates/${candidateId}/reject`,
    method: "POST",
    data: { reason: reason ?? "rejected by admin dashboard" },
  })
  return SpecKnowledgeCandidateSchema.parse(data)
}

const ProviderInstanceItemSchema = z.object({
  id: z.string(),
  preset_slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  base_url: z.string(),
  protocol: z.string().nullable().optional(),
  auto_append_v1: z.boolean().nullable().optional(),
  priority: z.number().int(),
  is_enabled: z.boolean(),
  is_public: z.boolean().default(false),
  health_status: z.string().nullable().optional(),
  latency_ms: z.number().int().optional(),
  sparkline: z.array(z.number().int()).default([]),
  model_count: z.number().int().default(0),
  has_credentials: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export type ProviderInstanceItem = z.infer<typeof ProviderInstanceItemSchema>

export async function fetchAdminProviderInstances() {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances`,
    method: "GET",
  })
  return z.array(ProviderInstanceItemSchema).parse(data)
}

type AdminProviderInstanceCreatePayload = {
  preset_slug: string
  name: string
  description?: string
  base_url: string
  protocol?: string
  auto_append_v1?: boolean
  priority?: number
  is_enabled?: boolean
  is_public?: boolean
  credentials_ref?: string
  api_key?: string
}

export async function createAdminProviderInstance(
  payload: AdminProviderInstanceCreatePayload
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances`,
    method: "POST",
    data: payload,
  })
  return ProviderInstanceItemSchema.parse(data)
}

type AdminProviderInstanceUpdatePayload = {
  is_public: boolean
}

export async function updateAdminProviderInstance(
  instanceId: string,
  payload: AdminProviderInstanceUpdatePayload
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances/${instanceId}`,
    method: "PATCH",
    data: payload,
  })
  return ProviderInstanceItemSchema.parse(data)
}

const AdminProviderModelResponseSchema = z.object({
  id: z.string().uuid(),
  instance_id: z.string().uuid(),
  capabilities: z.array(z.string()).default([]),
  model_id: z.string(),
  unified_model_id: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  upstream_path: z.string(),
  pricing_config: z.record(z.string(), z.unknown()).default({}),
  limit_config: z.record(z.string(), z.unknown()).default({}),
  tokenizer_config: z.record(z.string(), z.unknown()).default({}),
  routing_config: z.record(z.string(), z.unknown()).default({}),
  config_override: z.record(z.string(), z.unknown()).default({}),
  source: z.string(),
  extra_meta: z.record(z.string(), z.unknown()).default({}),
  weight: z.number(),
  priority: z.number(),
  is_active: z.boolean(),
  synced_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const AdminProviderModelUpsertSchema = z.object({
  capabilities: z.array(z.string()).default([]),
  model_id: z.string(),
  unified_model_id: z.string().nullable().optional(),
  upstream_path: z.string(),
  display_name: z.string().nullable().optional(),
  pricing_config: z.record(z.string(), z.unknown()).default({}),
  limit_config: z.record(z.string(), z.unknown()).default({}),
  tokenizer_config: z.record(z.string(), z.unknown()).default({}),
  routing_config: z.record(z.string(), z.unknown()).default({}),
  config_override: z.record(z.string(), z.unknown()).default({}),
  source: z.string().default("auto"),
  extra_meta: z.record(z.string(), z.unknown()).default({}),
  weight: z.number().default(100),
  priority: z.number().default(0),
  is_active: z.boolean().default(true),
})

const AdminProviderModelsUpsertPayloadSchema = z.object({
  models: z.array(AdminProviderModelUpsertSchema).default([]),
})

const AdminProviderModelUpdateSchema = z.object({
  display_name: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  capabilities: z.array(z.string()).optional(),
  weight: z.number().optional(),
  priority: z.number().optional(),
  upstream_path: z.string().nullable().optional(),
  pricing_config: z.record(z.string(), z.unknown()).optional(),
  limit_config: z.record(z.string(), z.unknown()).optional(),
  tokenizer_config: z.record(z.string(), z.unknown()).optional(),
  routing_config: z.record(z.string(), z.unknown()).optional(),
  config_override: z.record(z.string(), z.unknown()).optional(),
})

export type AdminProviderModelResponse = z.infer<typeof AdminProviderModelResponseSchema>
export type AdminProviderModelsUpsertPayload = z.infer<
  typeof AdminProviderModelsUpsertPayloadSchema
>
export type AdminProviderModelUpdate = z.infer<typeof AdminProviderModelUpdateSchema>

export async function fetchAdminProviderModels(
  instanceId: string
): Promise<AdminProviderModelResponse[]> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances/${instanceId}/models`,
    method: "GET",
  })
  return z.array(AdminProviderModelResponseSchema).parse(data)
}

export async function syncAdminProviderModels(
  instanceId: string,
  payload?: AdminProviderModelsUpsertPayload,
  options?: { preserve_user_overrides?: boolean }
): Promise<AdminProviderModelResponse[]> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances/${instanceId}/models:sync`,
    method: "POST",
    params: {
      preserve_user_overrides: options?.preserve_user_overrides ?? true,
    },
    data: payload,
  })
  return z.array(AdminProviderModelResponseSchema).parse(data)
}

export async function updateAdminProviderModel(
  modelId: string,
  payload: AdminProviderModelUpdate
): Promise<AdminProviderModelResponse> {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances/models/${modelId}`,
    method: "PATCH",
    data: payload,
  })
  return AdminProviderModelResponseSchema.parse(data)
}

const ProviderCredentialItemSchema = z.object({
  id: z.string(),
  instance_id: z.string(),
  alias: z.string(),
  weight: z.number().int(),
  priority: z.number().int(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export type ProviderCredentialItem = z.infer<typeof ProviderCredentialItemSchema>

export async function fetchAdminProviderCredentials(instanceId: string) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances/${instanceId}/credentials`,
    method: "GET",
  })
  return z.array(ProviderCredentialItemSchema).parse(data)
}

type AdminProviderCredentialCreatePayload = {
  alias: string
  secret_ref_id?: string
  api_key?: string
  weight?: number
  priority?: number
  is_active?: boolean
}

export async function createAdminProviderCredential(
  instanceId: string,
  payload: AdminProviderCredentialCreatePayload
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-instances/${instanceId}/credentials`,
    method: "POST",
    data: payload,
  })
  return ProviderCredentialItemSchema.parse(data)
}

export async function deleteAdminProviderCredential(
  instanceId: string,
  credentialId: string
) {
  await request<void>({
    url: `${ADMIN_BASE}/provider-instances/${instanceId}/credentials/${credentialId}`,
    method: "DELETE",
  })
}

const ProviderPresetItemSchema = z.object({
  id: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  base_url: z.string().nullable().optional(),
  url_template: z.string().nullable().optional(),
  theme_color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  protocol_schema_version: z.string().nullable().optional(),
  protocol_profiles: z.record(z.string(), z.unknown()).default({}),
  is_active: z.boolean().default(true),
}).passthrough()

export type ProviderPresetItem = z.infer<typeof ProviderPresetItemSchema>

export async function fetchAdminProviderPresets() {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/provider-presets`,
    method: "GET",
  })
  return z.array(ProviderPresetItemSchema).parse(data)
}

const RegistrationWindowSchema = z.object({
  id: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  max_registrations: z.number().int().nonnegative(),
  registered_count: z.number().int().nonnegative(),
  auto_activate: z.boolean(),
  status: z.string(),
}).passthrough()

const RegistrationInviteItemSchema = z.object({
  code: z.string(),
  status: z.string(),
  expires_at: z.string().nullable().optional(),
  used_by: z.string().nullable().optional(),
  used_at: z.string().nullable().optional(),
  reserved_at: z.string().nullable().optional(),
}).passthrough()

const RegistrationInviteListSchema = createOffsetPageSchema(
  RegistrationInviteItemSchema
)

export type RegistrationWindow = z.infer<typeof RegistrationWindowSchema>
export type RegistrationInviteItem = z.infer<typeof RegistrationInviteItemSchema>

export async function fetchAdminActiveRegistrationWindow() {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/registration/windows/active`,
    method: "GET",
  })
  if (!data) return null
  return RegistrationWindowSchema.parse(data)
}

export async function fetchAdminRegistrationInvites(params: {
  window_id: string
  status?: string
  skip?: number
  limit?: number
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/registration/windows/${params.window_id}/invites`,
    method: "GET",
    params: {
      status: params.status,
      skip: params.skip ?? 0,
      limit: params.limit ?? 100,
    },
  })
  return RegistrationInviteListSchema.parse(data)
}

type AdminRegistrationWindowCreatePayload = {
  start_time: string
  end_time: string
  max_registrations: number
  auto_activate: boolean
}

export async function createAdminRegistrationWindow(
  payload: AdminRegistrationWindowCreatePayload
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/registration/windows`,
    method: "POST",
    data: payload,
  })
  return RegistrationWindowSchema.parse(data)
}

type AdminInviteIssuePayload = {
  count: number
  length?: number
  prefix?: string
  expires_at?: string
  note?: string
}

export async function issueAdminRegistrationInvites(
  windowId: string,
  payload: AdminInviteIssuePayload
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/registration/windows/${windowId}/invites`,
    method: "POST",
    data: payload,
  })
  return z.array(z.string()).parse(data)
}

const NotificationPublishResponseSchema = z.object({
  notification_id: z.string(),
  scheduled: z.boolean(),
  message: z.string(),
})

const NotificationAdminItemSchema = z.object({
  id: z.string(),
  tenant_id: z.string().nullable().optional(),
  type: z.string(),
  level: z.string(),
  title: z.string(),
  content: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  source: z.string().nullable().optional(),
  dedupe_key: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

const NotificationAdminListSchema = createOffsetPageSchema(NotificationAdminItemSchema)

export type NotificationPublishResponse = z.infer<
  typeof NotificationPublishResponseSchema
>
export type NotificationAdminItem = z.infer<typeof NotificationAdminItemSchema>

type NotificationSendPayload = {
  title: string
  content: string
  type?: string
  level?: string
  payload?: Record<string, unknown>
  source?: string
  dedupe_key?: string
  expires_at?: string
  tenant_id?: string
}

export async function publishAdminNotificationToUser(
  userId: string,
  payload: NotificationSendPayload
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/notifications/users/${userId}`,
    method: "POST",
    data: payload,
  })
  return NotificationPublishResponseSchema.parse(data)
}

export async function fetchAdminNotifications(params?: {
  skip?: number
  limit?: number
  type?: string
  level?: string
  source?: string
  q?: string
  is_active?: boolean
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/notifications`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
      type: params?.type,
      level: params?.level,
      source: params?.source,
      q: params?.q,
      is_active: params?.is_active,
    },
  })
  return NotificationAdminListSchema.parse(data)
}

export async function broadcastAdminNotification(
  payload: NotificationSendPayload & { active_only?: boolean }
) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/notifications/broadcast`,
    method: "POST",
    data: payload,
  })
  return NotificationPublishResponseSchema.parse(data)
}

const SkillItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
  runtime: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  risk_level: z.string().nullable().optional(),
  complexity_score: z.number().nullable().optional(),
  manifest_json: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough()

export type SkillItem = z.infer<typeof SkillItemSchema>

export async function fetchAdminSkills(params?: { skip?: number; limit?: number }) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/skills`,
    method: "GET",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 100,
    },
  })
  return z.array(SkillItemSchema).parse(data)
}

export async function deleteAdminSkill(skillId: string): Promise<void> {
  await request<void>({
    url: `${ADMIN_BASE}/skills/${skillId}`,
    method: "DELETE",
  })
}

const EmbeddingSettingSchema = z.object({
  // Admin API still uses this legacy field name for the selected embedding model reference.
  model_name: z.string().nullable().optional(),
})

export type AdminEmbeddingSetting = z.infer<typeof EmbeddingSettingSchema>

const RechargePolicySchema = z.object({
  credit_per_unit: z.number().positive(),
  currency: z.string().min(1),
})

export type AdminRechargePolicy = z.infer<typeof RechargePolicySchema>

const INTERNAL_ADMIN_BASE = "/api/v1/internal/admin"

/**
 * Provider Preset Wishes (Internal)
 */
export async function fetchProviderWishes(params?: {
  status?: string
  limit?: number
}) {
  return request<unknown[]>({
    url: `${INTERNAL_ADMIN_BASE}/provider-presets/wishes`,
    method: "GET",
    params,
  })
}

export async function createProviderWish(payload: {
  provider_name: string
  model_names?: string[]
  reason?: string
  priority?: number
}) {
  return request<Record<string, unknown>>({
    url: `${INTERNAL_ADMIN_BASE}/provider-presets/wishes`,
    method: "POST",
    data: payload,
  })
}

export async function fetchAdminEmbeddingSetting() {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/settings/embedding`,
    method: "GET",
  })
  return EmbeddingSettingSchema.parse(data)
}

export async function updateAdminEmbeddingSetting(modelReference: string) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/settings/embedding`,
    method: "PATCH",
    data: {
      model_name: modelReference,
    },
  })
  return EmbeddingSettingSchema.parse(data)
}

export async function fetchAdminRechargePolicy() {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/settings/recharge-policy`,
    method: "GET",
  })
  return RechargePolicySchema.parse(data)
}

export async function updateAdminRechargePolicy(payload: {
  credit_per_unit: number
  currency: string
}) {
  const data = await request<unknown>({
    url: `${ADMIN_BASE}/settings/recharge-policy`,
    method: "PATCH",
    data: payload,
  })
  return RechargePolicySchema.parse(data)
}
