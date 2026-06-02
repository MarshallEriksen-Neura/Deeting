import { z } from "zod"

import { request } from "@/lib/http"
import { isTauriCommandRuntime } from "@/lib/runtime/tauri"

const ADMIN_BASE = "/api/v1/admin"
const isTauriRuntime = isTauriCommandRuntime
const FRAME_PHASE_ALIGNMENT_METRIC = "frame_phase_step_alignment"
const FRAME_PHASE_ALIGNMENT_CONTRACT_SCHEMA_VERSION = 2
const FRAME_PHASE_ALIGNMENT_OBSERVATION_WINDOW = "1-2w"
const FRAME_PHASE_ALIGNMENT_RATIO_TOLERANCE = 0.000_000_001
const FRAME_PHASE_ALIGNMENT_MINIMUM_RATIO = 0.95
const FRAME_PHASE_ALIGNMENT_MINIMUM_NON_DIRECT_STRATEGY_RATIO = 0.01
const FRAME_PHASE_ALIGNMENT_MINIMUM_OBSERVATION_WINDOW_MS = 604800000
const NonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export type LocalFramePhaseAlignmentReadinessParams = {
  windowStartUnixMs?: number
  windowEndUnixMs?: number
}

function isValidUnixMsBound(value: number | undefined) {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0)
}

export function isLocalFramePhaseAlignmentReadinessWindowValid(
  params?: LocalFramePhaseAlignmentReadinessParams
) {
  const { windowStartUnixMs, windowEndUnixMs } = params ?? {}
  if (!isValidUnixMsBound(windowStartUnixMs)) return false
  if (!isValidUnixMsBound(windowEndUnixMs)) return false
  if (
    windowStartUnixMs !== undefined &&
    windowEndUnixMs !== undefined &&
    windowStartUnixMs > windowEndUnixMs
  ) {
    return false
  }

  return true
}

function assertLocalFramePhaseAlignmentReadinessWindow(
  params?: LocalFramePhaseAlignmentReadinessParams
) {
  const { windowStartUnixMs, windowEndUnixMs } = params ?? {}
  if (!isValidUnixMsBound(windowStartUnixMs)) {
    throw new Error("windowStartUnixMs must be a non-negative safe integer")
  }
  if (!isValidUnixMsBound(windowEndUnixMs)) {
    throw new Error("windowEndUnixMs must be a non-negative safe integer")
  }
  if (
    windowStartUnixMs !== undefined &&
    windowEndUnixMs !== undefined &&
    windowStartUnixMs > windowEndUnixMs
  ) {
    throw new Error("windowStartUnixMs must be less than or equal to windowEndUnixMs")
  }
}

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
  knowledge_reviews: z.number(),
  plugin_reviews: z.number(),
})

export async function fetchAdminPendingReviewCounts(): Promise<{
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
  preset_id: z.string().nullable().optional(),
  model: z.string(),
  status_code: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
  ttft_ms: z.number().int().nullable().optional(),
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  total_tokens: z.number().int().nonnegative().default(0),
  cost_upstream: z.number().default(0),
  cost_user: z.number().default(0),
  is_cached: z.boolean().default(false),
  cached_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_write_input_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_source: z.string().nullable().optional(),
  usage_source: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  meta: z.unknown().nullable().optional(),
  created_at: z.string(),
}).passthrough()

export const GatewayLogListSchema = createOffsetPageSchema(GatewayLogItemSchema)
export type GatewayLogItem = z.infer<typeof GatewayLogItemSchema>

type GatewayLogFilterParams = {
  start_time?: string
  end_time?: string
  user_id?: string
  api_key_id?: string
  preset_id?: string
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
        user_id: params?.user_id,
        api_key_id: params?.api_key_id,
        preset_id: params?.preset_id,
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
      user_id: params?.user_id,
      api_key_id: params?.api_key_id,
      preset_id: params?.preset_id,
      model: params?.model,
      status_code: params?.status_code,
      is_cached: params?.is_cached,
      error_code: params?.error_code,
    },
  })
  return GatewayLogListSchema.parse(data)
}

export async function deleteAdminGatewayLogs(params?: GatewayLogFilterParams): Promise<number> {
  if (isTauriRuntime()) {
    const deleted = await invokeTauri<unknown>("delete_local_gateway_logs", {
      query: {
        start_time: params?.start_time,
        end_time: params?.end_time,
        user_id: params?.user_id,
        api_key_id: params?.api_key_id,
        preset_id: params?.preset_id,
        model: params?.model,
        status_code: params?.status_code,
        is_cached: params?.is_cached,
        error_code: params?.error_code,
      },
    })
    return z.number().int().nonnegative().parse(deleted)
  }

  const deleted = await request<unknown>({
    url: `${ADMIN_BASE}/gateway-logs`,
    method: "DELETE",
    params: {
      start_time: params?.start_time,
      end_time: params?.end_time,
      user_id: params?.user_id,
      api_key_id: params?.api_key_id,
      preset_id: params?.preset_id,
      model: params?.model,
      status_code: params?.status_code,
      is_cached: params?.is_cached,
      error_code: params?.error_code,
    },
  })
  return z.number().int().nonnegative().parse(deleted)
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
        user_id: params?.user_id,
        api_key_id: params?.api_key_id,
        preset_id: params?.preset_id,
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
      user_id: params?.user_id,
      api_key_id: params?.api_key_id,
      preset_id: params?.preset_id,
      model: params?.model,
      status_code: params?.status_code,
      is_cached: params?.is_cached,
      error_code: params?.error_code,
    },
  })
  return GatewayLogStatsSchema.parse(data)
}

export const LocalFramePhaseAlignmentReadinessSchema = z.object({
  metric: z.string(),
  contract_schema_version: NonNegativeSafeIntegerSchema,
  observation_window: z.string(),
  window_start_unix_ms: NonNegativeSafeIntegerSchema.nullable(),
  window_end_unix_ms: NonNegativeSafeIntegerSchema.nullable(),
  observed_payload_start_unix_ms: NonNegativeSafeIntegerSchema.nullable(),
  observed_payload_end_unix_ms: NonNegativeSafeIntegerSchema.nullable(),
  eligible_sample_start_unix_ms: NonNegativeSafeIntegerSchema.nullable(),
  eligible_sample_end_unix_ms: NonNegativeSafeIntegerSchema.nullable(),
  observation_window_ms: NonNegativeSafeIntegerSchema.nullable(),
  minimum_observation_window_ms: NonNegativeSafeIntegerSchema,
  observation_window_met: z.boolean(),
  graph_count: NonNegativeSafeIntegerSchema,
  malformed_payload_count: NonNegativeSafeIntegerSchema,
  malformed_graph_payload_count: NonNegativeSafeIntegerSchema,
  malformed_e3_payload_count: NonNegativeSafeIntegerSchema,
  missing_e3_payload_count: NonNegativeSafeIntegerSchema,
  observed_payload_count: NonNegativeSafeIntegerSchema,
  eligible_sample_count: NonNegativeSafeIntegerSchema,
  matched_sample_count: NonNegativeSafeIntegerSchema,
  mismatched_sample_count: NonNegativeSafeIntegerSchema,
  excluded_sample_count: NonNegativeSafeIntegerSchema,
  direct_iteration_sample_count: NonNegativeSafeIntegerSchema,
  non_direct_strategy_sample_count: NonNegativeSafeIntegerSchema,
  non_direct_strategy_ratio: z.number().min(0).max(1).nullable(),
  minimum_non_direct_strategy_ratio: z.number().min(0).max(1),
  strategy_distribution_met: z.boolean(),
  overlap_ratio: z.number().min(0).max(1).nullable(),
  minimum_overlap_ratio: z.number().min(0).max(1),
  overlap_threshold_met: z.boolean(),
  e3_payload_coverage_met: z.boolean(),
  e3_payload_health_met: z.boolean(),
  threshold_met: z.boolean(),
}).superRefine((readiness, ctx) => {
  const addIssue = (path: string, message: string) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: [path],
    })
  }

  if (
    readiness.window_start_unix_ms !== null &&
    readiness.window_end_unix_ms !== null &&
    readiness.window_start_unix_ms > readiness.window_end_unix_ms
  ) {
    addIssue(
      "window_start_unix_ms",
      "window_start_unix_ms must be less than or equal to window_end_unix_ms"
    )
  }

  if (
    readiness.observed_payload_start_unix_ms !== null &&
    readiness.observed_payload_end_unix_ms !== null &&
    readiness.observed_payload_start_unix_ms > readiness.observed_payload_end_unix_ms
  ) {
    addIssue(
      "observed_payload_start_unix_ms",
      "observed_payload_start_unix_ms must be less than or equal to observed_payload_end_unix_ms"
    )
  }
  if (
    (readiness.observed_payload_start_unix_ms === null) !==
    (readiness.observed_payload_end_unix_ms === null)
  ) {
    addIssue(
      "observed_payload_start_unix_ms",
      "observed payload range bounds must both be null or both be present"
    )
  }
  if (
    (readiness.observed_payload_count === 0) !==
    (readiness.observed_payload_start_unix_ms === null &&
      readiness.observed_payload_end_unix_ms === null)
  ) {
    addIssue(
      "observed_payload_count",
      "observed payload range must be null only when there are no observed payloads"
    )
  }
  if (
    readiness.window_start_unix_ms !== null &&
    readiness.observed_payload_start_unix_ms !== null &&
    readiness.observed_payload_start_unix_ms < readiness.window_start_unix_ms
  ) {
    addIssue(
      "observed_payload_start_unix_ms",
      "observed payload range must stay within the requested window"
    )
  }
  if (
    readiness.window_end_unix_ms !== null &&
    readiness.observed_payload_end_unix_ms !== null &&
    readiness.observed_payload_end_unix_ms > readiness.window_end_unix_ms
  ) {
    addIssue(
      "observed_payload_end_unix_ms",
      "observed payload range must stay within the requested window"
    )
  }

  if (
    readiness.eligible_sample_start_unix_ms !== null &&
    readiness.eligible_sample_end_unix_ms !== null &&
    readiness.eligible_sample_start_unix_ms > readiness.eligible_sample_end_unix_ms
  ) {
    addIssue(
      "eligible_sample_start_unix_ms",
      "eligible_sample_start_unix_ms must be less than or equal to eligible_sample_end_unix_ms"
    )
  }
  if (
    (readiness.eligible_sample_start_unix_ms === null) !==
    (readiness.eligible_sample_end_unix_ms === null)
  ) {
    addIssue(
      "eligible_sample_start_unix_ms",
      "eligible sample range bounds must both be null or both be present"
    )
  }
  if (
    (readiness.eligible_sample_count === 0) !==
    (readiness.eligible_sample_start_unix_ms === null &&
      readiness.eligible_sample_end_unix_ms === null)
  ) {
    addIssue(
      "eligible_sample_count",
      "eligible sample range must be null only when there are no eligible samples"
    )
  }
  if (
    readiness.observed_payload_start_unix_ms !== null &&
    readiness.eligible_sample_start_unix_ms !== null &&
    readiness.eligible_sample_start_unix_ms < readiness.observed_payload_start_unix_ms
  ) {
    addIssue(
      "eligible_sample_start_unix_ms",
      "eligible sample range must stay within the observed payload range"
    )
  }
  if (
    readiness.observed_payload_end_unix_ms !== null &&
    readiness.eligible_sample_end_unix_ms !== null &&
    readiness.eligible_sample_end_unix_ms > readiness.observed_payload_end_unix_ms
  ) {
    addIssue(
      "eligible_sample_end_unix_ms",
      "eligible sample range must stay within the observed payload range"
    )
  }

  if (
    readiness.graph_count !==
    readiness.observed_payload_count +
      readiness.missing_e3_payload_count +
      readiness.malformed_graph_payload_count
  ) {
    addIssue(
      "graph_count",
      "graph_count must equal observed payloads plus missing E3 payloads plus malformed graph payloads"
    )
  }

  if (readiness.metric !== FRAME_PHASE_ALIGNMENT_METRIC) {
    addIssue("metric", "metric must match the E3 readiness contract")
  }

  if (readiness.contract_schema_version !== FRAME_PHASE_ALIGNMENT_CONTRACT_SCHEMA_VERSION) {
    addIssue(
      "contract_schema_version",
      "contract_schema_version must match the E3 readiness contract"
    )
  }

  if (readiness.observation_window !== FRAME_PHASE_ALIGNMENT_OBSERVATION_WINDOW) {
    addIssue(
      "observation_window",
      "observation_window must match the E3 readiness contract"
    )
  }

  if (
    Math.abs(readiness.minimum_overlap_ratio - FRAME_PHASE_ALIGNMENT_MINIMUM_RATIO) >
    FRAME_PHASE_ALIGNMENT_RATIO_TOLERANCE
  ) {
    addIssue(
      "minimum_overlap_ratio",
      "minimum_overlap_ratio must match the E3 readiness contract"
    )
  }

  if (
    Math.abs(
      readiness.minimum_non_direct_strategy_ratio -
        FRAME_PHASE_ALIGNMENT_MINIMUM_NON_DIRECT_STRATEGY_RATIO
    ) > FRAME_PHASE_ALIGNMENT_RATIO_TOLERANCE
  ) {
    addIssue(
      "minimum_non_direct_strategy_ratio",
      "minimum_non_direct_strategy_ratio must match the E3 readiness contract"
    )
  }

  if (
    readiness.minimum_observation_window_ms !==
    FRAME_PHASE_ALIGNMENT_MINIMUM_OBSERVATION_WINDOW_MS
  ) {
    addIssue(
      "minimum_observation_window_ms",
      "minimum_observation_window_ms must match the E3 readiness contract"
    )
  }

  if (
    readiness.malformed_payload_count !==
    readiness.malformed_graph_payload_count + readiness.malformed_e3_payload_count
  ) {
    addIssue(
      "malformed_payload_count",
      "malformed_payload_count must equal malformed_graph_payload_count plus malformed_e3_payload_count"
    )
  }

  if (
    readiness.eligible_sample_count !==
    readiness.matched_sample_count + readiness.mismatched_sample_count
  ) {
    addIssue(
      "eligible_sample_count",
      "eligible_sample_count must equal matched_sample_count plus mismatched_sample_count"
    )
  }

  if (
    readiness.eligible_sample_count !==
    readiness.direct_iteration_sample_count + readiness.non_direct_strategy_sample_count
  ) {
    addIssue(
      "eligible_sample_count",
      "eligible_sample_count must equal direct and non-direct strategy sample counts"
    )
  }

  if (
    readiness.observed_payload_count !==
    readiness.eligible_sample_count +
      readiness.excluded_sample_count +
      readiness.malformed_e3_payload_count
  ) {
    addIssue(
      "observed_payload_count",
      "observed_payload_count must equal eligible, excluded, and malformed E3 payload counts"
    )
  }

  const expectedOverlapRatio =
    readiness.eligible_sample_count === 0
      ? null
      : readiness.matched_sample_count / readiness.eligible_sample_count
  if (expectedOverlapRatio === null) {
    if (readiness.overlap_ratio !== null) {
      addIssue(
        "overlap_ratio",
        "overlap_ratio must be null when there are no eligible samples"
      )
    }
  } else if (
    readiness.overlap_ratio === null ||
    Math.abs(readiness.overlap_ratio - expectedOverlapRatio) >
      FRAME_PHASE_ALIGNMENT_RATIO_TOLERANCE
  ) {
    addIssue(
      "overlap_ratio",
      "overlap_ratio must equal matched_sample_count divided by eligible_sample_count"
    )
  }

  const expectedOverlapThresholdMet =
    readiness.overlap_ratio !== null &&
    readiness.overlap_ratio >= readiness.minimum_overlap_ratio
  if (readiness.overlap_threshold_met !== expectedOverlapThresholdMet) {
    addIssue(
      "overlap_threshold_met",
      "overlap_threshold_met must reflect overlap_ratio and minimum_overlap_ratio"
    )
  }

  const expectedNonDirectStrategyRatio =
    readiness.eligible_sample_count === 0
      ? null
      : readiness.non_direct_strategy_sample_count / readiness.eligible_sample_count
  if (expectedNonDirectStrategyRatio === null) {
    if (readiness.non_direct_strategy_ratio !== null) {
      addIssue(
        "non_direct_strategy_ratio",
        "non_direct_strategy_ratio must be null when there are no eligible samples"
      )
    }
  } else if (
    readiness.non_direct_strategy_ratio === null ||
    Math.abs(readiness.non_direct_strategy_ratio - expectedNonDirectStrategyRatio) >
      FRAME_PHASE_ALIGNMENT_RATIO_TOLERANCE
  ) {
    addIssue(
      "non_direct_strategy_ratio",
      "non_direct_strategy_ratio must equal non_direct_strategy_sample_count divided by eligible_sample_count"
    )
  }

  const expectedStrategyDistributionMet =
    readiness.non_direct_strategy_ratio !== null &&
    readiness.non_direct_strategy_ratio >= readiness.minimum_non_direct_strategy_ratio
  if (readiness.strategy_distribution_met !== expectedStrategyDistributionMet) {
    addIssue(
      "strategy_distribution_met",
      "strategy_distribution_met must reflect non_direct_strategy_ratio and minimum_non_direct_strategy_ratio"
    )
  }

  const expectedObservationWindowMs =
    readiness.eligible_sample_start_unix_ms === null ||
    readiness.eligible_sample_end_unix_ms === null
      ? null
      : Math.max(
          readiness.eligible_sample_end_unix_ms - readiness.eligible_sample_start_unix_ms,
          0
        )
  if (readiness.observation_window_ms !== expectedObservationWindowMs) {
    addIssue(
      "observation_window_ms",
      "observation_window_ms must match the eligible sample range"
    )
  }

  const expectedObservationWindowMet =
    readiness.observation_window_ms !== null &&
    readiness.observation_window_ms >= readiness.minimum_observation_window_ms
  if (readiness.observation_window_met !== expectedObservationWindowMet) {
    addIssue(
      "observation_window_met",
      "observation_window_met must reflect observation_window_ms and minimum_observation_window_ms"
    )
  }

  if (readiness.e3_payload_health_met !== (readiness.malformed_e3_payload_count === 0)) {
    addIssue(
      "e3_payload_health_met",
      "e3_payload_health_met must reflect malformed_e3_payload_count"
    )
  }

  if (readiness.e3_payload_coverage_met !== (readiness.missing_e3_payload_count === 0)) {
    addIssue(
      "e3_payload_coverage_met",
      "e3_payload_coverage_met must reflect missing_e3_payload_count"
    )
  }

  if (
    readiness.threshold_met !==
    (readiness.observation_window_met &&
      readiness.overlap_threshold_met &&
      readiness.strategy_distribution_met &&
      readiness.e3_payload_coverage_met &&
      readiness.e3_payload_health_met)
  ) {
    addIssue(
      "threshold_met",
      "threshold_met must require observation window, overlap threshold, strategy distribution, E3 payload coverage, and E3 payload health"
    )
  }
})

export type LocalFramePhaseAlignmentReadiness = z.infer<
  typeof LocalFramePhaseAlignmentReadinessSchema
>

function assertLocalFramePhaseAlignmentReadinessResponseWindow(
  readiness: LocalFramePhaseAlignmentReadiness,
  params?: LocalFramePhaseAlignmentReadinessParams
) {
  const expectedWindowStartUnixMs = params?.windowStartUnixMs ?? null
  const expectedWindowEndUnixMs = params?.windowEndUnixMs ?? null

  if (readiness.window_start_unix_ms !== expectedWindowStartUnixMs) {
    throw new Error("window_start_unix_ms must match the requested windowStartUnixMs")
  }
  if (readiness.window_end_unix_ms !== expectedWindowEndUnixMs) {
    throw new Error("window_end_unix_ms must match the requested windowEndUnixMs")
  }
}

export async function fetchLocalFramePhaseAlignmentReadiness(
  params?: LocalFramePhaseAlignmentReadinessParams
): Promise<LocalFramePhaseAlignmentReadiness> {
  if (!isTauriCommandRuntime()) {
    throw new Error("fetchLocalFramePhaseAlignmentReadiness is only supported in Tauri runtime")
  }
  assertLocalFramePhaseAlignmentReadinessWindow(params)

  const data = await invokeTauri<unknown>("get_local_frame_phase_alignment_readiness", {
    windowStartUnixMs: params?.windowStartUnixMs,
    windowEndUnixMs: params?.windowEndUnixMs,
  })
  const readiness = LocalFramePhaseAlignmentReadinessSchema.parse(data)
  assertLocalFramePhaseAlignmentReadinessResponseWindow(readiness, params)
  return readiness
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
